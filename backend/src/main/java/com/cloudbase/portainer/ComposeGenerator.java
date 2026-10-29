package com.cloudbase.portainer;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.model.DatabaseType;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.service.ComposeInputValidator;
import com.cloudbase.service.PlatformSettingsService;
import com.cloudbase.service.StartCommandValidator;
import com.cloudbase.service.VolumeMountValidator;
import org.springframework.beans.factory.annotation.Value;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.Yaml;
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
        // Never emit a 0/negative limit: Docker would read it as "unlimited".
        ComposeInputValidator.requireResourceLimits(
                service.getQuotaMemoryMb(), service.getQuotaCpuMilli(), Math.max(0, service.getQuotaStorageGb()));
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
        return appServiceCompose(service, userId, imageReference(imageName, tag));
    }

    private String generateDockerCompose(ServiceEntity service, String userId, String imageTagOverride) {
        Map<String, Object> src = service.getSourceDetails() != null ? service.getSourceDetails() : Map.of();
        String imageName = String.valueOf(src.getOrDefault("imageName", "nginx"));
        String tag = imageTagOverride != null && !imageTagOverride.isBlank()
                ? imageTagOverride
                : String.valueOf(src.getOrDefault("imageTag", "latest"));
        return appServiceCompose(service, userId, imageReference(imageName, tag));
    }

    private String appServiceCompose(ServiceEntity service, String userId, String image) {
        String volumePath = resolveVolumePath(userId, service.getProject().getId(), service.getId());
        String mountPath = (service.getVolumeMountPath() != null && !service.getVolumeMountPath().isBlank())
                ? VolumeMountValidator.normalizeAndValidate(service.getVolumeMountPath())
                : "/data";

        Map<String, Object> app = new LinkedHashMap<>();
        app.put("image", image);
        app.put("container_name", resolveContainerName(service));
        app.put("restart", "unless-stopped");
        app.put("pull_policy", "always");
        List<String> command = startCommand(service);
        if (!command.isEmpty()) {
            app.put("command", command);
        }
        app.put("labels", watchtowerLabels(true, watchtowerScope(service)));
        app.put("deploy", limits(service.getQuotaMemoryMb() + "M", String.valueOf(service.getQuotaCpuMilli() / 1000.0)));
        Map<String, Object> env = envReferences(service);
        if (!env.isEmpty()) {
            app.put("environment", env);
        }
        // Always persist data so a restart / Watchtower recreate keeps files.
        app.put("volumes", List.of(volumePath + ":" + mountPath));
        app.put("networks", serviceNetworks(service.getProject().getId()));
        return stack(sanitizeName(service.getName()), app, service);
    }

    private String generateDatabaseCompose(ServiceEntity service, String userId) {
        Map<String, Object> src = service.getSourceDetails() != null ? service.getSourceDetails() : Map.of();
        String dbTypeStr = String.valueOf(src.getOrDefault("dbType", "POSTGRESQL"));
        DatabaseType dbType = DatabaseType.valueOf(dbTypeStr);
        String volumePath = resolveVolumePath(userId, service.getProject().getId(), service.getId());
        String dbName = sanitizeDbIdentifier(service.getName());
        // Passwords are ${...} references; Portainer's stack env supplies the generated values.
        return switch (dbType) {
            case POSTGRESQL -> databaseBlock(service, volumePath, "postgres:16-alpine", orderedMap(
                    "POSTGRES_DB", dbName,
                    "POSTGRES_USER", "cbuser",
                    "POSTGRES_PASSWORD", "${DB_PASSWORD}"
            ), "/var/lib/postgresql/data", null);
            case MYSQL -> databaseBlock(service, volumePath, "mysql:8.0", orderedMap(
                    "MYSQL_DATABASE", dbName,
                    "MYSQL_USER", "cbuser",
                    "MYSQL_PASSWORD", "${DB_PASSWORD}",
                    "MYSQL_ROOT_PASSWORD", "${DB_ROOT_PASSWORD}"
            ), "/var/lib/mysql", null);
            case REDIS -> databaseBlock(service, volumePath, "redis:7-alpine", Map.of(),
                    "/data", "redis-server --requirepass ${REDIS_PASSWORD}");
            case MONGODB -> databaseBlock(service, volumePath, "mongo:7", orderedMap(
                    "MONGO_INITDB_ROOT_USERNAME", "cbuser",
                    "MONGO_INITDB_ROOT_PASSWORD", "${MONGO_PASSWORD}"
            ), "/data/db", null);
        };
    }

    private String databaseBlock(
            ServiceEntity service,
            String volumePath,
            String image,
            Map<String, Object> env,
            String dataPath,
            String command
    ) {
        Map<String, Object> db = new LinkedHashMap<>();
        db.put("image", image);
        db.put("container_name", resolveContainerName(service));
        db.put("restart", "unless-stopped");
        // Never auto-upgrade DB engines via Watchtower (data/compat risk).
        db.put("labels", watchtowerLabels(false, watchtowerScope(service)));
        if (command != null) {
            db.put("command", command);
        }
        if (!env.isEmpty()) {
            db.put("environment", env);
        }
        db.put("volumes", List.of(volumePath + ":" + dataPath));
        db.put("deploy", Map.of("resources", Map.of("limits", orderedMap("memory", service.getQuotaMemoryMb() + "M"))));
        db.put("networks", serviceNetworks(service.getProject().getId()));
        // Still ship Watchtower so stopped app siblings in same scope can revive;
        // DB itself stays disabled via enable=false.
        return stack(sanitizeName(service.getName()), db, service);
    }

    /** One stack: the service, the optional Watchtower sidecar, and the network definitions. */
    private String stack(String serviceKey, Map<String, Object> serviceDef, ServiceEntity service) {
        Map<String, Object> services = new LinkedHashMap<>();
        services.put(serviceKey, serviceDef);
        if (watchtowerEnabled) {
            services.put("watchtower", watchtower(service));
        }
        Map<String, Object> networks = new LinkedHashMap<>();
        // Per-project network is created with the stack; the shared network must already exist (NPM + other stacks).
        networks.put(projectNetworkName(service.getProject().getId()), Map.of("driver", "bridge"));
        networks.put(sharedNetwork(), Map.of("external", true));
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("services", services);
        root.put("networks", networks);
        return toYaml(root);
    }

    /**
     * Sidecar: polls for new images and can revive stopped containers in this stack's scope.
     */
    private Map<String, Object> watchtower(ServiceEntity service) {
        Map<String, Object> wt = new LinkedHashMap<>();
        // nickfedor fork: containrrr 1.7.1 speaks Docker API 1.25; modern engines require >= 1.40
        wt.put("image", "nickfedor/watchtower:1.21.0");
        wt.put("container_name", resolveWatchtowerContainerName(service));
        wt.put("restart", "unless-stopped");
        wt.put("volumes", List.of("/var/run/docker.sock:/var/run/docker.sock"));
        wt.put("environment", orderedMap(
                "WATCHTOWER_LABEL_ENABLE", "true",
                "WATCHTOWER_SCOPE", watchtowerScope(service),
                "WATCHTOWER_CLEANUP", "true",
                "WATCHTOWER_INCLUDE_STOPPED", "true",
                "WATCHTOWER_REVIVE_STOPPED", "true",
                "WATCHTOWER_POLL_INTERVAL", "300",
                "DOCKER_API_VERSION", "1.44"
        ));
        wt.put("labels", orderedMap("com.centurylinklabs.watchtower.enable", "false"));
        wt.put("deploy", limits("64M", "0.10"));
        // Docker socket only - no app network required
        return wt;
    }

    private static Map<String, Object> watchtowerLabels(boolean enable, String scope) {
        return orderedMap(
                "com.centurylinklabs.watchtower.enable", enable ? "true" : "false",
                "com.centurylinklabs.watchtower.scope", scope
        );
    }

    private static Map<String, Object> limits(String memory, String cpus) {
        return Map.of("resources", Map.of("limits", orderedMap("memory", memory, "cpus", cpus)));
    }

    private static String watchtowerScope(ServiceEntity service) {
        return "cb-" + service.getId();
    }

    /**
     * Override image CMD with a validated exec-form start command (no shell).
     */
    private static List<String> startCommand(ServiceEntity service) {
        Map<String, Object> src = service.getSourceDetails() != null ? service.getSourceDetails() : Map.of();
        Object raw = src.get("startCommand");
        if (raw == null) {
            return List.of();
        }
        var validated = StartCommandValidator.validateOrNull(String.valueOf(raw));
        return validated == null ? List.of() : validated.argv();
    }

    /** Validated {@code name:tag}, or the name as given when it already carries a tag or digest. */
    static String imageReference(String imageName, String tag) {
        String name = ComposeInputValidator.requireImage(imageName.trim());
        boolean hasTagOrDigest = name.contains("@") || name.lastIndexOf(':') > name.lastIndexOf('/');
        return hasTagOrDigest ? name : name + ":" + ComposeInputValidator.requireImageTag(tag.trim());
    }

    /**
     * Reference env keys as ${KEY} so Portainer stack env supplies values at deploy time.
     * Concrete values are not baked into YAML (safer for secrets / redeploys).
     */
    private static Map<String, Object> envReferences(ServiceEntity service) {
        Map<String, Object> env = new LinkedHashMap<>();
        if (service.getEnvVars() != null) {
            service.getEnvVars().keySet().stream().sorted().forEach(key ->
                    env.put(ComposeInputValidator.requireEnvKey(key), "${" + key + "}"));
        }
        return env;
    }

    private List<String> serviceNetworks(String projectId) {
        return List.of(projectNetworkName(projectId), sharedNetwork());
    }

    private static Map<String, Object> orderedMap(String... keyValues) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) {
            m.put(keyValues[i], keyValues[i + 1]);
        }
        return m;
    }

    /** All compose text goes through the YAML serializer, which quotes/escapes every value it emits. */
    private static String toYaml(Map<String, Object> root) {
        DumperOptions options = new DumperOptions();
        options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
        options.setIndent(2);
        options.setIndicatorIndent(2);
        options.setIndentWithIndicator(true);
        options.setSplitLines(false);
        return new Yaml(options).dump(root);
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
