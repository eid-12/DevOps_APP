package com.cloudbase.portainer;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.service.PlatformSettingsService;
import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Tenant stacks must never join the platform network ("cloudbase"), which also holds the platform database,
 * the API and Portainer. Apps join only their project network and the tenant ingress network; databases join
 * only their project network. Every tenant container drops privilege escalation and has a process cap.
 */
class ComposeNetworkIsolationTest {

    private static final String PLATFORM_NETWORK = "cloudbase";

    private static ComposeGenerator generator() {
        PlatformSettingsService settings = mock(PlatformSettingsService.class);
        when(settings.get(PlatformSettingsService.DOCKER_NETWORK)).thenReturn(PLATFORM_NETWORK);
        when(settings.get(PlatformSettingsService.VOLUME_ROOT)).thenReturn("/var/lib/cloudbase/users");
        when(settings.get(PlatformSettingsService.DOCKERHUB_NAMESPACE)).thenReturn("minipcer");
        return new ComposeGenerator(settings, true, "cloudbase-tenants", "nginx-proxy");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> stack(String fixture) {
        ServiceEntity s = ComposeFixtures.all().get(fixture);
        return (Map<String, Object>) new Yaml().load(generator().generateCompose(s, ComposeFixtures.OWNER, null));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> tenantService(Map<String, Object> root) {
        return (Map<String, Object>) ((Map<String, Object>) root.get("services")).values().iterator().next();
    }

    @Test
    void noTenantStackJoinsThePlatformNetwork() {
        for (String fixture : ComposeFixtures.all().keySet()) {
            Map<String, Object> root = stack(fixture);
            assertFalse(((Map<?, ?>) root.get("networks")).containsKey(PLATFORM_NETWORK), fixture);
            assertFalse(((List<?>) tenantService(root).get("networks")).contains(PLATFORM_NETWORK), fixture);
        }
    }

    @Test
    void appsJoinOnlyTheirProjectAndTheTenantIngressNetwork() {
        for (String fixture : List.of("docker", "github")) {
            assertEquals(List.of("project-proj-1", "cloudbase-tenants"), tenantService(stack(fixture)).get("networks"), fixture);
        }
    }

    @Test
    void databasesAreReachableOnlyInsideTheirProject() {
        int checked = 0;
        for (Map.Entry<String, ServiceEntity> e : ComposeFixtures.all().entrySet()) {
            if (e.getValue().getSourceType() != ServiceSourceType.DATABASE) continue;
            Map<String, Object> root = stack(e.getKey());
            assertEquals(List.of("project-proj-1"), tenantService(root).get("networks"), e.getKey());
            assertEquals(List.of("project-proj-1"), List.copyOf(((Map<?, ?>) root.get("networks")).keySet()), e.getKey());
            checked++;
        }
        assertEquals(4, checked);
    }

    @Test
    @SuppressWarnings("unchecked")
    void tenantContainersCannotEscalateAndHaveAProcessCap() {
        for (String fixture : ComposeFixtures.all().keySet()) {
            Map<String, Object> svc = tenantService(stack(fixture));
            assertEquals(List.of("no-new-privileges:true"), svc.get("security_opt"), fixture);
            Map<String, Object> limits = (Map<String, Object>) ((Map<String, Object>) ((Map<String, Object>) svc.get("deploy"))
                    .get("resources")).get("limits");
            assertTrue(limits.containsKey("pids"), fixture);
        }
    }
}
