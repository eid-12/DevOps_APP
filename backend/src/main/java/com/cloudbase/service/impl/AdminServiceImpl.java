package com.cloudbase.service.impl;

import com.cloudbase.dto.AdminDtos.InfrastructureOverview;
import com.cloudbase.model.ProjectStatus;
import com.cloudbase.model.UserAccount;
import com.cloudbase.service.AdminService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.Comparator;
import java.util.List;

@Service
public class AdminServiceImpl implements AdminService {

    private final InMemoryPlatformStore store;

    public AdminServiceImpl(InMemoryPlatformStore store) {
        this.store = store;
    }

    @Override
    public List<UserAccount> listUsers() {
        return store.getUsers().stream()
                .sorted(Comparator.comparing(UserAccount::name))
                .toList();
    }

    @Override
    public UserAccount updateDeploymentAccess(String userId, boolean enabled) {
        UserAccount user = store.getUserById(userId);
        if (user == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found");
        }
        return store.updateUser(user.withDeploymentEnabled(enabled));
    }

    @Override
    public InfrastructureOverview infrastructureOverview() {
        long active = store.getProjects().stream()
                .filter(project -> project.status() == ProjectStatus.RUNNING)
                .count();

        return new InfrastructureOverview(
                "connected",
                "connected",
                "active",
                (int) active,
                "31%",
                "6.8 GB / 16 GB"
        );
    }
}
