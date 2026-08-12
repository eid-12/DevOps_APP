package com.cloudbase.portainer;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import com.cloudbase.service.PlatformSettingsService;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Portainer HTTP API client - stack create / update / remove for CloudBase deploys.
 */
@Component
public class PortainerClient {

    private static final Logger log = LoggerFactory.getLogger(PortainerClient.class);
    private static final ParameterizedTypeReference<Map<String, Object>> MAP_TYPE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<List<Map<String, Object>>> LIST_MAP_TYPE =
            new ParameterizedTypeReference<>() {};

    private final WebClient.Builder webClientBuilder;
    private final PlatformSettingsService settings;
    private volatile WebClient webClient;
    private volatile int endpointId;

    public PortainerClient(
            PlatformSettingsService settings,
            WebClient.Builder webClientBuilder
    ) {
        this.settings = settings;
        this.webClientBuilder = webClientBuilder;
        reloadFromSettings();
        settings.addChangeListener(this::reloadFromSettings);
    }

    public void reloadFromSettings() {
        String url = settings.get(PlatformSettingsService.PORTAINER_URL);
        String apiKey = settings.get(PlatformSettingsService.PORTAINER_API_KEY);
        this.endpointId = settings.getInt(PlatformSettingsService.PORTAINER_ENDPOINT_ID, 1);
        // Clone so repeated reloads do not accumulate defaultHeader on the shared builder.
        this.webClient = webClientBuilder.clone()
                .baseUrl(url == null || url.isBlank() ? "http://localhost:9000" : url)
                .defaultHeader("X-API-Key", apiKey == null ? "" : apiKey)
                .build();
        log.info("Portainer client reloaded (endpointId={})", this.endpointId);
    }

    public int getEndpointId() {
        return endpointId;
    }

    public Mono<Map<String, Object>> getStatus() {
        return webClient.get()
                .uri("/api/status")
                .retrieve()
                .bodyToMono(MAP_TYPE)
                .doOnError(e -> log.warn("Portainer status check failed: {}", e.getMessage()));
    }

    public Mono<List<Map<String, Object>>> listStacks() {
        return webClient.get()
                .uri("/api/stacks")
                .retrieve()
                .bodyToMono(LIST_MAP_TYPE)
                .doOnError(e -> log.warn("Portainer list stacks failed: {}", e.getMessage()));
    }

    public Mono<Map<String, Object>> findStackByName(String stackName) {
        return listStacks()
                .mapNotNull(stacks -> stacks.stream()
                        .filter(s -> stackName.equalsIgnoreCase(String.valueOf(s.get("Name"))))
                        .filter(s -> Objects.equals(asInt(s.get("EndpointId")), endpointId))
                        .findFirst()
                        .orElse(null));
    }

    /**
     * Create or update a standalone Compose stack, applying Portainer-level env vars
     * (injected into compose ${VAR} placeholders and visible in the Stack env UI).
     */
    public Mono<Map<String, Object>> upsertStack(
            String stackName,
            String composeContent,
            List<Map<String, String>> env,
            Integer existingStackId,
            boolean pullImage
    ) {
        if (existingStackId != null) {
            return updateStack(existingStackId, composeContent, env, pullImage);
        }
        return findStackByName(stackName)
                .flatMap(found -> {
                    if (found != null && found.get("Id") != null) {
                        return updateStack(asInt(found.get("Id")), composeContent, env, pullImage);
                    }
                    return createStack(stackName, composeContent, env);
                })
                .switchIfEmpty(createStack(stackName, composeContent, env));
    }

    public Mono<Map<String, Object>> createStack(
            String stackName,
            String composeContent,
            List<Map<String, String>> env
    ) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", stackName);
        body.put("stackFileContent", composeContent);
        body.put("endpointId", endpointId);
        if (env != null && !env.isEmpty()) {
            body.put("env", env);
        }

        return webClient.post()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/stacks/create/standalone/string")
                        .queryParam("endpointId", endpointId)
                        .build())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .onStatus(s -> s.isError(), resp -> resp.bodyToMono(String.class).defaultIfEmpty("").flatMap(b -> {
                    String detail = b == null || b.isBlank() ? resp.statusCode().toString() : b;
                    log.error("Stack create failed for {}: {}", stackName, detail);
                    return Mono.error(new IllegalStateException(
                            "Portainer stack create failed (" + resp.statusCode().value() + "): " + truncate(detail)));
                }))
                .bodyToMono(MAP_TYPE)
                .doOnSuccess(r -> log.info("Created Portainer stack {}", stackName));
    }

    private static String truncate(String s) {
        if (s == null) return "";
        String t = s.replaceAll("\\s+", " ").trim();
        return t.length() > 400 ? t.substring(0, 400) + "…" : t;
    }

    public Mono<Map<String, Object>> updateStack(
            int stackId,
            String composeContent,
            List<Map<String, String>> env,
            boolean pullImage
    ) {
        Map<String, Object> body = new HashMap<>();
        body.put("stackFileContent", composeContent);
        body.put("prune", true);
        body.put("pullImage", pullImage);
        if (env != null) {
            body.put("env", env);
        }

        return webClient.put()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/stacks/{id}")
                        .queryParam("endpointId", endpointId)
                        .build(stackId))
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_TYPE)
                .doOnSuccess(r -> log.info("Updated Portainer stack id={}", stackId))
                .doOnError(e -> log.error("Stack update failed for id {}: {}", stackId, e.getMessage()));
    }

    public Mono<Void> removeStack(int stackId) {
        return webClient.delete()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/stacks/{id}")
                        .queryParam("endpointId", endpointId)
                        .build(stackId))
                .exchangeToMono(resp -> {
                    int code = resp.statusCode().value();
                    if (code == 404 || resp.statusCode().is2xxSuccessful()) {
                        return resp.releaseBody().then();
                    }
                    return resp.bodyToMono(String.class).defaultIfEmpty("").flatMap(body ->
                            Mono.error(new IllegalStateException(
                                    "Portainer stack remove HTTP " + code + ": " + body)));
                })
                .doOnError(e -> log.error("Stack removal failed for id {}: {}", stackId, e.getMessage()));
    }

    /**
     * Remove stack by name. Empty if no stack exists.
     * Propagates Portainer/API failures (does not swallow) so delete can abort.
     */
    public Mono<Void> removeStackByName(String stackName) {
        if (stackName == null || stackName.isBlank()) {
            return Mono.empty();
        }
        return findStackByName(stackName)
                .flatMap(found -> {
                    Integer id = asInt(found.get("Id"));
                    if (id == null) {
                        return Mono.empty();
                    }
                    return removeStack(id);
                });
    }

    /** Force-remove a container (running or stopped). 404 = already gone. */
    public Mono<Void> forceRemoveContainer(String containerId) {
        if (containerId == null || containerId.isBlank()) {
            return Mono.empty();
        }
        return webClient.delete()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/endpoints/{eid}/docker/containers/{cid}")
                        .queryParam("force", "true")
                        .queryParam("v", "true")
                        .build(endpointId, containerId))
                .exchangeToMono(resp -> {
                    int code = resp.statusCode().value();
                    if (code == 404 || resp.statusCode().is2xxSuccessful()) {
                        return resp.releaseBody().then();
                    }
                    return resp.bodyToMono(String.class).defaultIfEmpty("").flatMap(body ->
                            Mono.error(new IllegalStateException(
                                    "Portainer container remove HTTP " + code + ": " + body)));
                })
                .doOnError(e -> log.warn("Force remove container {} failed: {}", containerId, e.getMessage()));
    }

    /**
     * Force-remove by name. Missing container is OK.
     * List/API failures propagate so callers can refuse delete.
     */
    public Mono<Void> forceRemoveContainerByName(String containerName) {
        if (containerName == null || containerName.isBlank()) {
            return Mono.empty();
        }
        return findContainerIdByName(containerName)
                .flatMap(this::forceRemoveContainer);
    }

    /** @deprecated prefer {@link #removeStack(int)} */
    public Mono<Void> removeStack(int stackId, int ignoredEndpointId) {
        return removeStack(stackId);
    }

    public Mono<Object[]> getContainers() {
        return webClient.get()
                .uri("/api/endpoints/{id}/docker/containers/json?all=true", endpointId)
                .retrieve()
                .bodyToMono(Object[].class)
                .doOnError(e -> log.warn("Container list failed: {}", e.getMessage()));
    }

    /** @deprecated prefer {@link #getContainers()} */
    public Mono<Object[]> getContainers(int ignoredEndpointId) {
        return getContainers();
    }

    /**
     * Resolve Docker container id by exact container name (with or without leading slash).
     */
    @SuppressWarnings("unchecked")
    public Mono<String> findContainerIdByName(String containerName) {
        if (containerName == null || containerName.isBlank()) {
            return Mono.empty();
        }
        String want = containerName.startsWith("/") ? containerName.substring(1) : containerName;
        return getContainers().flatMap(arr -> {
            if (arr == null) return Mono.empty();
            for (Object o : arr) {
                if (!(o instanceof Map<?, ?> m)) continue;
                Object namesObj = m.get("Names");
                boolean match = false;
                if (namesObj instanceof List<?> names) {
                    for (Object n : names) {
                        String name = String.valueOf(n);
                        if (name.startsWith("/")) name = name.substring(1);
                        if (want.equalsIgnoreCase(name)) {
                            match = true;
                            break;
                        }
                    }
                } else if (namesObj != null) {
                    String name = String.valueOf(namesObj);
                    if (name.startsWith("/")) name = name.substring(1);
                    match = want.equalsIgnoreCase(name);
                }
                if (match && m.get("Id") != null) {
                    return Mono.just(String.valueOf(m.get("Id")));
                }
            }
            return Mono.empty();
        });
    }

    public Mono<String> getContainerLogs(String containerId, int tail) {
        int t = Math.max(1, Math.min(tail, 2000));
        return webClient.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/endpoints/{eid}/docker/containers/{cid}/logs")
                        .queryParam("stdout", "true")
                        .queryParam("stderr", "true")
                        .queryParam("timestamps", "true")
                        .queryParam("tail", t)
                        .build(endpointId, containerId))
                .retrieve()
                .bodyToMono(byte[].class)
                .map(this::decodeDockerLogStream)
                .doOnError(e -> log.warn("Container logs failed id={}: {}", containerId, e.getMessage()));
    }

    /**
     * One-shot non-TTY exec. Returns combined stdout/stderr text.
     */
    public Mono<String> exec(String containerId, String command) {
        String cmd = command == null ? "" : command.trim();
        if (cmd.isBlank()) {
            return Mono.just("");
        }

        return inspectContainer(containerId).flatMap(inspect -> {
            String state = containerState(inspect);
            if (!"running".equalsIgnoreCase(state)) {
                return Mono.error(new IllegalStateException(
                        "Container is " + state + " - Console only works while the container is running. "
                                + "Check Logs / Redeploy if it is restarting."));
            }

            Map<String, Object> createBody = new HashMap<>();
            createBody.put("AttachStdin", false);
            createBody.put("AttachStdout", true);
            createBody.put("AttachStderr", true);
            createBody.put("Tty", false);
            createBody.put("Cmd", List.of("sh", "-c", cmd));

            return webClient.post()
                    .uri("/api/endpoints/{eid}/docker/containers/{cid}/exec", endpointId, containerId)
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(createBody)
                    .retrieve()
                    .onStatus(status -> status.value() == 409, resp -> Mono.error(new IllegalStateException(
                            "Container refused exec (409). It may be paused or still starting - wait and retry.")))
                    .bodyToMono(MAP_TYPE)
                    .flatMap(created -> {
                        Object id = created.get("Id");
                        if (id == null) {
                            return Mono.error(new IllegalStateException("Exec create returned no Id"));
                        }
                        Map<String, Object> startBody = Map.of("Detach", false, "Tty", false);
                        return webClient.post()
                                .uri("/api/endpoints/{eid}/docker/exec/{execId}/start", endpointId, String.valueOf(id))
                                .contentType(MediaType.APPLICATION_JSON)
                                .bodyValue(startBody)
                                .retrieve()
                                .bodyToMono(byte[].class)
                                .defaultIfEmpty(new byte[0])
                                .map(this::decodeDockerLogStream);
                    });
        }).doOnError(e -> log.warn("Container exec failed id={}: {}", containerId, e.getMessage()));
    }

    @SuppressWarnings("unchecked")
    public Mono<Map<String, Object>> inspectContainer(String containerId) {
        return webClient.get()
                .uri("/api/endpoints/{eid}/docker/containers/{cid}/json", endpointId, containerId)
                .retrieve()
                .bodyToMono(MAP_TYPE)
                .doOnError(e -> log.warn("Container inspect failed id={}: {}", containerId, e.getMessage()));
    }

    /**
     * Poll until the named container is running, or error with a clear reason.
     * Stack create can succeed while the container exits immediately (bad image/port/crash).
     */
    public Mono<Map<String, Object>> waitUntilRunning(String containerName, int attempts, long delayMs) {
        int max = Math.max(1, attempts);
        long delay = Math.max(200, delayMs);
        return Mono.defer(() -> findContainerIdByName(containerName)
                        .switchIfEmpty(Mono.error(new IllegalStateException(
                                "Container '" + containerName + "' was not created after stack deploy")))
                        .flatMap(this::inspectContainer)
                        .flatMap(inspect -> {
                            String state = containerState(inspect);
                            if ("running".equalsIgnoreCase(state)) {
                                return Mono.just(inspect);
                            }
                            String detail = exitDetail(inspect);
                            return Mono.error(new IllegalStateException(
                                    "Container is " + state + (detail.isBlank() ? "" : " (" + detail + ")")));
                        }))
                .retryWhen(reactor.util.retry.Retry.fixedDelay(max - 1L, java.time.Duration.ofMillis(delay))
                        .filter(err -> {
                            String msg = err.getMessage() == null ? "" : err.getMessage();
                            // Keep retrying while Docker is still creating / starting
                            return msg.contains("was not created")
                                    || msg.contains("is created")
                                    || msg.contains("is starting")
                                    || msg.contains("is restarting");
                        })
                        .onRetryExhaustedThrow((spec, signal) -> signal.failure()));
    }

    @SuppressWarnings("unchecked")
    private static String exitDetail(Map<String, Object> inspect) {
        if (inspect == null) return "";
        Object stateObj = inspect.get("State");
        if (!(stateObj instanceof Map<?, ?> state)) return "";
        Object exit = state.get("ExitCode");
        Object err = state.get("Error");
        StringBuilder sb = new StringBuilder();
        if (exit != null) sb.append("exit=").append(exit);
        if (err != null && !String.valueOf(err).isBlank()) {
            if (!sb.isEmpty()) sb.append(", ");
            sb.append(err);
        }
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    public static String containerState(Map<String, Object> inspect) {
        if (inspect == null) return "unknown";
        Object stateObj = inspect.get("State");
        if (stateObj instanceof Map<?, ?> state) {
            Object status = state.get("Status");
            if (status != null) return String.valueOf(status);
        }
        return "unknown";
    }

    /**
     * Wipe bind-mount data for a path on the Docker host (used to recover crash-looping DBs).
     */
    public Mono<Void> wipeBindMount(String hostPath) {
        if (hostPath == null || hostPath.isBlank()) {
            return Mono.empty();
        }
        Map<String, Object> body = new HashMap<>();
        body.put("Image", "alpine:3.20");
        body.put("Cmd", List.of("sh", "-c", "rm -rf /data/* /data/.[!.]* /data/..?* ; ls -la /data || true"));
        body.put("HostConfig", Map.of("Binds", List.of(hostPath + ":/data")));
        body.put("Labels", Map.of("cloudbase.temp", "volume-wipe"));

        return webClient.post()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/endpoints/{eid}/docker/containers/create")
                        .queryParam("name", "cb-wipe-" + System.currentTimeMillis())
                        .build(endpointId))
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_TYPE)
                .flatMap(created -> {
                    String id = String.valueOf(created.get("Id"));
                    return webClient.post()
                            .uri("/api/endpoints/{eid}/docker/containers/{cid}/start", endpointId, id)
                            .retrieve()
                            .bodyToMono(Void.class)
                            .then(Mono.delay(java.time.Duration.ofSeconds(2)))
                            .then(webClient.delete()
                                    .uri(uriBuilder -> uriBuilder
                                            .path("/api/endpoints/{eid}/docker/containers/{cid}")
                                            .queryParam("force", "true")
                                            .build(endpointId, id))
                                    .retrieve()
                                    .bodyToMono(Void.class)
                                    .onErrorResume(e -> Mono.empty()));
                })
                .doOnSuccess(v -> log.info("Wiped bind mount {}", hostPath))
                .doOnError(e -> log.warn("Wipe bind mount {} failed: {}", hostPath, e.getMessage()))
                .then();
    }

    /**
     * Remove a Docker network by name (e.g. project-{projectId}).
     * Missing network is OK; API failures propagate.
     */
    public Mono<Void> removeNetworkByName(String networkName) {
        if (networkName == null || networkName.isBlank()) {
            return Mono.empty();
        }
        return webClient.get()
                .uri("/api/endpoints/{eid}/docker/networks", endpointId)
                .retrieve()
                .bodyToMono(LIST_MAP_TYPE)
                .flatMap(networks -> {
                    if (networks == null) {
                        return Mono.empty();
                    }
                    String id = networks.stream()
                            .filter(n -> networkName.equalsIgnoreCase(String.valueOf(n.get("Name"))))
                            .map(n -> n.get("Id") != null ? String.valueOf(n.get("Id")) : null)
                            .filter(nid -> nid != null && !nid.isBlank())
                            .findFirst()
                            .orElse(null);
                    if (id == null) {
                        return Mono.empty();
                    }
                    return webClient.delete()
                            .uri("/api/endpoints/{eid}/docker/networks/{nid}", endpointId, id)
                            .exchangeToMono(resp -> {
                                int code = resp.statusCode().value();
                                if (code == 404 || resp.statusCode().is2xxSuccessful()) {
                                    return resp.releaseBody().then();
                                }
                                return resp.bodyToMono(String.class).defaultIfEmpty("").flatMap(body ->
                                        Mono.error(new IllegalStateException(
                                                "Portainer network remove HTTP " + code + ": " + body)));
                            });
                })
                .doOnSuccess(v -> log.info("Removed Docker network {}", networkName))
                .doOnError(e -> log.warn("Remove network {} failed: {}", networkName, e.getMessage()));
    }

    public Mono<Map<String, Object>> getContainerStats(String containerId) {
        return webClient.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/endpoints/{eid}/docker/containers/{cid}/stats")
                        .queryParam("stream", "false")
                        .build(endpointId, containerId))
                .retrieve()
                .bodyToMono(MAP_TYPE)
                .doOnError(e -> log.warn("Container stats failed id={}: {}", containerId, e.getMessage()));
    }

    public Mono<Void> stopContainer(String containerId) {
        return webClient.post()
                .uri("/api/endpoints/{eid}/docker/containers/{cid}/stop", endpointId, containerId)
                .retrieve()
                .bodyToMono(Void.class)
                .onErrorResume(e -> {
                    log.warn("Container stop failed id={}: {}", containerId, e.getMessage());
                    return Mono.empty();
                });
    }

    public Mono<Void> startContainer(String containerId) {
        return webClient.post()
                .uri("/api/endpoints/{eid}/docker/containers/{cid}/start", endpointId, containerId)
                .retrieve()
                .bodyToMono(Void.class)
                .onErrorResume(e -> {
                    log.warn("Container start failed id={}: {}", containerId, e.getMessage());
                    return Mono.empty();
                });
    }

    public Mono<Void> restartContainer(String containerId) {
        return webClient.post()
                .uri("/api/endpoints/{eid}/docker/containers/{cid}/restart", endpointId, containerId)
                .retrieve()
                .bodyToMono(Void.class)
                .doOnError(e -> log.warn("Container restart failed id={}: {}", containerId, e.getMessage()));
    }

    /** Convenience wrapper kept for existing deploy callers. */
    public Mono<Map<String, Object>> deployStack(String stackName, String composeContent, int ignoredEndpointId) {
        return upsertStack(stackName, composeContent, List.of(), null, true);
    }

    /**
     * Docker multiplexed log/exec streams use 8-byte headers when TTY=false.
     * Also accept plain UTF-8 text from some Portainer versions.
     */
    private String decodeDockerLogStream(byte[] raw) {
        if (raw == null || raw.length == 0) return "";
        boolean multiplexed = raw.length >= 8
                && (raw[0] == 0 || raw[0] == 1 || raw[0] == 2)
                && raw[1] == 0 && raw[2] == 0 && raw[3] == 0;
        if (!multiplexed) {
            return new String(raw, java.nio.charset.StandardCharsets.UTF_8).replace("\u0000", "");
        }
        StringBuilder out = new StringBuilder();
        int i = 0;
        while (i + 8 <= raw.length) {
            int size = ((raw[i + 4] & 0xff) << 24)
                    | ((raw[i + 5] & 0xff) << 16)
                    | ((raw[i + 6] & 0xff) << 8)
                    | (raw[i + 7] & 0xff);
            i += 8;
            if (size < 0 || i + size > raw.length) break;
            out.append(new String(raw, i, size, java.nio.charset.StandardCharsets.UTF_8));
            i += size;
        }
        if (out.length() == 0) {
            return new String(raw, java.nio.charset.StandardCharsets.UTF_8).replace("\u0000", "");
        }
        return out.toString();
    }

    private static Integer asInt(Object value) {
        if (value == null) return null;
        if (value instanceof Number n) return n.intValue();
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
