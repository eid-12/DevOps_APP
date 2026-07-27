package com.cloudbase.service.impl;

import com.cloudbase.model.ProjectRecord;
import com.cloudbase.model.ProjectStatus;
import com.cloudbase.model.ResourceQuota;
import com.cloudbase.model.UserAccount;
import com.cloudbase.model.UserRole;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class InMemoryPlatformStore {

    private final Map<String, UserAccount> users = new ConcurrentHashMap<>();
    private final Map<String, String> passwords = new ConcurrentHashMap<>();
    private final Map<String, String> tokens = new ConcurrentHashMap<>();
    private final Map<String, ProjectRecord> projects = new ConcurrentHashMap<>();

    public InMemoryPlatformStore() {
        UserAccount admin = new UserAccount("u-admin", "CloudBase Admin", "admin@cloudbase.dev", UserRole.ADMIN, true);
        UserAccount dev = new UserAccount("u-dev", "Developer One", "dev@cloudbase.dev", UserRole.USER, true);

        users.put(admin.id(), admin);
        users.put(dev.id(), dev);

        passwords.put(admin.email(), "Admin@2026");
        passwords.put(dev.email(), "Dev@2026");

        tokens.put("demo-admin-token", admin.id());
        tokens.put("demo-user-token", dev.id());

        ProjectRecord pending = new ProjectRecord(
                "p-1001",
                dev.id(),
                dev.name(),
                "portfolio-website",
                "github.com/dev/portfolio-website",
                "angular",
                "main",
                "portfolio.cloudbase.website",
                ProjectStatus.PENDING_APPROVAL,
                new ResourceQuota("512 MB", "0.5"),
                0.0,
                0
        );

        ProjectRecord running = new ProjectRecord(
                "p-1002",
                dev.id(),
                dev.name(),
                "api-gateway-service",
                "github.com/dev/api-gateway-service",
                "node",
                "main",
                "gateway.cloudbase.website",
                ProjectStatus.RUNNING,
                new ResourceQuota("1 GB", "1.0"),
                23.2,
                412
        );

        projects.put(pending.id(), pending);
        projects.put(running.id(), running);
    }

    public UserAccount getUserByToken(String token) {
        String userId = tokens.get(token);
        return userId == null ? null : users.get(userId);
    }

    public UserAccount getUserByEmail(String email) {
        return users.values().stream()
                .filter(user -> user.email().equalsIgnoreCase(email))
                .findFirst()
                .orElse(null);
    }

    public String getPassword(String email) {
        return passwords.get(email);
    }

    public String issueToken(UserAccount user) {
        return tokens.entrySet().stream()
                .filter(entry -> entry.getValue().equals(user.id()))
                .map(Map.Entry::getKey)
                .findFirst()
                .orElseGet(() -> {
                    String token = "cb-" + UUID.randomUUID();
                    tokens.put(token, user.id());
                    return token;
                });
    }

    public UserAccount addUser(String name, String email, String password) {
        UserAccount user = new UserAccount("u-" + UUID.randomUUID().toString().substring(0, 8), name, email, UserRole.USER, true);
        users.put(user.id(), user);
        passwords.put(user.email(), password);
        return user;
    }

    public List<UserAccount> getUsers() {
        return new ArrayList<>(users.values());
    }

    public UserAccount updateUser(UserAccount user) {
        users.put(user.id(), user);
        return user;
    }

    public UserAccount getUserById(String userId) {
        return users.get(userId);
    }

    public List<ProjectRecord> getProjects() {
        return new ArrayList<>(projects.values());
    }

    public ProjectRecord getProject(String projectId) {
        return projects.get(projectId);
    }

    public ProjectRecord saveProject(ProjectRecord project) {
        projects.put(project.id(), project);
        return project;
    }

    public String nextProjectId() {
        return "p-" + UUID.randomUUID().toString().substring(0, 8);
    }
}
