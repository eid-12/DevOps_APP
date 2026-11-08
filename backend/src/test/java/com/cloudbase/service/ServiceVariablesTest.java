package com.cloudbase.service;

import com.cloudbase.email.EmailService;
import com.cloudbase.entity.ProjectEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.npm.NpmClient;
import com.cloudbase.portainer.ComposeGenerator;
import com.cloudbase.portainer.PortainerClient;
import com.cloudbase.repository.DeploymentRepository;
import com.cloudbase.repository.ServiceRepository;
import com.cloudbase.repository.UserRepository;
import com.cloudbase.model.ServiceSourceType;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Project shared variables follow the project; variable references resolve within the project only. */
class ServiceVariablesTest {

    private final ServiceRepository services = mock(ServiceRepository.class);
    private final DeploymentOrchestrator orchestrator = new DeploymentOrchestrator(
            services, mock(DeploymentRepository.class), mock(ComposeGenerator.class), mock(PortainerClient.class),
            mock(NpmClient.class), mock(DeploymentEventPublisher.class), mock(NotificationService.class),
            mock(PlatformSettingsService.class), WebClient.builder(), mock(VanitySubdomainService.class),
            mock(TransactionTemplate.class), mock(UserRepository.class), mock(EmailService.class),
            mock(com.cloudbase.portainer.EdgeRouter.class), mock(com.cloudbase.portainer.TenantIsolationVerifier.class));

    private static Map<String, Object> shared(String key, String value, String... serviceIds) {
        Map<String, Object> v = new HashMap<>();
        v.put("id", "svar-" + key);
        v.put("key", key);
        v.put("value", value);
        v.put("isSecret", false);
        v.put("serviceIds", List.of(serviceIds));
        return v;
    }

    private static ServiceEntity service(String id, String name, ProjectEntity project, Map<String, Object> env) {
        return ServiceEntity.builder().id(id).name(name).sourceType(ServiceSourceType.DOCKER)
                .envVars(new LinkedHashMap<>(env)).project(project).build();
    }

    private static String value(ServiceEntity s, String key) {
        return String.valueOf(((Map<?, ?>) s.getEnvVars().get(key)).get("value"));
    }

    @Test
    void sharedVariablesAreAddedUpdatedAndRemovedWithTheProject() {
        ProjectEntity project = ProjectEntity.builder().id("p").ownerId("u").name("p")
                .sharedVariables(new ArrayList<>(List.of(shared("API_KEY", "one", "svc-a")))).build();
        ServiceEntity app = service("svc-a", "app", project, Map.of());

        orchestrator.mergeSharedVariables(app, new HashMap<>());
        assertEquals("one", value(app, "API_KEY"));

        project.setSharedVariables(new ArrayList<>(List.of(shared("API_KEY", "two", "svc-a"))));
        orchestrator.mergeSharedVariables(app, new HashMap<>());
        assertEquals("two", value(app, "API_KEY"), "a changed shared value reaches the service");

        project.setSharedVariables(new ArrayList<>());
        orchestrator.mergeSharedVariables(app, new HashMap<>());
        assertFalse(app.getEnvVars().containsKey("API_KEY"), "a deleted shared variable must not linger");
    }

    @Test
    void unassigningASharedVariableRemovesItButTheServicesOwnValueWins() {
        ProjectEntity project = ProjectEntity.builder().id("p").ownerId("u").name("p")
                .sharedVariables(new ArrayList<>(List.of(shared("MODE", "shared", "svc-a"), shared("TOKEN", "t", "svc-a"))))
                .build();
        ServiceEntity app = service("svc-a", "app", project, Map.of("MODE", Map.of("value", "mine", "isSecret", false)));

        orchestrator.mergeSharedVariables(app, new HashMap<>());
        assertEquals("mine", value(app, "MODE"), "the service's own variable overrides the project one");
        assertEquals("t", value(app, "TOKEN"));

        project.setSharedVariables(new ArrayList<>(List.of(shared("MODE", "shared", "svc-a"), shared("TOKEN", "t"))));
        orchestrator.mergeSharedVariables(app, new HashMap<>());
        assertFalse(app.getEnvVars().containsKey("TOKEN"), "unassigned from this service");
        assertEquals("mine", value(app, "MODE"), "the service's own variable is never removed");
    }

    @Test
    void referencesResolveFromTheProjectAndItsOtherServicesOnly() {
        ProjectEntity project = ProjectEntity.builder().id("p").ownerId("u").name("p")
                .sharedVariables(new ArrayList<>(List.of(shared("REGION", "eu", "svc-x")))).build();
        ServiceEntity app = service("svc-a", "app", project, Map.of());
        ServiceEntity db = service("svc-db", "Main DB", project, Map.of("DB_PASSWORD", Map.of("value", "p@ss$1", "isSecret", true)));
        when(services.findByProject_Id("p")).thenReturn(List.of(app, db));

        List<Map<String, String>> out = orchestrator.resolveReferences(app, List.of(
                Map.of("name", "DATABASE_URL", "value", "postgres://cbuser:${{ main db.DB_PASSWORD }}@main-db:5432/main_db"),
                Map.of("name", "REGION", "value", "${{Project.REGION}}"),
                Map.of("name", "OTHER", "value", "${{stranger.SECRET}}"),
                Map.of("name", "PLAIN", "value", "no refs")), null);

        assertEquals("postgres://cbuser:p@ss$1@main-db:5432/main_db", out.get(0).get("value"));
        assertEquals("eu", out.get(1).get("value"));
        assertEquals("${{stranger.SECRET}}", out.get(2).get("value"), "unknown references stay visible, never guessed");
        assertEquals("no refs", out.get(3).get("value"));
    }

    @Test
    void aDatabaseReferenceKeepsWorkingAfterTheDatabaseIsRenamed() {
        ProjectEntity project = ProjectEntity.builder().id("p").ownerId("u").name("p").build();
        ServiceEntity app = service("svc-a", "app", project, Map.of());
        ServiceEntity db = ServiceEntity.builder().id("svc-db").name("Orders Database").sourceType(ServiceSourceType.DATABASE)
                .sourceDetails(Map.of("dbType", "POSTGRESQL", ComposeGenerator.HOST_NAME_KEY, "orders-db"))
                .envVars(Map.of("DB_PASSWORD", Map.of("value", "pw", "isSecret", true))).project(project).build();
        when(services.findByProject_Id("p")).thenReturn(List.of(app, db));

        List<Map<String, String>> out = orchestrator.resolveReferences(app, List.of(
                Map.of("name", "A", "value", "${{orders-db.DB_PASSWORD}}"),
                Map.of("name", "B", "value", "${{Orders Database.DB_PASSWORD}}")), null);
        assertEquals("pw", out.get(0).get("value"), "by the pinned host name");
        assertEquals("pw", out.get(1).get("value"), "by the current display name");
    }

    @Test
    void generatedDatabasePasswordsAreLongAndUrlSafe() {
        String a = DeploymentOrchestrator.generatePassword();
        String b = DeploymentOrchestrator.generatePassword();
        assertEquals(32, a.length());
        assertTrue(a.matches("[A-Za-z0-9]+"));
        assertFalse(a.equals(b));
    }
}
