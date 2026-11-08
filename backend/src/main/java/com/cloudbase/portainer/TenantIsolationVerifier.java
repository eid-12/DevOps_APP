package com.cloudbase.portainer;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Proves, by effect, that a tenant project network cannot reach published ports elsewhere on the host.
 *
 * Docker accepts connections from any bridge to a container's published ports on that container's IP; only the
 * host guard (deploy/egress-guard) stops tenant bridges from doing so. A running guard container proves nothing,
 * so this starts a short-lived probe on the project network and tries to open a TCP connection to a canary that
 * publishes a port like NPM, Portainer or a database does. The probe must fail to reach the canary and must reach
 * the edge on its own network (control: a broken probe is never mistaken for protection).
 */
@Component
public class TenantIsolationVerifier {

    private static final Logger log = LoggerFactory.getLogger(TenantIsolationVerifier.class);

    public enum Result { PROTECTED, EXPOSED, UNVERIFIED }

    public record Outcome(Result result, String detail) {}

    static final String CANARY = "cloudbase-guard-canary";
    static final String CANARY_NETWORK = "cloudbase-canary";
    private static final Duration PROBE_DEADLINE = Duration.ofSeconds(25);

    private final PortainerClient portainer;
    private final EdgeRouter edge;
    private final boolean enabled;

    public TenantIsolationVerifier(
            PortainerClient portainer,
            EdgeRouter edge,
            @Value("${cloudbase.isolation.verify:true}") boolean enabled
    ) {
        this.portainer = portainer;
        this.edge = edge;
        this.enabled = enabled;
    }

    /** Probe one project network. Never throws; any failure to verify is {@link Result#UNVERIFIED}. */
    public Outcome verify(String projectNetwork) {
        if (!enabled) {
            return new Outcome(Result.PROTECTED, "verification disabled by configuration");
        }
        try {
            String canaryIp = ensureCanary().block(PROBE_DEADLINE);
            if (canaryIp == null || canaryIp.isBlank()) {
                return new Outcome(Result.UNVERIFIED, "canary has no address");
            }
            String output = probe(projectNetwork, canaryIp);
            return interpret(output);
        } catch (RuntimeException e) {
            log.warn("Isolation of {} could not be verified: {}", projectNetwork, e.getMessage());
            return new Outcome(Result.UNVERIFIED, e.getMessage());
        }
    }

    static Outcome interpret(String output) {
        String out = output == null ? "" : output;
        if (!out.contains("CONTROL_OK")) {
            return new Outcome(Result.UNVERIFIED, "probe control failed: " + out.trim());
        }
        if (out.contains("EXPOSED")) {
            return new Outcome(Result.EXPOSED, "a tenant network reached a published port on another network");
        }
        if (out.contains("BLOCKED")) {
            return new Outcome(Result.PROTECTED, "published ports unreachable from the tenant network");
        }
        return new Outcome(Result.UNVERIFIED, "unexpected probe output: " + out.trim());
    }

    /** Canary container with a published port on its own network; returns its address there. */
    private Mono<String> ensureCanary() {
        return portainer.ensureNetwork(CANARY_NETWORK, Map.of("cloudbase.role", "isolation-canary"))
                .then(portainer.findContainer(CANARY).map(java.util.Optional::of).defaultIfEmpty(java.util.Optional.empty()))
                .flatMap(existing -> {
                    if (existing.isPresent() && running(existing.get())) {
                        return Mono.just(existing.get());
                    }
                    Mono<Void> fresh = existing.isPresent() ? portainer.removeContainer(CANARY) : Mono.empty();
                    Map<String, Object> body = Map.of(
                            "Image", EdgeRouter.imageRef(),
                            "ExposedPorts", Map.of("80/tcp", Map.of()),
                            "Labels", Map.of("cloudbase.role", "isolation-canary"),
                            "HostConfig", Map.of(
                                    "NetworkMode", CANARY_NETWORK,
                                    // Published like NPM :81 or Portainer :9000; loopback only, so nothing is exposed.
                                    "PortBindings", Map.of("80/tcp", List.of(Map.of("HostIp", "127.0.0.1", "HostPort", ""))),
                                    "RestartPolicy", Map.of("Name", "unless-stopped"),
                                    "SecurityOpt", List.of("no-new-privileges:true"),
                                    "Memory", 32L * 1024 * 1024));
                    return fresh.then(portainer.createAndStart(CANARY, EdgeRouter.IMAGE, EdgeRouter.TAG, body))
                            .then(portainer.findContainer(CANARY));
                })
                .map(c -> address(c, CANARY_NETWORK));
    }

    private String probe(String projectNetwork, String canaryIp) {
        String name = "cb-probe-" + UUID.randomUUID().toString().substring(0, 8);
        String script = "if nc -z -w 2 " + canaryIp + " 80; then echo EXPOSED; else echo BLOCKED; fi; "
                + "if nc -z -w 2 " + edge.edgeName() + " 80; then echo CONTROL_OK; else echo CONTROL_FAIL; fi";
        Map<String, Object> body = Map.of(
                "Image", EdgeRouter.imageRef(),
                "Cmd", List.of("sh", "-c", script),
                "Labels", Map.of("cloudbase.role", "isolation-probe"),
                "HostConfig", Map.of(
                        "NetworkMode", projectNetwork,
                        "SecurityOpt", List.of("no-new-privileges:true"),
                        "Memory", 32L * 1024 * 1024));
        try {
            portainer.createAndStart(name, EdgeRouter.IMAGE, EdgeRouter.TAG, body).block(PROBE_DEADLINE);
            long deadline = System.nanoTime() + PROBE_DEADLINE.toNanos();
            while (System.nanoTime() < deadline) {
                Map<String, Object> c = portainer.findContainer(name).block(Duration.ofSeconds(10));
                if (c != null && !running(c)) {
                    return portainer.getContainerLogs(name, 20).block(Duration.ofSeconds(10));
                }
                sleep(500);
            }
            throw new IllegalStateException("probe did not finish in " + PROBE_DEADLINE.toSeconds() + " s");
        } finally {
            portainer.removeContainer(name).onErrorResume(e -> Mono.empty()).block(Duration.ofSeconds(10));
        }
    }

    @SuppressWarnings("unchecked")
    private static String address(Map<String, Object> container, String network) {
        if (container.get("NetworkSettings") instanceof Map<?, ?> ns && ns.get("Networks") instanceof Map<?, ?> nets
                && nets.get(network) instanceof Map<?, ?> n && n.get("IPAddress") != null) {
            return String.valueOf(n.get("IPAddress"));
        }
        return null;
    }

    private static boolean running(Map<String, Object> container) {
        return container.get("State") instanceof Map<?, ?> s && Boolean.TRUE.equals(s.get("Running"));
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted");
        }
    }
}
