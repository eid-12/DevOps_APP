package com.cloudbase.npm;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import com.cloudbase.service.PlatformSettingsService;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Nginx Proxy Manager API client.
 * Authenticates via /api/tokens and manages Proxy Hosts for *.cloudbase.website.
 */
@Component
public class NpmClient {

    private static final Logger log = LoggerFactory.getLogger(NpmClient.class);
    private static final ParameterizedTypeReference<Map<String, Object>> MAP_TYPE =
            new ParameterizedTypeReference<>() {};

    private final WebClient.Builder webClientBuilder;
    private final PlatformSettingsService settings;
    private volatile WebClient webClient;
    private volatile String identity;
    private volatile String secret;
    private volatile boolean enabled;
    private volatile Integer certificateId;
    private volatile boolean sslForced;
    private final AtomicReference<String> cachedToken = new AtomicReference<>();

    public NpmClient(
            PlatformSettingsService settings,
            WebClient.Builder webClientBuilder
    ) {
        this.settings = settings;
        this.webClientBuilder = webClientBuilder;
        reloadFromSettings();
        settings.addChangeListener(this::reloadFromSettings);
    }

    public void reloadFromSettings() {
        String npmUrl = settings.get(PlatformSettingsService.NPM_URL);
        this.identity = settings.get(PlatformSettingsService.NPM_EMAIL);
        this.secret = settings.get(PlatformSettingsService.NPM_PASSWORD);
        this.enabled = settings.getBoolean(PlatformSettingsService.NPM_ENABLED);
        this.certificateId = settings.getInt(PlatformSettingsService.NPM_CERTIFICATE_ID, 0);
        this.sslForced = settings.getBoolean(PlatformSettingsService.NPM_SSL_FORCED);
        this.webClient = webClientBuilder.clone()
                .baseUrl(npmUrl == null || npmUrl.isBlank() ? "http://localhost:81" : npmUrl)
                .build();
        cachedToken.set(null);
        log.info("NPM client reloaded (enabled={})", this.enabled);
    }

    public boolean isEnabled() {
        return enabled && identity != null && !identity.isBlank() && secret != null && !secret.isBlank();
    }

    public Mono<Map<String, Object>> getStatus() {
        if (!isEnabled()) {
            return Mono.just(Map.of("status", "disabled"));
        }
        // Brief retries: Cloudflare/tunnel occasionally resets mid-handshake.
        return authenticate()
                .flatMap(token -> webClient.get()
                        .uri("/api/")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .retrieve()
                        .bodyToMono(MAP_TYPE)
                        .map(body -> Map.<String, Object>of("status", "connected")))
                .retryWhen(reactor.util.retry.Retry.fixedDelay(2, java.time.Duration.ofMillis(400))
                        .filter(ex -> !(ex instanceof IllegalStateException)))
                .onErrorReturn(Map.of("status", "error"));
    }

    /**
     * Create or update a Proxy Host mapping one or more hostnames → Docker container:port.
     * @return NPM proxy host id
     */
    public Mono<Integer> upsertProxyHost(
            Integer existingHostId,
            String fqdn,
            String forwardHost,
            int forwardPort
    ) {
        return upsertProxyHost(existingHostId, List.of(fqdn), forwardHost, forwardPort);
    }

    public Mono<Integer> upsertProxyHost(
            Integer existingHostId,
            List<String> fqdns,
            String forwardHost,
            int forwardPort
    ) {
        if (!isEnabled()) {
            log.warn("NPM disabled - skipping proxy host for {}", fqdns);
            return Mono.empty();
        }
        if (fqdns == null || fqdns.isEmpty()) {
            return Mono.empty();
        }

        Map<String, Object> body = proxyHostBody(fqdns, forwardHost, forwardPort);
        String label = String.join(", ", fqdns);

        return authenticate().flatMap(token -> {
            if (existingHostId != null && existingHostId > 0) {
                return webClient.put()
                        .uri("/api/nginx/proxy-hosts/{id}", existingHostId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .bodyValue(body)
                        .retrieve()
                        .bodyToMono(MAP_TYPE)
                        .map(r -> asInt(r.get("id")))
                        .doOnSuccess(id -> log.info("Updated NPM proxy host {} → {}:{}", label, forwardHost, forwardPort));
            }
            return webClient.post()
                    .uri("/api/nginx/proxy-hosts")
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(MAP_TYPE)
                    .map(r -> asInt(r.get("id")))
                    .doOnSuccess(id -> log.info("Created NPM proxy host {} → {}:{}", label, forwardHost, forwardPort));
        });
    }

    public Mono<Void> deleteProxyHost(Integer hostId) {
        if (!isEnabled() || hostId == null || hostId <= 0) {
            return Mono.empty();
        }
        return authenticate().flatMap(token -> webClient.delete()
                .uri("/api/nginx/proxy-hosts/{id}", hostId)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .retrieve()
                .bodyToMono(Void.class)
                .doOnSuccess(v -> log.info("Deleted NPM proxy host id={}", hostId))
                .onErrorResume(e -> {
                    log.warn("NPM delete host {} failed: {}", hostId, e.getMessage());
                    return Mono.empty();
                }));
    }

    private Mono<String> authenticate() {
        String cached = cachedToken.get();
        if (cached != null && !cached.isBlank()) {
            return Mono.just(cached);
        }
        Map<String, String> creds = Map.of(
                "identity", identity,
                "secret", secret
        );
        return webClient.post()
                .uri("/api/tokens")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(creds)
                .retrieve()
                .bodyToMono(MAP_TYPE)
                .map(body -> {
                    String token = String.valueOf(body.get("token"));
                    cachedToken.set(token);
                    return token;
                })
                .doOnError(e -> {
                    cachedToken.set(null);
                    log.error("NPM authentication failed: {}", e.getMessage());
                });
    }

    private Map<String, Object> proxyHostBody(List<String> fqdns, String forwardHost, int forwardPort) {
        Map<String, Object> body = new HashMap<>();
        body.put("domain_names", fqdns);
        body.put("forward_scheme", "http");
        body.put("forward_host", forwardHost);
        body.put("forward_port", forwardPort);
        body.put("access_list_id", "0");
        body.put("certificate_id", certificateId);
        // Match existing working hosts (kafa/manage/…): cert attached, Force SSL off
        // (Cloudflare already terminates HTTPS; Force SSL → redirect loop).
        body.put("ssl_forced", sslForced);
        body.put("caching_enabled", false);
        body.put("block_exploits", true);
        body.put("advanced_config", "");
        body.put("meta", Map.of(
                "letsencrypt_agree", false,
                "dns_challenge", false
        ));
        body.put("allow_websocket_upgrade", true);
        body.put("http2_support", false);
        body.put("hsts_enabled", false);
        body.put("hsts_subdomains", false);
        body.put("enabled", true);
        body.put("locations", List.of());
        return body;
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
