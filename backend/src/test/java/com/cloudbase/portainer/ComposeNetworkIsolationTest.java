package com.cloudbase.portainer;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.service.PlatformSettingsService;
import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Every tenant stack joins exactly one network: its project's, created by the platform under a fixed name so a
 * project's app and database stacks meet on it. Tenant stacks never join the platform network ("cloudbase"),
 * which holds the platform database, the API and Portainer, nor a network shared with other projects.
 * Every tenant container drops privilege escalation and has a process cap.
 */
class ComposeNetworkIsolationTest {

    private static ComposeGenerator generator() {
        PlatformSettingsService settings = mock(PlatformSettingsService.class);
        when(settings.get(PlatformSettingsService.DOCKER_NETWORK)).thenReturn("cloudbase");
        when(settings.get(PlatformSettingsService.VOLUME_ROOT)).thenReturn("/var/lib/cloudbase/users");
        when(settings.get(PlatformSettingsService.DOCKERHUB_NAMESPACE)).thenReturn("minipcer");
        return new ComposeGenerator(settings, true, "nginx-proxy");
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
    void everyTenantStackJoinsOnlyItsProjectNetwork() {
        for (String fixture : ComposeFixtures.all().keySet()) {
            Map<String, Object> root = stack(fixture);
            assertEquals(List.of("project-proj-1"), tenantService(root).get("networks"), fixture);
            assertEquals(Map.of("project-proj-1", Map.of("external", true, "name", "project-proj-1")), root.get("networks"), fixture);
        }
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
