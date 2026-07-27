package com.cloudbase.service.impl;

import com.cloudbase.dto.ProjectDtos.ApprovalRequest;
import com.cloudbase.dto.ProjectDtos.CreateProjectRequest;
import com.cloudbase.model.ProjectRecord;
import com.cloudbase.model.ProjectStatus;
import com.cloudbase.model.ResourceQuota;
import com.cloudbase.model.UserAccount;
import com.cloudbase.model.UserRole;
import com.cloudbase.service.ProjectService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.Comparator;
import java.util.List;

@Service
public class ProjectServiceImpl implements ProjectService {

    private final InMemoryPlatformStore store;

    public ProjectServiceImpl(InMemoryPlatformStore store) {
        this.store = store;
    }

    @Override
    public List<ProjectRecord> listForUser(UserAccount user) {
        return store.getProjects().stream()
                .filter(project -> user.role() == UserRole.ADMIN || project.ownerId().equals(user.id()))
                .sorted(Comparator.comparing(ProjectRecord::name))
                .toList();
    }

    @Override
    public ProjectRecord create(UserAccount user, CreateProjectRequest request) {
        if (!user.deploymentEnabled()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Deployment access disabled for this user");
        }

        ProjectRecord project = new ProjectRecord(
                store.nextProjectId(),
                user.id(),
                user.name(),
                request.name(),
                request.repository(),
                request.framework(),
                request.branch(),
                request.subdomain(),
                ProjectStatus.PENDING_APPROVAL,
                new ResourceQuota("512 MB", "0.5"),
                0.0,
                0
        );

        return store.saveProject(project);
    }

    @Override
    public List<ProjectRecord> pendingApprovals() {
        return store.getProjects().stream()
                .filter(project -> project.status() == ProjectStatus.PENDING_APPROVAL)
                .sorted(Comparator.comparing(ProjectRecord::name))
                .toList();
    }

    @Override
    public ProjectRecord approve(String projectId, ApprovalRequest request) {
        ProjectRecord project = requireProject(projectId);
        ProjectRecord approved = project.withQuota(new ResourceQuota(request.memory(), request.cpu()))
                .withStatus(ProjectStatus.RUNNING);
        return store.saveProject(approved);
    }

    @Override
    public ProjectRecord start(String projectId, UserAccount user) {
        ProjectRecord project = requireOwnedProject(projectId, user);
        return store.saveProject(project.withStatus(ProjectStatus.RUNNING));
    }

    @Override
    public ProjectRecord stop(String projectId, UserAccount user) {
        ProjectRecord project = requireOwnedProject(projectId, user);
        return store.saveProject(project.withStatus(ProjectStatus.STOPPED));
    }

    private ProjectRecord requireProject(String projectId) {
        ProjectRecord project = store.getProject(projectId);
        if (project == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found");
        }
        return project;
    }

    private ProjectRecord requireOwnedProject(String projectId, UserAccount user) {
        ProjectRecord project = requireProject(projectId);
        if (user.role() != UserRole.ADMIN && !project.ownerId().equals(user.id())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "You do not have access to this project");
        }
        return project;
    }
}
