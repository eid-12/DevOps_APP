package com.cloudbase.portainer;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * Tenant-facing edge between the reverse proxy (Nginx Proxy Manager) and tenant apps.
 *
 * NPM serves its admin UI on :81 on every network it joins, so it must not join project networks. Instead a
 * plain nginx container (the edge) joins every project network that holds an app, and one edge network shared
 * only with NPM. NPM forwards every tenant hostname to the edge on :80; the edge routes by Host to the app
 * container using a route table the API rewrites on each change. The edge listens only on :80 and accepts
 * requests only from the edge network, so a tenant can neither reach NPM nor use the edge to reach another
 * project. The API recreates the edge, its networks and its routes when they are missing (see reconcile).
 */
@Component
public class EdgeRouter {

    private static final Logger log = LoggerFactory.getLogger(EdgeRouter.class);
    // Pinned by content digest (nginx 1.30.6-alpine, multi-platform index): a tag can be re-pushed, a digest cannot.
    // The edge sits between the public proxy and every tenant app, so its image must never change silently.
    static final String IMAGE = "nginx";
    static final String TAG = "sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311";
    static final String IMAGE_LABEL = "cloudbase.edge.image";

    /** Reference for container create; {@link #TAG} doubles as the digest Docker pulls when the image is missing. */
    static String imageRef() {
        return IMAGE + "@" + TAG;
    }
    static final String SUBNET_LABEL = "cloudbase.edge.subnet";
    private static final Pattern HOST = Pattern.compile("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$");
    private static final Pattern UPSTREAM = Pattern.compile("^cb-[a-z0-9-]+:[0-9]{1,5}$");

    private final PortainerClient portainer;
    private final String edgeName;
    private final String edgeNetwork;
    private final String proxyContainer;

    public EdgeRouter(
            PortainerClient portainer,
            @Value("${cloudbase.edge.container:cloudbase-edge}") String edgeName,
            @Value("${cloudbase.edge.network:cloudbase-edge}") String edgeNetwork,
            @Value("${cloudbase.proxy.container:nginx-proxy}") String proxyContainer
    ) {
        this.portainer = portainer;
        this.edgeName = edgeName;
        this.edgeNetwork = edgeNetwork;
        this.proxyContainer = proxyContainer;
    }

    /** Container NPM forwards to, and the only shared member of tenant project networks. */
    public String edgeName() {
        return edgeName;
    }

    /**
     * Removes an edge built from an older pinned image, so the next {@link #ensureEdge()} recreates it on the current
     * one. Called only from the edge reconcile, which then reattaches project networks and rewrites routes in the same
     * pass, so tenant routing is down for seconds, once per image change.
     */
    public Mono<Boolean> retireIfOutdated() {
        return portainer.findContainer(edgeName)
                .flatMap(c -> imageRef().equals(label(c, IMAGE_LABEL))
                        ? Mono.just(false)
                        : portainer.removeContainer(edgeName)
                                .doOnSuccess(v -> log.info("Edge {} runs an outdated image; recreating it on {}", edgeName, imageRef()))
                                .thenReturn(true))
                .defaultIfEmpty(false);
    }

    /** Edge network with the proxy on it, and a running edge whose access rule matches that network. */
    public Mono<Void> ensureEdge() {
        return portainer.ensureNetwork(edgeNetwork, Map.of("cloudbase.role", "edge"))
                .flatMap(network -> {
                    String subnet = subnet(network);
                    if (subnet == null) {
                        return Mono.error(new IllegalStateException("Edge network " + edgeNetwork + " has no subnet"));
                    }
                    return portainer.connectIfMissing(edgeNetwork, network, proxyContainer)
                            .then(portainer.findContainer(edgeName)
                                    .map(c -> java.util.Optional.of(c))
                                    .defaultIfEmpty(java.util.Optional.empty()))
                            .flatMap(existing -> {
                                if (existing.isEmpty()) {
                                    return create(subnet);
                                }
                                Map<String, Object> c = existing.get();
                                if (!subnet.equals(label(c, SUBNET_LABEL))) {
                                    return portainer.removeContainer(edgeName).then(create(subnet));
                                }
                                return running(c) ? Mono.<Void>empty() : portainer.startContainer(edgeName);
                            });
                })
                .doOnError(e -> log.warn("Edge not ready: {}", e.getMessage()));
    }

    private Mono<Void> create(String subnet) {
        Map<String, Object> body = Map.of(
                "Image", imageRef(),
                "Cmd", List.of("sh", "-c", startScript(subnet)),
                "Labels", Map.of("cloudbase.role", "edge", SUBNET_LABEL, subnet, IMAGE_LABEL, imageRef()),
                "HostConfig", Map.of(
                        "NetworkMode", edgeNetwork,
                        "RestartPolicy", Map.of("Name", "unless-stopped"),
                        "SecurityOpt", List.of("no-new-privileges:true"),
                        "Memory", 64L * 1024 * 1024));
        log.info("Creating edge {} on {} ({})", edgeName, edgeNetwork, subnet);
        return portainer.createAndStart(edgeName, IMAGE, TAG, body);
    }

    /** Replace the route table (hostname -> container:port) and reload; invalid entries are skipped. */
    public Mono<Void> writeRoutes(Map<String, String> routes) {
        String table = routeTable(routes);
        String b64 = Base64.getEncoder().encodeToString(table.getBytes(StandardCharsets.UTF_8));
        String cmd = "printf %s " + b64 + " | base64 -d > /etc/nginx/cb-routes.map.new"
                + " && mv /etc/nginx/cb-routes.map.new /etc/nginx/cb-routes.map && nginx -t -q && nginx -s reload";
        return portainer.exec(edgeName, cmd)
                .doOnSuccess(out -> log.info("Edge routes written: {} hosts", routes.size()))
                .then();
    }

    static String routeTable(Map<String, String> routes) {
        StringBuilder sb = new StringBuilder();
        new TreeMap<>(routes).forEach((host, upstream) -> {
            String h = host == null ? "" : host.trim().toLowerCase();
            if (HOST.matcher(h).matches() && upstream != null && UPSTREAM.matcher(upstream).matches()) {
                sb.append(h).append(' ').append(upstream).append(";\n");
            } else {
                log.warn("Skipping invalid edge route {} -> {}", host, upstream);
            }
        });
        return sb.toString();
    }

    /** nginx config written at container start. Only the edge network may use the edge. */
    static String startScript(String subnet) {
        String conf = String.join("\n",
                "map $http_upgrade $cb_connection { default upgrade; '' close; }",
                "map $host $cb_upstream { hostnames; default \"\"; include /etc/nginx/cb-routes.map; }",
                "server {",
                "  listen 80;",
                "  server_tokens off;",
                "  allow " + subnet + ";",
                "  deny all;",
                "  resolver 127.0.0.11 valid=10s ipv6=off;",
                "  client_max_body_size 0;",
                "  location / {",
                "    if ($cb_upstream = \"\") { return 421; }",
                "    proxy_pass http://$cb_upstream;",
                "    proxy_http_version 1.1;",
                "    proxy_set_header Host $host;",
                "    proxy_set_header Upgrade $http_upgrade;",
                "    proxy_set_header Connection $cb_connection;",
                "    proxy_set_header X-Forwarded-For $http_x_forwarded_for;",
                "    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;",
                "    proxy_set_header X-Real-IP $http_x_real_ip;",
                "    proxy_read_timeout 3600s;",
                "  }",
                "}", "");
        String b64 = Base64.getEncoder().encodeToString(conf.getBytes(StandardCharsets.UTF_8));
        return "rm -f /etc/nginx/conf.d/*.conf && printf %s " + b64 + " | base64 -d > /etc/nginx/conf.d/edge.conf"
                + " && touch /etc/nginx/cb-routes.map && exec nginx -g 'daemon off;'";
    }

    @SuppressWarnings("unchecked")
    static String subnet(Map<String, Object> network) {
        if (network.get("IPAM") instanceof Map<?, ?> ipam && ipam.get("Config") instanceof List<?> cfg && !cfg.isEmpty()
                && cfg.get(0) instanceof Map<?, ?> first && first.get("Subnet") != null) {
            return String.valueOf(first.get("Subnet"));
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private static String label(Map<String, Object> container, String key) {
        if (container.get("Config") instanceof Map<?, ?> cfg && cfg.get("Labels") instanceof Map<?, ?> labels) {
            Object v = labels.get(key);
            return v == null ? null : String.valueOf(v);
        }
        return null;
    }

    private static boolean running(Map<String, Object> container) {
        return container.get("State") instanceof Map<?, ?> s && Boolean.TRUE.equals(s.get("Running"));
    }
}
