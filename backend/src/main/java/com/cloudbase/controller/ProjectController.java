package com.cloudbase.controller;

import com.cloudbase.dto.ProjectDtos.CreateProjectRequest;
import com.cloudbase.dto.ProjectDtos.CreateServiceRequest;
import com.cloudbase.dto.ProjectDtos.DeployServiceRequest;
import com.cloudbase.dto.ProjectDtos.DomainCheckResponse;
import com.cloudbase.dto.ProjectDtos.ExecRequest;
import com.cloudbase.dto.ProjectDtos.SetCustomDomainRequest;
import com.cloudbase.dto.ProjectDtos.SetSubdomainRequest;
import com.cloudbase.dto.ProjectDtos.SetVanitySubdomainRequest;
import com.cloudbase.dto.ProjectDtos.VanityStatusResponse;
import com.cloudbase.dto.ProjectDtos.UpdateEnvVarsRequest;
import com.cloudbase.dto.ProjectDtos.UpdateProjectRequest;
import com.cloudbase.dto.ProjectDtos.UpdateServiceRequest;
import com.cloudbase.dto.ProjectDtos.UpsertSharedVariableRequest;
import com.cloudbase.entity.DeploymentEntity;
import com.cloudbase.entity.ProjectEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.service.ProjectService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {

    private final ProjectService projectService;

    public ProjectController(ProjectService projectService) {
        this.projectService = projectService;
    }

    // ── Projects ──────────────────────────────────────────────

    @GetMapping
    public List<ProjectEntity> listProjects(@AuthenticationPrincipal UserEntity user) {
        return projectService.listForUser(user);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectEntity createProject(
            @AuthenticationPrincipal UserEntity user,
            @Valid @RequestBody CreateProjectRequest request
    ) {
        return projectService.createProject(user, request);
    }

    @GetMapping("/{projectId}")
    public ProjectEntity getProject(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String projectId
    ) {
        return projectService.getProject(projectId, user);
    }

    @DeleteMapping("/{projectId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteProject(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String projectId
    ) {
        projectService.deleteProject(projectId, user);
    }

    @PutMapping("/{projectId}")
    public ProjectEntity updateProject(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String projectId,
            @RequestBody UpdateProjectRequest request
    ) {
        return projectService.updateProject(projectId, user, request);
    }

    // ── Services ──────────────────────────────────────────────

    @PostMapping("/{projectId}/services")
    @ResponseStatus(HttpStatus.CREATED)
    public ServiceEntity addService(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String projectId,
            @Valid @RequestBody CreateServiceRequest request
    ) {
        return projectService.addService(projectId, user, request);
    }

    @GetMapping("/services/{serviceId}")
    public ServiceEntity getService(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId
    ) {
        return projectService.getService(serviceId, user);
    }

    @PutMapping("/services/{serviceId}")
    public ServiceEntity updateService(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId,
            @RequestBody UpdateServiceRequest request
    ) {
        return projectService.updateService(serviceId, user, request);
    }

    @PostMapping("/services/{serviceId}/stop")
    public ServiceEntity stopService(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId
    ) {
        return projectService.stopService(serviceId, user);
    }

    @DeleteMapping("/services/{serviceId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteService(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId
    ) {
        projectService.deleteService(serviceId, user);
    }

    @PutMapping("/services/{serviceId}/env")
    public ServiceEntity updateEnvVars(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId,
            @Valid @RequestBody UpdateEnvVarsRequest request
    ) {
        return projectService.updateEnvVars(serviceId, user, request);
    }

    @PutMapping("/services/{serviceId}/subdomain")
    public ServiceEntity setSubdomain(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId,
            @Valid @RequestBody SetSubdomainRequest request
    ) {
        return projectService.setSubdomain(serviceId, user, request);
    }

    @GetMapping("/services/{serviceId}/custom-domain/check")
    public DomainCheckResponse checkCustomDomain(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId,
            @RequestParam(required = false, defaultValue = "") String domain
    ) {
        return projectService.checkCustomDomain(serviceId, user, domain);
    }

    @GetMapping("/services/{serviceId}/vanity-subdomain")
    public VanityStatusResponse vanityStatus(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId
    ) {
        return projectService.vanityStatus(serviceId, user);
    }

    @GetMapping("/services/{serviceId}/vanity-subdomain/check")
    public DomainCheckResponse checkVanitySubdomain(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId,
            @RequestParam(required = false, defaultValue = "") String slug
    ) {
        return projectService.checkVanitySubdomain(serviceId, user, slug);
    }

    @PutMapping("/services/{serviceId}/vanity-subdomain")
    public ServiceEntity setVanitySubdomain(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId,
            @Valid @RequestBody SetVanitySubdomainRequest request
    ) {
        return projectService.setVanitySubdomain(serviceId, user, request.slug());
    }

    @DeleteMapping("/services/{serviceId}/vanity-subdomain")
    public ServiceEntity clearVanitySubdomain(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId
    ) {
        return projectService.clearVanitySubdomain(serviceId, user);
    }

    @PutMapping("/services/{serviceId}/custom-domain")
    public ServiceEntity setCustomDomain(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId,
            @RequestBody SetCustomDomainRequest request
    ) {
        return projectService.setCustomDomain(serviceId, user, request);
    }

    @DeleteMapping("/services/{serviceId}/custom-domain")
    public ServiceEntity clearCustomDomain(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId
    ) {
        return projectService.setCustomDomain(serviceId, user, new SetCustomDomainRequest(""));
    }

    // ── Deployments ───────────────────────────────────────────

    @PostMapping("/services/{serviceId}/deploy")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public DeploymentEntity deploy(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId,
            @RequestBody(required = false) DeployServiceRequest request
    ) {
        return projectService.deploy(serviceId, user, request);
    }

    @PostMapping("/services/{serviceId}/deployments/{deploymentId}/rollback")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public DeploymentEntity rollback(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId,
            @PathVariable String deploymentId
    ) {
        return projectService.rollback(serviceId, deploymentId, user);
    }

    @GetMapping("/services/{serviceId}/deployments")
    public List<DeploymentEntity> getDeployments(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId
    ) {
        return projectService.getDeployments(serviceId, user);
    }

    @PostMapping("/services/{serviceId}/deployments/{deploymentId}/cancel")
    public DeploymentEntity cancelDeployment(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId,
            @PathVariable String deploymentId
    ) {
        return projectService.cancelDeployment(serviceId, deploymentId, user);
    }

    // ── Runtime: logs / terminal / metrics / db ───────────────

    @GetMapping("/services/{serviceId}/logs")
    public List<Map<String, Object>> getLogs(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId,
            @RequestParam(defaultValue = "200") int tail
    ) {
        return projectService.getServiceLogs(serviceId, user, tail);
    }

    @PostMapping("/services/{serviceId}/exec")
    public Map<String, Object> exec(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId,
            @Valid @RequestBody ExecRequest request
    ) {
        return Map.of("output", projectService.execInService(serviceId, user, request));
    }

    @GetMapping("/services/{serviceId}/metrics")
    public Map<String, Object> metrics(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId,
            @RequestParam(defaultValue = "1h") String range
    ) {
        return projectService.getServiceMetrics(serviceId, user, range);
    }

    @GetMapping("/services/{serviceId}/db-connection")
    public Map<String, String> dbConnection(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId
    ) {
        return projectService.getDbConnection(serviceId, user);
    }

    @PostMapping("/services/{serviceId}/restart")
    public ServiceEntity restartService(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String serviceId
    ) {
        return projectService.restartService(serviceId, user);
    }

    // ── Shared project variables ──────────────────────────────

    @GetMapping("/{projectId}/variables")
    public List<Map<String, Object>> listSharedVariables(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String projectId
    ) {
        return projectService.listSharedVariables(projectId, user);
    }

    @PutMapping("/{projectId}/variables")
    public Map<String, Object> upsertSharedVariable(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String projectId,
            @Valid @RequestBody UpsertSharedVariableRequest request
    ) {
        return projectService.upsertSharedVariable(projectId, user, request);
    }

    @DeleteMapping("/{projectId}/variables/{variableId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteSharedVariable(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String projectId,
            @PathVariable String variableId
    ) {
        projectService.deleteSharedVariable(projectId, variableId, user);
    }
}
