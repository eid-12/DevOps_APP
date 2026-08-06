package com.cloudbase.portainer;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.model.DatabaseType;
import com.cloudbase.model.ServiceSourceType;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Generates Docker Compose YAML for Portainer stacks.
 * Uses a shared external network so Nginx Proxy Manager can reach containers by name.
 */
@Component
public class ComposeGenerator {

    private final String sharedNetwork;
    private final String volumeRoot;
    private final String dockerHubNamespace;

    public ComposeGenerator(
            @Value("${cloudbase.docker.network:cloudbase}") String sharedNetwork,
            @Value("${cloudbase.volume.root:/mnt/c/CloudBase/UsersData}") String volumeRoot,
            @Value("${cloudbase.dockerhub.namespace:cloudbase}") String dockerHubNamespace
    ) {
        this.sharedNetwork = sharedNetwork;
        this.volumeRoot = volumeRoot;
        this.dockerHubNamespace = dockerHubNamespace;
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

    /** Portainer stack env array: [{name, value}, ...] — secrets + app vars + DB passwords. */
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
                dockerHubNamespace + "/" + sanitizeName(service.getName())
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
        String containerName = resolveContainerName(service);
        String svcKey = sanitizeName(service.getName());

        StringBuilder compose = new StringBuilder();
        compose.append("services:\n");
        compose.append("  ").append(svcKey).append(":\n");
        compose.append("    image: ").append(image).append("\n");
        compose.append("    container_name: ").append(containerName).append("\n");
        compose.append("    restart: unless-stopped\n");
        compose.append("    pull_policy: always\n");
        compose.append("    deploy:\n");
        compose.append("      resources:\n");
        compose.append("        limits:\n");
        compose.append("          memory: ").append(service.getQuotaMemoryMb()).append("M\n");
        compose.append("          cpus: '").append(service.getQuotaCpuMilli() / 1000.0).append("'\n");
        appendEnvReferences(compose, service);
        if (service.getVolumeMountPath() != null && !service.getVolumeMountPath().isBlank()) {
            compose.append("    volumes:\n");
            compose.append("      - ").append(volumePath).append(":").append(service.getVolumeMountPath()).append("\n");
        }
        appendNetworks(compose, service.getProject().getId());
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
                            "POSTGRES_DB=" + sanitizeName(service.getName()),
                            "POSTGRES_USER=cbuser",
                            "POSTGRES_PASSWORD=${DB_PASSWORD}"
                    ), "/var/lib/postgresql/data");
            case MYSQL -> databaseBlock(service, volumePath, "mysql:8.0",
                    List.of(
                            "MYSQL_DATABASE=" + sanitizeName(service.getName()),
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
        StringBuilder compose = new StringBuilder();
        compose.append("services:\n");
        compose.append("  ").append(sanitizeName(service.getName())).append(":\n");
        compose.append("    image: ").append(image).append("\n");
        compose.append("    container_name: ").append(resolveContainerName(service)).append("\n");
        compose.append("    restart: unless-stopped\n");
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
        appendNetworkDefinitions(compose, service.getProject().getId());
        return compose.toString();
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
        compose.append("      - ").append(sharedNetwork).append("\n");
    }

    private void appendNetworkDefinitions(StringBuilder compose, String projectId) {
        compose.append("networks:\n");
        // Per-project network is created with the stack (not pre-existing).
        compose.append("  project-").append(projectId).append(":\n");
        compose.append("    driver: bridge\n");
        // Shared cloudbase network must already exist (NPM + other stacks).
        compose.append("  ").append(sharedNetwork).append(":\n");
        compose.append("    external: true\n");
    }

    private String resolveVolumePath(String userId, String projectId, String serviceId) {
        return volumeRoot + "/" + userId + "/" + projectId + "/" + serviceId;
    }

    private String sanitizeName(String name) {
        return name.toLowerCase().replaceAll("[^a-z0-9-]", "-");
    }

    private static String stringify(Object v) {
        if (v == null) return "";
        if (v instanceof Map<?, ?> m && m.containsKey("value")) {
            return String.valueOf(m.get("value"));
        }
        return String.valueOf(v);
    }
}
