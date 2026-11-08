package com.cloudbase.service;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.portainer.PortainerClient;
import com.cloudbase.repository.DeploymentRepository;
import com.cloudbase.repository.ServiceRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The cleanup removes only what CloudBase left behind, and never anything still in use or not its own. */
class DockerJanitorTest {

    private static final Instant NOW = Instant.parse("2026-11-08T12:00:00Z");
    private static final long HOUR_AGO = NOW.minusSeconds(3600).getEpochSecond();
    private static final long JUST_NOW = NOW.minusSeconds(60).getEpochSecond();

    private final PortainerClient portainer = mock(PortainerClient.class);
    private final ServiceRepository services = mock(ServiceRepository.class);
    private final DeploymentRepository deployments = mock(DeploymentRepository.class);
    private final PlatformSettingsService settings = mock(PlatformSettingsService.class);
    private final DockerJanitor janitor = new DockerJanitor(portainer, services, deployments, settings,
            Clock.fixed(NOW, ZoneOffset.UTC));

    private static Map<String, Object> container(String id, String name, String imageId, String state, long created,
                                                 Map<String, String> labels) {
        return Map.of("Id", id, "Names", List.of("/" + name), "ImageID", imageId, "State", state,
                "Created", created, "Labels", labels);
    }

    /** A pulled image: it has a registry digest, so removing it is always recoverable by pulling again. */
    private static Map<String, Object> image(String id, String... tags) {
        return Map.of("Id", id, "RepoTags", List.of(tags), "RepoDigests", List.of(tags[0].split(":")[0] + "@sha256:" + "0".repeat(64)));
    }

    @BeforeEach
    void defaults() {
        when(portainer.forceRemoveContainer(anyString())).thenReturn(Mono.empty());
        when(portainer.removeImageIfUnused(anyString())).thenReturn(Mono.just(true));
        when(portainer.removeStack(anyInt())).thenReturn(Mono.empty());
        when(portainer.pruneDanglingImages()).thenReturn(Mono.empty());
        when(portainer.pruneAnonymousVolumes()).thenReturn(Mono.empty());
        when(portainer.listStacks()).thenReturn(Mono.just(List.of()));
        when(settings.get(PlatformSettingsService.DOCKERHUB_NAMESPACE)).thenReturn("minipcer");
        when(services.findAll()).thenReturn(List.of(ServiceEntity.builder().id("svc-live")
                .sourceDetails(Map.of("imageName", "nginxdemos/hello")).build()));
        when(services.existsById("svc-live")).thenReturn(true);
    }

    @Test
    void removesContainersOfDeletedServicesButNotLiveOrBrandNewOnes() {
        when(portainer.getContainers()).thenReturn(Mono.just(new Object[]{
                container("c1", "cb-svc-gone1", "sha256:a", "running", HOUR_AGO, Map.of()),
                container("c2", "cb-wt-svc-gone1", "sha256:w", "running", HOUR_AGO, Map.of()),
                container("c3", "cb-svc-live", "sha256:b", "running", HOUR_AGO, Map.of()),
                container("c4", "cb-svc-new1", "sha256:c", "running", JUST_NOW, Map.of()),
                container("c5", "forms-db", "sha256:d", "exited", HOUR_AGO, Map.of())}));
        when(portainer.listImages()).thenReturn(Mono.just(List.of()));

        janitor.runPass();

        verify(portainer).forceRemoveContainer("c1");
        verify(portainer).forceRemoveContainer("c2");
        verify(portainer, never()).forceRemoveContainer("c3");
        verify(portainer, never()).forceRemoveContainer("c4");
        verify(portainer, never()).forceRemoveContainer("c5");
    }

    @Test
    void removesFinishedHelperContainersOnly() {
        when(portainer.getContainers()).thenReturn(Mono.just(new Object[]{
                container("w1", "cb-wipe-1", "sha256:x", "exited", HOUR_AGO, Map.of("cloudbase.temp", "volume-wipe")),
                container("p1", "cb-probe-1", "sha256:x", "running", HOUR_AGO, Map.of("cloudbase.role", "isolation-probe")),
                container("p2", "cb-probe-2", "sha256:x", "exited", JUST_NOW, Map.of("cloudbase.role", "isolation-probe"))}));
        when(portainer.listImages()).thenReturn(Mono.just(List.of()));

        janitor.runPass();

        verify(portainer).forceRemoveContainer("w1");
        verify(portainer, never()).forceRemoveContainer("p1");
        verify(portainer, never()).forceRemoveContainer("p2");
    }

    @Test
    void removesOnlyUnusedImagesThatCloudBasePulled() {
        when(portainer.getContainers()).thenReturn(Mono.just(new Object[]{
                container("c1", "cb-svc-live", "sha256:used", "running", HOUR_AGO, Map.of())}));
        when(portainer.listImages()).thenReturn(Mono.just(List.of(
                image("sha256:used", "postgres:16-alpine"),
                image("sha256:pg-old", "postgres:15-alpine"),
                image("sha256:app-old", "ghcr.io/tenant/app:abc1234"),
                image("sha256:tenant-old", "nginxdemos/hello:0.3"),
                image("sha256:wt-old", "nickfedor/watchtower:1.20.0"),
                image("sha256:platform", "minipcer/cloudbase-backend:1111111111111111111111111111111111111111"),
                image("sha256:foreign", "grafana/grafana:11"))));

        janitor.runPass();

        verify(portainer).removeImageIfUnused("sha256:pg-old");
        verify(portainer).removeImageIfUnused("sha256:app-old");
        verify(portainer).removeImageIfUnused("sha256:tenant-old");
        verify(portainer).removeImageIfUnused("sha256:wt-old");
        verify(portainer, never()).removeImageIfUnused("sha256:used");
        verify(portainer, never()).removeImageIfUnused("sha256:platform");
        verify(portainer, never()).removeImageIfUnused("sha256:foreign");
        verify(portainer).pruneDanglingImages();
    }

    @Test
    void neverRemovesALocallyBuiltImageEvenIfATenantNamesItsRepository() {
        when(services.findAll()).thenReturn(List.of(ServiceEntity.builder().id("svc-live")
                .sourceDetails(Map.of("imageName", "cloudbase-egress-guard")).build()));
        when(portainer.getContainers()).thenReturn(Mono.just(new Object[0]));
        when(portainer.listImages()).thenReturn(Mono.just(List.of(
                Map.of("Id", "sha256:local", "RepoTags", List.of("cloudbase-egress-guard:latest"), "RepoDigests", List.of()))));

        janitor.runPass();

        verify(portainer, never()).removeImageIfUnused("sha256:local");
    }

    @Test
    void leavesImagesAloneWhileADeployIsRunning() {
        when(deployments.existsByStatusInAndFinishedAtIsNull(any())).thenReturn(true);
        when(portainer.getContainers()).thenReturn(Mono.just(new Object[0]));
        when(portainer.listImages()).thenReturn(Mono.just(List.of(image("sha256:fresh", "ghcr.io/tenant/app:new"))));

        janitor.runPass();

        verify(portainer, never()).removeImageIfUnused(anyString());
        verify(portainer, never()).pruneDanglingImages();
    }

    @Test
    void removesStacksOfDeletedServices() {
        when(portainer.getContainers()).thenReturn(Mono.just(new Object[0]));
        when(portainer.listImages()).thenReturn(Mono.just(List.of()));
        when(portainer.listStacks()).thenReturn(Mono.just(List.of(
                Map.of("Id", 7, "Name", "cb-proj-1a2b-svc-gone1", "CreationDate", HOUR_AGO),
                Map.of("Id", 8, "Name", "cb-proj-1a2b-svc-live", "CreationDate", HOUR_AGO),
                Map.of("Id", 9, "Name", "cloudbase-platform", "CreationDate", HOUR_AGO))));

        janitor.runPass();

        verify(portainer).removeStack(7);
        verify(portainer, never()).removeStack(8);
        verify(portainer, never()).removeStack(9);
    }

    @Test
    void imageOwnershipRules() {
        Set<String> tenants = Set.of("node");
        assertTrue(DockerJanitor.isCloudBaseImage(List.of("docker.io/library/mysql:8.0"), tenants, "minipcer"));
        assertTrue(DockerJanitor.isCloudBaseImage(List.of("minipcer/web-app:abc"), tenants, "minipcer"));
        assertTrue(DockerJanitor.isCloudBaseImage(List.of("node:20"), tenants, "minipcer"));
        assertFalse(DockerJanitor.isCloudBaseImage(List.of("minipcer/cloudbase-frontend:x"), tenants, "minipcer"));
        assertFalse(DockerJanitor.isCloudBaseImage(List.of("portainer/portainer-ce:2.21.5"), tenants, "minipcer"));
        assertFalse(DockerJanitor.isCloudBaseImage(List.of(), tenants, "minipcer"));
        assertEquals("registry.local:5000/app", DockerJanitor.repoOf("registry.local:5000/app:1"));
        assertEquals("nginx", DockerJanitor.repoOf("nginx@sha256:abc"));
    }
}
