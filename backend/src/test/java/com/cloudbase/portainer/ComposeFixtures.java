package com.cloudbase.portainer;

import com.cloudbase.entity.ProjectEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.model.ServiceSourceType;

import java.util.LinkedHashMap;
import java.util.Map;

/** Representative services for compose generation tests. */
final class ComposeFixtures {

    private ComposeFixtures() {
    }

    static final String OWNER = "u-owner1";

    static Map<String, ServiceEntity> all() {
        Map<String, ServiceEntity> m = new LinkedHashMap<>();
        Map<String, Object> docker = new LinkedHashMap<>();
        docker.put("imageName", "nginx");
        docker.put("imageTag", "1.27-alpine");
        docker.put("startCommand", "node server.js --port 8080");
        Map<String, Object> env = new LinkedHashMap<>();
        env.put("API_URL", Map.of("value", "https://example.test", "isSecret", false));
        env.put("SECRET_TOKEN", Map.of("value", "s3cret", "isSecret", true));
        m.put("docker", service("svc-dock1", "Web App", ServiceSourceType.DOCKER, docker, env, "/app/data"));

        Map<String, Object> gh = new LinkedHashMap<>();
        gh.put("imageName", "minipcer/web-app-gh1");
        gh.put("repositoryUrl", "https://github.com/tenant/app");
        m.put("github", service("svc-gh1", "web-app", ServiceSourceType.GITHUB, gh, Map.of(), null));

        for (String db : new String[]{"POSTGRESQL", "MYSQL", "REDIS", "MONGODB"}) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("dbType", db);
            m.put(db.toLowerCase(), service("svc-" + db.toLowerCase(), "my-db", ServiceSourceType.DATABASE, d, Map.of(), null));
        }
        return m;
    }

    private static ServiceEntity service(String id, String name, ServiceSourceType type,
                                         Map<String, Object> src, Map<String, Object> env, String mount) {
        ServiceEntity s = ServiceEntity.builder()
                .id(id).name(name).sourceType(type).sourceDetails(src).envVars(env)
                .volumeMountPath(mount).quotaMemoryMb(256).quotaCpuMilli(250)
                .project(ProjectEntity.builder().id("proj-1").ownerId(OWNER).name("p").build())
                .build();
        s.setContainerName("cb-" + id);
        return s;
    }
}
