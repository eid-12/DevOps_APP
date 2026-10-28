package com.cloudbase.portainer;

import com.cloudbase.entity.ProjectEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.service.PlatformSettingsService;
import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

/**
 * Tenant-controlled values (image, tag, env keys) end up in the compose YAML sent to Portainer.
 * None of them may be able to add keys such as privileged or host mounts.
 */
class ComposeGeneratorInjectionTest {

    private static final String BREAKOUT = "\n    privileged: true\n    volumes:\n      - /:/host";

    private final ComposeGenerator generator = new ComposeGenerator(mock(PlatformSettingsService.class), false);

    private ServiceEntity dockerService(String image, Map<String, Object> env) {
        Map<String, Object> src = new HashMap<>();
        src.put("imageName", image);
        return ServiceEntity.builder()
                .id("svc-1").name("web").sourceType(ServiceSourceType.DOCKER)
                .sourceDetails(src).envVars(env).quotaMemoryMb(256).quotaCpuMilli(250)
                .project(ProjectEntity.builder().id("proj-1").ownerId("u-1").name("p").build())
                .build();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> appService(String compose) {
        Map<String, Object> doc = new Yaml().load(compose);
        return (Map<String, Object>) ((Map<String, Object>) doc.get("services")).get("web");
    }

    @Test
    void validImageProducesQuotedImageAndOnlyTheTenantVolume() {
        Map<String, Object> svc = appService(generator.generateCompose(dockerService("nginx", Map.of("API_URL", "x")), "u-1", "1.27-alpine"));
        assertEquals("nginx:1.27-alpine", svc.get("image"));
        assertFalse(svc.containsKey("privileged"));
        assertEquals(1, ((List<?>) svc.get("volumes")).size());
    }

    @Test
    void maliciousTagIsRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> generator.generateCompose(dockerService("nginx", Map.of()), "u-1", "latest" + BREAKOUT));
    }

    @Test
    void maliciousImageNameIsRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> generator.generateCompose(dockerService("nginx:latest" + BREAKOUT, Map.of()), "u-1", null));
    }

    @Test
    void maliciousEnvKeyIsRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> generator.generateCompose(dockerService("nginx", Map.of("X: 1" + BREAKOUT + "\n    Y", "v")), "u-1", null));
    }
}
