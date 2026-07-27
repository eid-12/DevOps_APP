package com.cloudbase.controller;

import com.cloudbase.dto.ProjectDtos.CreateProjectRequest;
import com.cloudbase.model.ProjectRecord;
import com.cloudbase.model.UserAccount;
import com.cloudbase.service.AuthService;
import com.cloudbase.service.ProjectService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {

    private final AuthService authService;
    private final ProjectService projectService;

    public ProjectController(AuthService authService, ProjectService projectService) {
        this.authService = authService;
        this.projectService = projectService;
    }

    @GetMapping
    public List<ProjectRecord> list(@RequestHeader("X-Auth-Token") String token) {
        UserAccount user = authService.resolveUser(token);
        return projectService.listForUser(user);
    }

    @PostMapping
    public ProjectRecord create(
            @RequestHeader("X-Auth-Token") String token,
            @Valid @RequestBody CreateProjectRequest request
    ) {
        UserAccount user = authService.resolveUser(token);
        return projectService.create(user, request);
    }

    @PostMapping("/{projectId}/start")
    public ProjectRecord start(@RequestHeader("X-Auth-Token") String token, @PathVariable String projectId) {
        return projectService.start(projectId, authService.resolveUser(token));
    }

    @PostMapping("/{projectId}/stop")
    public ProjectRecord stop(@RequestHeader("X-Auth-Token") String token, @PathVariable String projectId) {
        return projectService.stop(projectId, authService.resolveUser(token));
    }
}
