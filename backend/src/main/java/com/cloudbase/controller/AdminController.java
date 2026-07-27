package com.cloudbase.controller;

import com.cloudbase.dto.AdminDtos.DeploymentAccessRequest;
import com.cloudbase.dto.AdminDtos.InfrastructureOverview;
import com.cloudbase.dto.ProjectDtos.ApprovalRequest;
import com.cloudbase.model.ProjectRecord;
import com.cloudbase.model.UserAccount;
import com.cloudbase.model.UserRole;
import com.cloudbase.service.AdminService;
import com.cloudbase.service.AuthService;
import com.cloudbase.service.ProjectService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final AuthService authService;
    private final AdminService adminService;
    private final ProjectService projectService;

    public AdminController(AuthService authService, AdminService adminService, ProjectService projectService) {
        this.authService = authService;
        this.adminService = adminService;
        this.projectService = projectService;
    }

    @GetMapping("/users")
    public List<UserAccount> users(@RequestHeader("X-Auth-Token") String token) {
        requireAdmin(token);
        return adminService.listUsers();
    }

    @PatchMapping("/users/{userId}/deployment-access")
    public UserAccount updateDeploymentAccess(
            @RequestHeader("X-Auth-Token") String token,
            @PathVariable String userId,
            @RequestBody DeploymentAccessRequest request
    ) {
        requireAdmin(token);
        return adminService.updateDeploymentAccess(userId, request.enabled());
    }

    @GetMapping("/projects/pending")
    public List<ProjectRecord> pendingProjects(@RequestHeader("X-Auth-Token") String token) {
        requireAdmin(token);
        return projectService.pendingApprovals();
    }

    @PatchMapping("/projects/{projectId}/approve")
    public ProjectRecord approveProject(
            @RequestHeader("X-Auth-Token") String token,
            @PathVariable String projectId,
            @Valid @RequestBody ApprovalRequest request
    ) {
        requireAdmin(token);
        return projectService.approve(projectId, request);
    }

    @GetMapping("/infrastructure")
    public InfrastructureOverview infrastructure(@RequestHeader("X-Auth-Token") String token) {
        requireAdmin(token);
        return adminService.infrastructureOverview();
    }

    private void requireAdmin(String token) {
        UserAccount user = authService.resolveUser(token);
        if (user.role() != UserRole.ADMIN) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Admin access required");
        }
    }
}
