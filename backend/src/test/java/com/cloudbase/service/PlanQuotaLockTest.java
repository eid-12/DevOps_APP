package com.cloudbase.service;

import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.UserRole;
import com.cloudbase.repository.DeploymentRepository;
import com.cloudbase.repository.ProjectRepository;
import com.cloudbase.repository.ServiceRepository;
import com.cloudbase.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import java.util.List;
import java.util.Optional;

import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Quota checks lock the owner row before reading usage, so concurrent requests cannot both pass. */
class PlanQuotaLockTest {

    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final PlanQuotaService quota = new PlanQuotaService(projects, mock(ServiceRepository.class),
            mock(DeploymentRepository.class), users);

    private UserEntity user(UserRole role) {
        UserEntity u = new UserEntity();
        u.setId("u1");
        u.setRole(role);
        when(users.lockById("u1")).thenReturn(Optional.of(u));
        when(projects.findByOwnerId("u1")).thenReturn(List.of());
        return u;
    }

    @Test
    void addServiceLocksTheOwnerBeforeReadingUsage() {
        quota.assertCanAddService(user(UserRole.USER), 512, 0, 100);
        InOrder order = inOrder(users, projects);
        order.verify(users).lockById("u1");
        order.verify(projects).findByOwnerId("u1");
    }

    @Test
    void quotaIncreaseLocksTheOwnerBeforeReadingUsage() {
        quota.assertCanUpdateQuotas(user(UserRole.USER), 256, 0, 0);
        InOrder order = inOrder(users, projects);
        order.verify(users).lockById("u1");
        order.verify(projects).findByOwnerId("u1");
    }

    @Test
    void adminsAreNotLocked() {
        quota.assertCanAddService(user(UserRole.ADMIN), 512, 0, 100);
        verify(users, never()).lockById("u1");
    }
}
