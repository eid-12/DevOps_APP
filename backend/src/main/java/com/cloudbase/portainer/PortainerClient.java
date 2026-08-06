package com.cloudbase.portainer;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Portainer HTTP API client — stack create / update / remove for CloudBase deploys.
 */
@Component
public class PortainerClient {

    private static final Logger log = LoggerFactory.getLogger(PortainerClient.class);
    private static final ParameterizedTypeReference<Map<String, Object>> MAP_TYPE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<List<Map<String, Object>>> LIST_MAP_TYPE =
            new ParameterizedTypeReference<>() {};

    private final WebClient webClient;
    private final int endpointId;

    public PortainerClient(
            @Value("${portainer.url}") String portainerUrl,
            @Value("${portainer.api-key:}") String apiKey,
            @Value("${portainer.endpoint-id:1}") int endpointId,
            WebClient.Builder webClientBuilder
    ) {
        this.endpointId = endpointId;
        this.webClient = webClientBuilder
                .baseUrl(portainerUrl)
                .defaultHeader("X-API-Key", apiKey)
                .build();
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
                .bodyToMono(MAP_TYPE)
                .doOnSuccess(r -> log.info("Created Portainer stack {}", stackName))
                .doOnError(e -> log.error("Stack create failed for {}: {}", stackName, e.getMessage()));
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
                .retrieve()
                .bodyToMono(Void.class)
                .doOnError(e -> log.error("Stack removal failed for id {}: {}", stackId, e.getMessage()));
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
                })
                .doOnError(e -> log.warn("Container exec failed id={}: {}", containerId, e.getMessage()));
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
