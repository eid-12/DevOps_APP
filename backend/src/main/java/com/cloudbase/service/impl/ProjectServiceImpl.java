package com.cloudbase.service.impl;

import com.cloudbase.dto.ProjectDtos.CreateProjectRequest;
import com.cloudbase.dto.ProjectDtos.CreateServiceRequest;
import com.cloudbase.dto.ProjectDtos.DeployServiceRequest;
import com.cloudbase.dto.ProjectDtos.ExecRequest;
import com.cloudbase.dto.ProjectDtos.SetCustomDomainRequest;
import com.cloudbase.dto.ProjectDtos.SetSubdomainRequest;
import com.cloudbase.dto.ProjectDtos.UpdateEnvVarsRequest;
import com.cloudbase.dto.ProjectDtos.UpdateProjectRequest;
import com.cloudbase.dto.ProjectDtos.UpdateServiceRequest;
import com.cloudbase.dto.ProjectDtos.UpsertSharedVariableRequest;
import com.cloudbase.entity.DeploymentEntity;
import com.cloudbase.entity.ProjectEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.DatabaseType;
import com.cloudbase.model.DeploymentStatus;
import com.cloudbase.model.EnvironmentVariable;
import com.cloudbase.model.ProjectStatus;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.model.ServiceStatus;
import com.cloudbase.model.UserRole;
import com.cloudbase.portainer.ComposeGenerator;
import com.cloudbase.repository.DeploymentRepository;
import com.cloudbase.repository.ProjectRepository;
import com.cloudbase.repository.ServiceRepository;
import com.cloudbase.service.CiBootstrapService;
import com.cloudbase.service.ContainerRuntimeService;
import com.cloudbase.service.DeploymentOrchestrator;
import com.cloudbase.service.ProjectService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@Transactional
public class ProjectServiceImpl implements ProjectService {

    private static final Logger log = LoggerFactory.getLogger(ProjectServiceImpl.class);

    private final ProjectRepository projectRepository;
    private final ServiceRepository serviceRepository;
    private final DeploymentRepository deploymentRepository;
    private final ComposeGenerator composeGenerator;
    private final DeploymentOrchestrator orchestrator;
    private final CiBootstrapService ciBootstrapService;
    private final ContainerRuntimeService containerRuntime;

    public ProjectServiceImpl(
            ProjectRepository projectRepository,
            ServiceRepository serviceRepository,
            DeploymentRepository deploymentRepository,
            ComposeGenerator composeGenerator,
            DeploymentOrchestrator orchestrator,
            CiBootstrapService ciBootstrapService,
            ContainerRuntimeService containerRuntime
    ) {
        this.projectRepository = projectRepository;
        this.serviceRepository = serviceRepository;
        this.deploymentRepository = deploymentRepository;
        this.composeGenerator = composeGenerator;
        this.orchestrator = orchestrator;
        this.ciBootstrapService = ciBootstrapService;
        this.containerRuntime = containerRuntime;
    }

    @Override
    public List<ProjectEntity> listForUser(UserEntity user) {
        List<ProjectEntity> projects = user.getRole() == UserRole.ADMIN
                ? projectRepository.findAll()
                : projectRepository.findByOwnerId(user.getId());
        projects.forEach(p -> p.getServices().size()); // initialize lazy collection for JSON
        return projects;
    }

    @Override
    public ProjectEntity getProject(String projectId, UserEntity user) {
        ProjectEntity project = projectRepository.findById(projectId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found"));
        requireOwnerOrAdmin(project.getOwnerId(), user);
        project.getServices().size();
        return project;
    }

    @Override
    public ProjectEntity createProject(UserEntity user, CreateProjectRequest request) {
        requireDeploymentEnabled(user);

        ProjectEntity project = ProjectEntity.builder()
                .id("proj-" + UUID.randomUUID().toString().substring(0, 8))
                .ownerId(user.getId())
                .ownerName(user.getName())
                .name(request.name())
                .description(request.description())
                .status(ProjectStatus.ACTIVE)
                .build();

        return projectRepository.save(project);
    }

    @Override
    public void deleteProject(String projectId, UserEntity user) {
        ProjectEntity project = getProject(projectId, user);
        for (ServiceEntity service : serviceRepository.findByProject_Id(projectId)) {
            orchestrator.removeInfrastructure(service);
        }
        projectRepository.delete(project);
    }

    @Override
    public ServiceEntity addService(String projectId, UserEntity user, CreateServiceRequest request) {
        requireDeploymentEnabled(user);
        ProjectEntity project = getProject(projectId, user);

        int memoryMb = request.quota() != null ? request.quota().memoryMb() : 512;
        int cpuMilli = request.quota() != null ? request.quota().cpuMilli() : 500;
        int storageGb = request.quota() != null ? request.quota().storageGb() : 2;

        Map<String, Object> details = request.sourceDetails() != null
                ? new HashMap<>(request.sourceDetails())
                : new HashMap<>();

        ServiceEntity service = ServiceEntity.builder()
                .id("svc-" + UUID.randomUUID().toString().substring(0, 8))
                .project(project)
                .name(request.name())
                .sourceType(request.sourceType())
                .sourceDetails(details)
                .status(ServiceStatus.PENDING)
                .quotaMemoryMb(memoryMb)
                .quotaCpuMilli(cpuMilli)
                .quotaStorageGb(storageGb)
                .createdAt(java.time.Instant.now())
                .build();

        service.setContainerName("cb-" + service.getId());
        service.setContainerPort(composeGenerator.resolveContainerPort(service));

        if (request.sourceType() != ServiceSourceType.DATABASE) {
            service.setSubdomain(orchestrator.allocateOpaqueFqdn(service.getId()));
        }

        if (request.volume() != null) {
            service.setVolumeMountPath(request.volume().mountPath());
            service.setVolumeSizeGb(request.volume().sizeGb());
        }
        if (request.envVars() != null && !request.envVars().isEmpty()) {
            service.setEnvVars(toEnvMap(request.envVars()));
        }

        ServiceEntity saved = serviceRepository.save(service);

        // B2: inject Dockerfile + Actions workflow + webhook for GitHub services
        if (saved.getSourceType() == com.cloudbase.model.ServiceSourceType.GITHUB) {
            Map<String, Object> enriched = ciBootstrapService.bootstrapGitHubService(user, saved);
            saved.setSourceDetails(enriched);
            if (enriched.get("containerPort") instanceof Number n) {
                saved.setContainerPort(n.intValue());
            } else {
                // Re-resolve after image/runtime hints
                saved.setContainerPort(composeGenerator.resolveContainerPort(saved));
            }
            saved = serviceRepository.save(saved);
        } else {
            // Databases / Docker images: auto-deploy on create when deployment is enabled
            try {
                orchestrator.startDeploy(saved, user.getEmail(), new DeployServiceRequest(null, null), null);
            } catch (Exception e) {
                log.warn("Auto-deploy on addService failed for {}: {}", saved.getId(), e.toString());
            }
        }

        return saved;
    }

    @Override
    public ServiceEntity getService(String serviceId, UserEntity user) {
        ServiceEntity service = serviceRepository.findById(serviceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service not found"));
        requireOwnerOrAdmin(service.getProject().getOwnerId(), user);
        return service;
    }

    @Override
    public void deleteService(String serviceId, UserEntity user) {
        ServiceEntity service = getService(serviceId, user);
        orchestrator.removeInfrastructure(service);
        serviceRepository.delete(service);
    }

    @Override
    public ServiceEntity stopService(String serviceId, UserEntity user) {
        ServiceEntity service = getService(serviceId, user);
        try {
            containerRuntime.stop(service);
        } catch (Exception e) {
            log.warn("Portainer stop failed for {}: {}", serviceId, e.toString());
        }
        service.setStatus(ServiceStatus.STOPPED);
        return serviceRepository.save(service);
    }

    @Override
    public ServiceEntity restartService(String serviceId, UserEntity user) {
        requireDeploymentEnabled(user);
        ServiceEntity service = getService(serviceId, user);
        try {
            if (service.getStatus() == ServiceStatus.STOPPED) {
                containerRuntime.start(service);
            } else {
                containerRuntime.restart(service);
            }
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Restart failed: " + e.getMessage());
        }
        service.setStatus(ServiceStatus.RUNNING);
        return serviceRepository.save(service);
    }

    @Override
    public DeploymentEntity deploy(String serviceId, UserEntity user, DeployServiceRequest request) {
        requireDeploymentEnabled(user);
        ServiceEntity service = getService(serviceId, user);
        return orchestrator.startDeploy(service, user.getEmail(), request, null);
    }

    @Override
    public DeploymentEntity deployAsSystem(String serviceId, String triggeredBy, DeployServiceRequest request) {
        ServiceEntity service = serviceRepository.findById(serviceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service not found"));
        return orchestrator.startDeploy(service, triggeredBy, request, null);
    }

    @Override
    public DeploymentEntity rollback(String serviceId, String deploymentId, UserEntity user) {
        requireDeploymentEnabled(user);
        ServiceEntity service = getService(serviceId, user);
        DeploymentEntity source = deploymentRepository.findById(deploymentId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deployment not found"));
        if (!serviceId.equals(source.getServiceId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Deployment does not belong to this service");
        }
        if (source.getStatus() != DeploymentStatus.SUCCESS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Only successful deployments can be rolled back");
        }
        if (deploymentId.equals(service.getLatestDeploymentId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "This deployment is already live");
        }

        DeployServiceRequest req = new DeployServiceRequest(source.getCommitSha(), source.getImageTag());
        return orchestrator.startDeploy(service, user.getEmail(), req, source.getId());
    }

    @Override
    public List<DeploymentEntity> getDeployments(String serviceId, UserEntity user) {
        getService(serviceId, user);
        return deploymentRepository.findByServiceIdOrderByStartedAtDesc(serviceId);
    }

    @Override
    public ServiceEntity updateEnvVars(String serviceId, UserEntity user, UpdateEnvVarsRequest request) {
        requireDeploymentEnabled(user);
        ServiceEntity service = getService(serviceId, user);
        service.setEnvVars(toEnvMap(request.envVars()));
        service.setEnvPendingDeploy(true);
        ServiceEntity saved = serviceRepository.save(service);
        log.info("Env vars updated for {} — pending deploy", serviceId);
        return saved;
    }

    @Override
    public ServiceEntity setSubdomain(String serviceId, UserEntity user, SetSubdomainRequest request) {
        // Legacy endpoint: only accepts bring-your-own domains (not vanity *.baseDomain).
        return setCustomDomain(serviceId, user, new SetCustomDomainRequest(request.subdomain()));
    }

    @Override
    public ServiceEntity setCustomDomain(String serviceId, UserEntity user, SetCustomDomainRequest request) {
        requireDeploymentEnabled(user);
        ServiceEntity service = getService(serviceId, user);
        if (service.getSourceType() == ServiceSourceType.DATABASE) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Databases are not publicly routed");
        }

        orchestrator.ensureOpaquePlatformDomain(service);

        String raw = request.domain() == null ? "" : request.domain().trim().toLowerCase();
        raw = raw.replaceFirst("^https?://", "");
        raw = raw.replaceAll("/.*$", "");
        raw = raw.replaceAll("[^a-z0-9.-]", "");

        if (raw.isBlank()) {
            service.setCustomDomain(null);
            ServiceEntity saved = serviceRepository.save(service);
            orchestrator.ensureProxyHost(saved);
            return saved;
        }

        String base = orchestrator.getBaseDomain();
        if (raw.equals(base) || raw.endsWith("." + base)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Platform domains are assigned automatically as random numbers. Bring your own domain (e.g. app.example.com)."
            );
        }
        if (!raw.contains(".") || raw.startsWith(".") || raw.endsWith(".") || raw.contains("..")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Enter a full hostname like app.example.com");
        }

        serviceRepository.findByCustomDomainIgnoreCase(raw)
                .filter(other -> !other.getId().equals(serviceId))
                .ifPresent(other -> {
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "Domain already in use");
                });
        serviceRepository.findBySubdomainIgnoreCase(raw)
                .filter(other -> !other.getId().equals(serviceId))
                .ifPresent(other -> {
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "Domain already in use");
                });

        service.setCustomDomain(raw);
        if (service.getContainerName() == null) {
            service.setContainerName(composeGenerator.resolveContainerName(service));
        }
        if (service.getContainerPort() == null) {
            service.setContainerPort(composeGenerator.resolveContainerPort(service));
        }
        ServiceEntity saved = serviceRepository.save(service);
        orchestrator.ensureProxyHost(saved);
        return saved;
    }

    @Override
    public List<Map<String, Object>> getServiceLogs(String serviceId, UserEntity user, int tail) {
        ServiceEntity service = getService(serviceId, user);
        try {
            return containerRuntime.fetchLogs(service, tail);
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Failed to fetch logs: " + e.getMessage());
        }
    }

    @Override
    public List<String> execInService(String serviceId, UserEntity user, ExecRequest request) {
        requireDeploymentEnabled(user);
        ServiceEntity service = getService(serviceId, user);
        if (service.getStatus() != ServiceStatus.RUNNING) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Service must be RUNNING to use the terminal");
        }
        try {
            return containerRuntime.exec(service, request.command());
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Exec failed: " + e.getMessage());
        }
    }

    @Override
    public Map<String, Object> getServiceMetrics(String serviceId, UserEntity user) {
        ServiceEntity service = getService(serviceId, user);
        return containerRuntime.fetchMetrics(service);
    }

    @Override
    public Map<String, String> getDbConnection(String serviceId, UserEntity user) {
        ServiceEntity service = getService(serviceId, user);
        if (service.getSourceType() != ServiceSourceType.DATABASE) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Not a database service");
        }
        Map<String, Object> src = service.getSourceDetails() != null ? service.getSourceDetails() : Map.of();
        String dbTypeStr = String.valueOf(src.getOrDefault("dbType", "POSTGRESQL"));
        DatabaseType dbType = DatabaseType.valueOf(dbTypeStr);
        String host = service.getContainerName() != null
                ? service.getContainerName()
                : composeGenerator.resolveContainerName(service);
        // Apps on the project network use the compose service key (sanitized name)
        String networkHost = service.getName().toLowerCase().replaceAll("[^a-z0-9-]", "-");
        int port = composeGenerator.resolveContainerPort(service);
        String password = envValue(service, switch (dbType) {
            case REDIS -> "REDIS_PASSWORD";
            case MONGODB -> "MONGO_PASSWORD";
            default -> "DB_PASSWORD";
        });

        Map<String, String> info = new LinkedHashMap<>();
        info.put("dbType", dbType.name());
        info.put("host", networkHost);
        info.put("containerName", host);
        info.put("port", String.valueOf(port));
        info.put("internal", "true");
        switch (dbType) {
            case POSTGRESQL -> {
                info.put("database", networkHost);
                info.put("username", "cbuser");
                info.put("password", password);
                info.put("url", "jdbc:postgresql://" + networkHost + ":" + port + "/" + networkHost);
            }
            case MYSQL -> {
                info.put("database", networkHost);
                info.put("username", "cbuser");
                info.put("password", password);
                info.put("url", "jdbc:mysql://" + networkHost + ":" + port + "/" + networkHost);
            }
            case REDIS -> {
                info.put("password", password);
                info.put("url", "redis://:" + password + "@" + networkHost + ":" + port);
            }
            case MONGODB -> {
                info.put("username", "cbuser");
                info.put("password", password);
                info.put("url", "mongodb://cbuser:" + password + "@" + networkHost + ":" + port);
            }
        }
        return info;
    }

    @Override
    public List<Map<String, Object>> listSharedVariables(String projectId, UserEntity user) {
        ProjectEntity project = getProject(projectId, user);
        List<Map<String, Object>> vars = project.getSharedVariables();
        return vars != null ? vars : List.of();
    }

    @Override
    public Map<String, Object> upsertSharedVariable(String projectId, UserEntity user, UpsertSharedVariableRequest request) {
        requireDeploymentEnabled(user);
        ProjectEntity project = getProject(projectId, user);
        List<Map<String, Object>> vars = project.getSharedVariables() != null
                ? new ArrayList<>(project.getSharedVariables())
                : new ArrayList<>();

        String key = request.key().trim();
        if (!key.matches("[A-Za-z_][A-Za-z0-9_]*")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid variable key");
        }
        List<String> serviceIds = request.serviceIds() != null ? request.serviceIds() : List.of();

        Map<String, Object> saved;
        if (request.id() != null && !request.id().isBlank()) {
            int idx = -1;
            for (int i = 0; i < vars.size(); i++) {
                if (request.id().equals(String.valueOf(vars.get(i).get("id")))) {
                    idx = i;
                    break;
                }
            }
            if (idx < 0) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Variable not found");
            }
            for (Map<String, Object> v : vars) {
                if (key.equals(String.valueOf(v.get("key"))) && !request.id().equals(String.valueOf(v.get("id")))) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "Variable key already exists");
                }
            }
            saved = new LinkedHashMap<>(vars.get(idx));
            saved.put("key", key);
            saved.put("value", request.value() == null ? "" : request.value());
            saved.put("isSecret", request.isSecret());
            saved.put("serviceIds", serviceIds);
            saved.put("updatedAt", Instant.now().toString());
            vars.set(idx, saved);
        } else {
            for (Map<String, Object> v : vars) {
                if (key.equals(String.valueOf(v.get("key")))) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "Variable key already exists");
                }
            }
            saved = new LinkedHashMap<>();
            saved.put("id", "svar-" + UUID.randomUUID().toString().substring(0, 8));
            saved.put("key", key);
            saved.put("value", request.value() == null ? "" : request.value());
            saved.put("isSecret", request.isSecret());
            saved.put("serviceIds", serviceIds);
            saved.put("updatedAt", Instant.now().toString());
            vars.add(0, saved);
        }
        project.setSharedVariables(vars);
        projectRepository.save(project);
        return saved;
    }

    @Override
    public void deleteSharedVariable(String projectId, String variableId, UserEntity user) {
        requireDeploymentEnabled(user);
        ProjectEntity project = getProject(projectId, user);
        List<Map<String, Object>> vars = project.getSharedVariables() != null
                ? new ArrayList<>(project.getSharedVariables())
                : new ArrayList<>();
        boolean removed = vars.removeIf(v -> variableId.equals(String.valueOf(v.get("id"))));
        if (!removed) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Variable not found");
        }
        project.setSharedVariables(vars);
        projectRepository.save(project);
    }

    @Override
    public ProjectEntity updateProject(String projectId, UserEntity user, UpdateProjectRequest request) {
        ProjectEntity project = getProject(projectId, user);
        if (request.name() != null && !request.name().isBlank()) {
            project.setName(request.name().trim());
        }
        if (request.description() != null) {
            project.setDescription(request.description());
        }
        if (request.status() != null) {
            project.setStatus(request.status());
        }
        return projectRepository.save(project);
    }

    @Override
    public ServiceEntity updateService(String serviceId, UserEntity user, UpdateServiceRequest request) {
        requireDeploymentEnabled(user);
        ServiceEntity service = getService(serviceId, user);
        if (request.name() != null && !request.name().isBlank()) {
            service.setName(request.name().trim());
        }
        if (request.sourceDetails() != null) {
            Map<String, Object> details = new HashMap<>(request.sourceDetails());
            service.setSourceDetails(details);
            if (details.get("containerPort") instanceof Number n) {
                service.setContainerPort(n.intValue());
            } else {
                service.setContainerPort(composeGenerator.resolveContainerPort(service));
            }
        }
        if (request.quota() != null) {
            service.setQuotaMemoryMb(request.quota().memoryMb());
            service.setQuotaCpuMilli(request.quota().cpuMilli());
            service.setQuotaStorageGb(request.quota().storageGb());
        }
        if (Boolean.TRUE.equals(request.removeVolume())) {
            service.setVolumeMountPath(null);
            service.setVolumeSizeGb(null);
        } else if (request.volume() != null) {
            service.setVolumeMountPath(request.volume().mountPath());
            service.setVolumeSizeGb(request.volume().sizeGb());
        }
        return serviceRepository.save(service);
    }

    @Override
    public DeploymentEntity cancelDeployment(String serviceId, String deploymentId, UserEntity user) {
        getService(serviceId, user);
        DeploymentEntity dep = deploymentRepository.findById(deploymentId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deployment not found"));
        if (!serviceId.equals(dep.getServiceId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Deployment does not belong to this service");
        }
        if (dep.getStatus() == DeploymentStatus.SUCCESS
                || dep.getStatus() == DeploymentStatus.FAILED
                || dep.getStatus() == DeploymentStatus.CANCELLED) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Deployment is already finished");
        }
        dep.setStatus(DeploymentStatus.CANCELLED);
        dep.setFinishedAt(Instant.now());
        dep.setLogs((dep.getLogs() == null ? "" : dep.getLogs() + "\n") + "Cancelled by user");
        return deploymentRepository.save(dep);
    }

    private static String envValue(ServiceEntity service, String key) {
        Map<String, Object> env = service.getEnvVars();
        if (env == null || !env.containsKey(key)) return "";
        Object raw = env.get(key);
        if (raw instanceof Map<?, ?> m && m.get("value") != null) {
            return String.valueOf(m.get("value"));
        }
        return raw == null ? "" : String.valueOf(raw);
    }

    private Map<String, Object> toEnvMap(List<EnvironmentVariable> envVars) {
        Map<String, Object> map = new LinkedHashMap<>();
        if (envVars == null) return map;
        for (EnvironmentVariable ev : envVars) {
            if (ev == null || ev.key() == null || ev.key().isBlank()) continue;
            map.put(ev.key().trim(), Map.of(
                    "value", ev.value() == null ? "" : ev.value(),
                    "isSecret", ev.isSecret()
            ));
        }
        return map;
    }

    private void requireDeploymentEnabled(UserEntity user) {
        if (!user.isDeploymentEnabled()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Deployment access is not enabled for your account");
        }
    }

    private void requireOwnerOrAdmin(String ownerId, UserEntity user) {
        if (user.getRole() != UserRole.ADMIN && !ownerId.equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Access denied");
        }
    }
}
