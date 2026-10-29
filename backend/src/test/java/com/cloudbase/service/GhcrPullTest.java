package com.cloudbase.service;

import com.cloudbase.email.EmailService;
import com.cloudbase.entity.ProjectEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
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
import reactor.core.publisher.Mono;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The GHCR pull is the per-deploy access check: owner credential only, fail closed otherwise. */
class GhcrPullTest {

    private final PortainerClient portainer = mock(PortainerClient.class);
    private final UserRepository users = mock(UserRepository.class);
    private final DeploymentOrchestrator orchestrator = new DeploymentOrchestrator(
            mock(ServiceRepository.class), mock(DeploymentRepository.class), mock(ComposeGenerator.class), portainer,
            mock(NpmClient.class), mock(DeploymentEventPublisher.class), mock(NotificationService.class),
            mock(PlatformSettingsService.class), WebClient.builder(), mock(VanitySubdomainService.class),
            mock(TransactionTemplate.class), users, mock(EmailService.class));

    private static ServiceEntity ghcrService() {
        Map<String, Object> src = new HashMap<>();
        src.put("imageName", "ghcr.io/tenant/app");
        src.put("imageTag", "abc1234");
        return ServiceEntity.builder().id("svc-1").name("app").sourceType(ServiceSourceType.GITHUB).sourceDetails(src)
                .project(ProjectEntity.builder().id("p").ownerId("u-owner").name("p").build()).build();
    }

    private UserEntity owner(String scopes) {
        UserEntity u = new UserEntity();
        u.setId("u-owner");
        u.setGithubUsername("tenant");
        u.setGithubAccessToken("owner-token");
        u.setGithubScopes(scopes);
        when(users.findById("u-owner")).thenReturn(Optional.of(u));
        return u;
    }

    @Test
    void pullsWithTheOwnersOwnCredential() {
        owner("read:user repo user:email workflow read:packages");
        when(portainer.hasRegistryFor("ghcr.io")).thenReturn(Mono.just(false));
        when(portainer.pullImageWithAuth("ghcr.io/tenant/app", "abc1234", "tenant", "owner-token", "ghcr.io")).thenReturn(Mono.empty());

        assertNull(orchestrator.pullGhcrImage(ghcrService(), null));
        verify(portainer).pullImageWithAuth("ghcr.io/tenant/app", "abc1234", "tenant", "owner-token", "ghcr.io");
    }

    @Test
    void refusesWithoutPackageScopeBeforeAnyPull() {
        owner("read:user repo user:email workflow");
        String reason = orchestrator.pullGhcrImage(ghcrService(), null);
        assertNotNull(reason);
        assertTrue(reason.contains("read:packages"), reason);
        verify(portainer, never()).pullImageWithAuth(anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void failsClosedWhenPortainerHoldsASharedGhcrCredential() {
        owner("repo read:packages");
        when(portainer.hasRegistryFor("ghcr.io")).thenReturn(Mono.just(true));
        String reason = orchestrator.pullGhcrImage(ghcrService(), null);
        assertNotNull(reason);
        verify(portainer, never()).pullImageWithAuth(anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void aFailedPullBlocksTheDeploy() {
        owner("repo read:packages");
        when(portainer.hasRegistryFor("ghcr.io")).thenReturn(Mono.just(false));
        when(portainer.pullImageWithAuth(anyString(), anyString(), anyString(), anyString(), anyString()))
                .thenReturn(Mono.error(new IllegalStateException("denied")));
        String reason = orchestrator.pullGhcrImage(ghcrService(), null);
        assertNotNull(reason);
        assertTrue(reason.contains("denied"), reason);
    }

    @Test
    void ownerWithoutGitHubIsRefused() {
        when(users.findById("u-owner")).thenReturn(Optional.empty());
        assertNotNull(orchestrator.pullGhcrImage(ghcrService(), null));
    }
}
