package com.cloudbase.service;

import com.cloudbase.entity.ProjectEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.model.ServiceStatus;
import com.cloudbase.portainer.ComposeGenerator;
import com.cloudbase.portainer.EdgeRouter;
import com.cloudbase.portainer.PortainerClient;
import com.cloudbase.portainer.TenantIsolationVerifier;
import com.cloudbase.portainer.TenantIsolationVerifier.Outcome;
import com.cloudbase.portainer.TenantIsolationVerifier.Result;
import com.cloudbase.repository.ServiceRepository;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionTemplate;
import reactor.core.publisher.Mono;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Running tenants are stopped on proven exposure, restarted once protected, and left alone when unverified. */
class TenantIsolationGuardTest {

    private final ServiceRepository repo = mock(ServiceRepository.class);
    private final TenantIsolationVerifier verifier = mock(TenantIsolationVerifier.class);
    private final PortainerClient portainer = mock(PortainerClient.class);
    private final NotificationService notifications = mock(NotificationService.class);
    private final ServiceEntity svc = ServiceEntity.builder().id("svc-a").name("web").status(ServiceStatus.RUNNING)
            .containerName("cb-svc-a").portainerStackId(7)
            .project(ProjectEntity.builder().id("proj-1").ownerId("u-1").name("p").build()).build();
    private boolean containerRunning;

    @SuppressWarnings("unchecked")
    private TenantIsolationGuard guard() {
        TransactionTemplate tx = mock(TransactionTemplate.class);
        when(tx.execute(any())).thenAnswer(i -> ((org.springframework.transaction.support.TransactionCallback<Object>) i.getArgument(0)).doInTransaction(null));
        doAnswer(i -> { ((Consumer<Object>) i.getArgument(0)).accept(null); return null; }).when(tx).executeWithoutResult(any());
        EdgeRouter edge = mock(EdgeRouter.class);
        when(edge.edgeName()).thenReturn("cloudbase-edge");
        when(edge.ensureEdge()).thenReturn(Mono.empty());
        when(portainer.ensureProjectNetwork(anyString(), anyString(), anyBoolean())).thenReturn(Mono.empty());
        when(portainer.findContainer("cb-svc-a")).thenAnswer(i -> Mono.just(Map.of("State", Map.of("Running", containerRunning))));
        when(portainer.stopContainer("cb-svc-a")).thenAnswer(i -> { containerRunning = false; return Mono.empty(); });
        when(portainer.startContainer("cb-svc-a")).thenAnswer(i -> { containerRunning = true; return Mono.empty(); });
        when(repo.findAll()).thenReturn(List.of(svc));
        when(repo.findById("svc-a")).thenReturn(Optional.of(svc));
        ComposeGenerator compose = mock(ComposeGenerator.class);
        when(compose.projectNetworkName("proj-1")).thenReturn("project-proj-1");
        when(compose.resolveContainerName(svc)).thenReturn("cb-svc-a");
        return new TenantIsolationGuard(repo, verifier, edge, portainer, compose, notifications, tx);
    }

    @Test
    void exposureStopsRunningTenantsAndProtectionRestartsThem() {
        TenantIsolationGuard g = guard();
        containerRunning = true;
        when(verifier.verify("project-proj-1")).thenReturn(new Outcome(Result.EXPOSED, "rules missing"));
        g.check();
        assertFalse(containerRunning, "stopped while exposed");
        assertTrue(svc.isQuarantined());
        verify(notifications).notifyUser(any(), any(), any(), any());

        when(verifier.verify("project-proj-1")).thenReturn(new Outcome(Result.PROTECTED, "ok"));
        g.check();
        assertTrue(containerRunning, "started again once protected");
        assertFalse(svc.isQuarantined());
    }

    @Test
    void afterADaemonRestartTenantsStartOnlyOnceProtected() {
        TenantIsolationGuard g = guard();
        containerRunning = false; // on-failure policy: not started by the daemon
        when(verifier.verify("project-proj-1")).thenReturn(new Outcome(Result.UNVERIFIED, "probe failed"));
        g.check();
        verify(portainer, never()).startContainer("cb-svc-a");
        when(verifier.verify("project-proj-1")).thenReturn(new Outcome(Result.EXPOSED, "rules missing"));
        g.check();
        verify(portainer, never()).startContainer("cb-svc-a");
        when(verifier.verify("project-proj-1")).thenReturn(new Outcome(Result.PROTECTED, "ok"));
        g.check();
        assertTrue(containerRunning);
    }

    @Test
    void aServiceTheRuntimeSyncMarkedFailedIsStartedOnceProtected() {
        TenantIsolationGuard g = guard();
        svc.setStatus(ServiceStatus.FAILED); // a stopped container after a daemon restart is reported as FAILED
        containerRunning = false;
        when(verifier.verify("project-proj-1")).thenReturn(new Outcome(Result.PROTECTED, "ok"));
        g.check();
        assertTrue(containerRunning);
    }

    @Test
    void unverifiedLeavesRunningTenantsRunning() {
        TenantIsolationGuard g = guard();
        containerRunning = true;
        when(verifier.verify("project-proj-1")).thenReturn(new Outcome(Result.UNVERIFIED, "portainer down"));
        g.check();
        assertTrue(containerRunning);
        verify(portainer, never()).stopContainer("cb-svc-a");
    }

    @Test
    void aUserStoppedServiceIsNotRestarted() {
        TenantIsolationGuard g = guard();
        svc.setStatus(ServiceStatus.STOPPED);
        containerRunning = false;
        when(verifier.verify("project-proj-1")).thenReturn(new Outcome(Result.PROTECTED, "ok"));
        g.check();
        verify(portainer, never()).startContainer("cb-svc-a");
    }
}
