package com.cloudbase.portainer;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.model.DatabaseType;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.service.PlatformSettingsService;
import com.cloudbase.service.StartCommandValidator;
import com.cloudbase.service.VolumeMountValidator;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Generates Docker Compose YAML for Portainer stacks.
 * Uses a shared external network so Nginx Proxy Manager can reach containers by name.
 * Every stack includes a scoped Watchtower sidecar + persistent bind volumes.
 */
@Component
public class ComposeGenerator {

    private final PlatformSettingsService settings;
    private final boolean watchtowerEnabled;

    public ComposeGenerator(
            PlatformSettingsService settings,
            @Value("${cloudbase.watchtower.enabled:true}") boolean watchtowerEnabled
    ) {
        this.settings = settings;
        this.watchtowerEnabled = watchtowerEnabled;
    }

    private String sharedNetwork() {
        String n = settings.get(PlatformSettingsService.DOCKER_NETWORK);
        return StringUtils.hasText(n) ? n : "cloudbase";
    }

    private String volumeRoot() {
        String root = settings.get(PlatformSettingsService.VOLUME_ROOT);
        return StringUtils.hasText(root) ? root : "/var/lib/cloudbase/users";
    }

    private String dockerHubNamespace() {
        String ns = settings.get(PlatformSettingsService.DOCKERHUB_NAMESPACE);
        return StringUtils.hasText(ns) ? ns : "cloudbase";
    }

    public String generateCompose(ServiceEntity service, String userId) {
        return generateCompose(service, userId, null);
    }

    public String generateCompose(ServiceEntity service, String userId, String imageTagOverride) {
        return switch (service.getSourceType()) {
            case GITHUB -> generateGitHubCompose(service, userId, imageTagOverride);
            case DOCKER -> generateDockerCompose(service, userId, imageTagOverride);
            case DATABASE -> generateDatabaseCompose(service, userId);
        };
    }

    /** Portainer stack env array: [{name, value}, ...] - secrets + app vars + DB passwords. */
    public List<Map<String, String>> buildPortainerEnv(ServiceEntity service, Map<String, String> extras) {
        Map<String, String> merged = new LinkedHashMap<>();
        if (service.getEnvVars() != null) {
            service.getEnvVars().forEach((k, v) -> {
                if (k != null && !k.isBlank()) {
                    merged.put(k, stringify(v));
                }
            });
        }
        if (extras != null) {
            merged.putAll(extras);
        }
        List<Map<String, String>> env = new ArrayList<>();
        merged.forEach((k, v) -> env.add(Map.of("name", k, "value", v == null ? "" : v)));
        return env;
    }

    public String resolveContainerName(ServiceEntity service) {
        if (service.getContainerName() != null && !service.getContainerName().isBlank()) {
            return service.getContainerName();
        }
        return "cb-" + service.getId();
    }

    /** Watchtower sidecar name - always tied to service id. */
    public String resolveWatchtowerContainerName(ServiceEntity service) {
        return "cb-wt-" + service.getId();
    }

    /**
     * Host bind-mount path for this service's data.
     * Pattern: {volumeRoot}/{ownerUserId}/{projectId}/{serviceId}
     */
    public String resolveVolumeHostPath(String ownerUserId, ServiceEntity service) {
        String userId = ownerUserId != null ? ownerUserId : "unknown";
        String projectId = service.getProject() != null ? service.getProject().getId() : "unknown";
        return resolveVolumePath(userId, projectId, service.getId());
    }

    /** Host folder for all service volumes under a project: {volumeRoot}/{owner}/{projectId} */
    public String resolveProjectVolumeHostPath(String ownerUserId, String projectId) {
        String userId = ownerUserId != null ? ownerUserId : "unknown";
        String pid = projectId != null ? projectId : "unknown";
        return volumeRoot() + "/" + userId + "/" + pid;
    }

    public String projectNetworkName(String projectId) {
        return "project-" + projectId;
    }

    public int resolveContainerPort(ServiceEntity service) {
        if (service.getContainerPort() != null && service.getContainerPort() > 0) {
            return service.getContainerPort();
        }
        if (service.getSourceType() == ServiceSourceType.DATABASE) {
            Map<String, Object> src = service.getSourceDetails();
            String dbTypeStr = String.valueOf(src != null ? src.getOrDefault("dbType", "POSTGRESQL") : "POSTGRESQL");
            return switch (DatabaseType.valueOf(dbTypeStr)) {
                case POSTGRESQL -> 5432;
                case MYSQL -> 3306;
                case REDIS -> 6379;
                case MONGODB -> 27017;
            };
        }
        Map<String, Object> src = service.getSourceDetails();
        if (src != null && src.get("containerPort") instanceof Number n) {
            return n.intValue();
        }
        return 8080;
    }

    private String generateGitHubCompose(ServiceEntity service, String userId, String imageTagOverride) {
        Map<String, Object> src = service.getSourceDetails() != null ? service.getSourceDetails() : Map.of();
        String tag = imageTagOverride != null && !imageTagOverride.isBlank()
                ? imageTagOverride
                : String.valueOf(src.getOrDefault("imageTag", "latest"));
        String imageName = String.valueOf(src.getOrDefault(
                "imageName",
                dockerHubNamespace() + "/" + sanitizeName(service.getName())
        ));
        String image = imageName.contains(":") ? imageName : imageName + ":" + tag;
        return appServiceCompose(service, userId, image);
    }

    private String generateDockerCompose(ServiceEntity service, String userId, String imageTagOverride) {
        Map<String, Object> src = service.getSourceDetails() != null ? service.getSourceDetails() : Map.of();
        String imageName = String.valueOf(src.getOrDefault("imageName", "nginx"));
        String tag = imageTagOverride != null && !imageTagOverride.isBlank()
                ? imageTagOverride
                : String.valueOf(src.getOrDefault("imageTag", "latest"));
        String image = imageName.contains(":") ? imageName : imageName + ":" + tag;
        return appServiceCompose(service, userId, image);
    }

    private String appServiceCompose(ServiceEntity service, String userId, String image) {
        String volumePath = resolveVolumePath(userId, service.getProject().getId(), service.getId());
        String mountPath = (service.getVolumeMountPath() != null && !service.getVolumeMountPath().isBlank())
                ? VolumeMountValidator.normalizeAndValidate(service.getVolumeMountPath())
                : "/data";
        String containerName = resolveContainerName(service);
        String svcKey = sanitizeName(service.getName());
        String scope = watchtowerScope(service);

        StringBuilder compose = new StringBuilder();
        compose.append("services:\n");
        compose.append("  ").append(svcKey).append(":\n");
        compose.append("    image: ").append(image).append("\n");
        compose.append("    container_name: ").append(containerName).append("\n");
        compose.append("    restart: unless-stopped\n");
        compose.append("    pull_policy: always\n");
        appendStartCommand(compose, service);
        compose.append("    labels:\n");
        compose.append("      com.centurylinklabs.watchtower.enable: \"true\"\n");
        compose.append("      com.centurylinklabs.watchtower.scope: \"").append(scope).append("\"\n");
        compose.append("    deploy:\n");
        compose.append("      resources:\n");
        compose.append("        limits:\n");
        compose.append("          memory: ").append(service.getQuotaMemoryMb()).append("M\n");
        compose.append("          cpus: '").append(service.getQuotaCpuMilli() / 1000.0).append("'\n");
        appendEnvReferences(compose, service);
        // Always persist data so a restart / Watchtower recreate keeps files.
        compose.append("    volumes:\n");
        compose.append("      - ").append(volumePath).append(":").append(mountPath).append("\n");
        appendNetworks(compose, service.getProject().getId());
        appendWatchtower(compose, service);
        appendNetworkDefinitions(compose, service.getProject().getId());
        return compose.toString();
    }

    private String generateDatabaseCompose(ServiceEntity service, String userId) {
        Map<String, Object> src = service.getSourceDetails() != null ? service.getSourceDetails() : Map.of();
        String dbTypeStr = String.valueOf(src.getOrDefault("dbType", "POSTGRESQL"));
        DatabaseType dbType = DatabaseType.valueOf(dbTypeStr);
        String volumePath = resolveVolumePath(userId, service.getProject().getId(), service.getId());
        return switch (dbType) {
            case POSTGRESQL -> databaseBlock(service, volumePath, "postgres:16-alpine",
                    List.of(
                            "POSTGRES_DB=" + sanitizeDbIdentifier(service.getName()),
                            "POSTGRES_USER=cbuser",
                            "POSTGRES_PASSWORD=${DB_PASSWORD}"
                    ), "/var/lib/postgresql/data");
            case MYSQL -> databaseBlock(service, volumePath, "mysql:8.0",
                    List.of(
                            "MYSQL_DATABASE=" + sanitizeDbIdentifier(service.getName()),
                            "MYSQL_USER=cbuser",
                            "MYSQL_PASSWORD=${DB_PASSWORD}",
                            "MYSQL_ROOT_PASSWORD=${DB_ROOT_PASSWORD}"
                    ), "/var/lib/mysql");
            case REDIS -> databaseBlock(service, volumePath, "redis:7-alpine",
                    List.of(), "/data", "redis-server --requirepass ${REDIS_PASSWORD}");
            case MONGODB -> databaseBlock(service, volumePath, "mongo:7",
                    List.of(
                            "MONGO_INITDB_ROOT_USERNAME=cbuser",
                            "MONGO_INITDB_ROOT_PASSWORD=${MONGO_PASSWORD}"
                    ), "/data/db");
        };
    }

    private String databaseBlock(
            ServiceEntity service,
            String volumePath,
            String image,
            List<String> envLines,
            String dataPath
    ) {
        return databaseBlock(service, volumePath, image, envLines, dataPath, null);
    }

    private String databaseBlock(
            ServiceEntity service,
            String volumePath,
            String image,
            List<String> envLines,
            String dataPath,
            String command
    ) {
        String scope = watchtowerScope(service);
        StringBuilder compose = new StringBuilder();
        compose.append("services:\n");
        compose.append("  ").append(sanitizeName(service.getName())).append(":\n");
        compose.append("    image: ").append(image).append("\n");
        compose.append("    container_name: ").append(resolveContainerName(service)).append("\n");
        compose.append("    restart: unless-stopped\n");
        // Never auto-upgrade DB engines via Watchtower (data/compat risk).
        compose.append("    labels:\n");
        compose.append("      com.centurylinklabs.watchtower.enable: \"false\"\n");
        compose.append("      com.centurylinklabs.watchtower.scope: \"").append(scope).append("\"\n");
        if (command != null) {
            compose.append("    command: ").append(command).append("\n");
        }
        if (!envLines.isEmpty()) {
            compose.append("    environment:\n");
            for (String line : envLines) {
                String[] parts = line.split("=", 2);
                compose.append("      ").append(parts[0]).append(": ").append(parts[1]).append("\n");
            }
        }
        compose.append("    volumes:\n");
        compose.append("      - ").append(volumePath).append(":").append(dataPath).append("\n");
        compose.append("    deploy:\n");
        compose.append("      resources:\n");
        compose.append("        limits:\n");
        compose.append("          memory: ").append(service.getQuotaMemoryMb()).append("M\n");
        appendNetworks(compose, service.getProject().getId());
        // Still ship Watchtower so stopped app siblings in same scope can revive;
        // DB itself stays disabled via enable=false.
        appendWatchtower(compose, service);
        appendNetworkDefinitions(compose, service.getProject().getId());
        return compose.toString();
    }

    /**
     * Sidecar: polls for new images and can revive stopped containers in this stack's scope.
     */
    private void appendWatchtower(StringBuilder compose, ServiceEntity service) {
        if (!watchtowerEnabled) {
            return;
        }
        String scope = watchtowerScope(service);
        String wtName = "cb-wt-" + service.getId();
        // nickfedor fork: containrrr 1.7.1 speaks Docker API 1.25; modern engines require >= 1.40
        compose.append("  watchtower:\n");
        compose.append("    image: nickfedor/watchtower:1.21.0\n");
        compose.append("    container_name: ").append(wtName).append("\n");
        compose.append("    restart: unless-stopped\n");
        compose.append("    volumes:\n");
        compose.append("      - /var/run/docker.sock:/var/run/docker.sock\n");
        compose.append("    environment:\n");
        compose.append("      WATCHTOWER_LABEL_ENABLE: \"true\"\n");
        compose.append("      WATCHTOWER_SCOPE: \"").append(scope).append("\"\n");
        compose.append("      WATCHTOWER_CLEANUP: \"true\"\n");
        compose.append("      WATCHTOWER_INCLUDE_STOPPED: \"true\"\n");
        compose.append("      WATCHTOWER_REVIVE_STOPPED: \"true\"\n");
        compose.append("      WATCHTOWER_POLL_INTERVAL: \"300\"\n");
        compose.append("      DOCKER_API_VERSION: \"1.44\"\n");
        compose.append("    labels:\n");
        compose.append("      com.centurylinklabs.watchtower.enable: \"false\"\n");
        compose.append("    deploy:\n");
        compose.append("      resources:\n");
        compose.append("        limits:\n");
        compose.append("          memory: 64M\n");
        compose.append("          cpus: '0.10'\n");
        // Docker socket only - no app network required
    }

    private static String watchtowerScope(ServiceEntity service) {
        return "cb-" + service.getId();
    }

    /**
     * Override image CMD with a validated exec-form start command (no shell).
     */
    private void appendStartCommand(StringBuilder compose, ServiceEntity service) {
        Map<String, Object> src = service.getSourceDetails() != null ? service.getSourceDetails() : Map.of();
        Object raw = src.get("startCommand");
        if (raw == null) {
            return;
        }
        var validated = StartCommandValidator.validateOrNull(String.valueOf(raw));
        if (validated == null || validated.argv().isEmpty()) {
            return;
        }
        compose.append("    command:\n");
        for (String arg : validated.argv()) {
            compose.append("      - ").append(yamlDoubleQuoted(arg)).append("\n");
        }
    }

    private static String yamlDoubleQuoted(String value) {
        return "\"" + value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                + "\"";
    }

    /**
     * Reference env keys as ${KEY} so Portainer stack env supplies values at deploy time.
     * Concrete values are not baked into YAML (safer for secrets / redeploys).
     */
    private void appendEnvReferences(StringBuilder compose, ServiceEntity service) {
        if (service.getEnvVars() == null || service.getEnvVars().isEmpty()) {
            return;
        }
        compose.append("    environment:\n");
        service.getEnvVars().keySet().stream().sorted().forEach(key ->
                compose.append("      ").append(key).append(": ${").append(key).append("}\n")
        );
    }

    private void appendNetworks(StringBuilder compose, String projectId) {
        compose.append("    networks:\n");
        compose.append("      - project-").append(projectId).append("\n");
        compose.append("      - ").append(sharedNetwork()).append("\n");
    }

    private void appendNetworkDefinitions(StringBuilder compose, String projectId) {
        compose.append("networks:\n");
        // Per-project network is created with the stack (not pre-existing).
        compose.append("  project-").append(projectId).append(":\n");
        compose.append("    driver: bridge\n");
        // Shared cloudbase network must already exist (NPM + other stacks).
        compose.append("  ").append(sharedNetwork()).append(":\n");
        compose.append("    external: true\n");
    }

    private String resolveVolumePath(String userId, String projectId, String serviceId) {
        return volumeRoot() + "/" + userId + "/" + projectId + "/" + serviceId;
    }

    /** Compose service key / container-friendly slug (hyphens ok). */
    private String sanitizeName(String name) {
        return name.toLowerCase().replaceAll("[^a-z0-9-]", "-");
    }

    /** MySQL/Postgres DB names cannot contain hyphens. */
    private String sanitizeDbIdentifier(String name) {
        String s = name.toLowerCase().replaceAll("[^a-z0-9_]", "_").replaceAll("_+", "_");
        if (s.isBlank()) {
            return "appdb";
        }
        if (Character.isDigit(s.charAt(0))) {
            s = "db_" + s;
        }
        return s.length() > 63 ? s.substring(0, 63) : s;
    }

    private static String stringify(Object v) {
        if (v == null) return "";
        if (v instanceof Map<?, ?> m && m.containsKey("value")) {
            return String.valueOf(m.get("value"));
        }
        return String.valueOf(v);
    }
}
