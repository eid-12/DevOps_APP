package com.cloudbase.service.impl;

import com.cloudbase.dto.DeployServiceRequest;
import com.cloudbase.entity.DeploymentEntity;
import com.cloudbase.entity.ProjectEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.AccountStatus;
import com.cloudbase.repository.DeploymentRepository;
import com.cloudbase.repository.ServiceRepository;
import com.cloudbase.repository.UserRepository;
import com.cloudbase.service.DeploymentOrchestrator;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Constructor;
import java.util.Arrays;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** GitHub redelivers webhooks: one commit deploys once unless the earlier attempt failed. */
class DeployIdempotencyTest {

    private final ServiceRepository services = mock(ServiceRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final DeploymentRepository deployments = mock(DeploymentRepository.class);
    private final DeploymentOrchestrator orchestrator = mock(DeploymentOrchestrator.class);

    private ProjectServiceImpl impl() throws Exception {
        Constructor<?> c = ProjectServiceImpl.class.getConstructors()[0];
        Object[] args = Arrays.stream(c.getParameterTypes()).map(t -> {
            if (t == ServiceRepository.class) return services;
            if (t == UserRepository.class) return users;
            if (t == DeploymentRepository.class) return deployments;
            if (t == DeploymentOrchestrator.class) return orchestrator;
            return mock(t);
        }).toArray();
        return (ProjectServiceImpl) c.newInstance(args);
    }

    @Test
    void redeliveredWorkflowEventReturnsTheExistingDeployment() throws Exception {
        UserEntity owner = new UserEntity();
        owner.setId("u1");
        owner.setAccountStatus(AccountStatus.ACTIVE);
        owner.setEmailVerified(true);
        owner.setDeploymentEnabled(true);
        ServiceEntity service = ServiceEntity.builder().id("s1")
                .project(ProjectEntity.builder().id("p").ownerId("u1").name("p").build()).build();
        DeploymentEntity existing = DeploymentEntity.builder().id("d1").build();
        when(services.findById("s1")).thenReturn(Optional.of(service));
        when(users.findById("u1")).thenReturn(Optional.of(owner));
        when(users.lockById("u1")).thenReturn(Optional.of(owner));
        when(deployments.findFirstByServiceIdAndCommitShaAndStatusInOrderByStartedAtDesc(eq("s1"), eq("abc"), any()))
                .thenReturn(Optional.of(existing));

        assertSame(existing, impl().deployAsSystem("s1", "github-workflow", new DeployServiceRequest("abc", "abc")));
        verify(orchestrator, never()).startDeploy(any(), anyString(), any(), any());
    }
}
