package com.cloudbase.service.impl;

import com.cloudbase.dto.ProjectDtos.DomainCheckResponse;
import com.cloudbase.dto.ProjectDtos.VanityStatusResponse;
import com.cloudbase.dto.ProjectDtos.CreateProjectRequest;
import com.cloudbase.dto.ProjectDtos.CreateServiceRequest;
import com.cloudbase.dto.ProjectDtos.DeployServiceRequest;
import com.cloudbase.dto.ProjectDtos.DomainCheckResponse;
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
import com.cloudbase.model.AccountStatus;
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
import com.cloudbase.repository.UserRepository;
import com.cloudbase.service.CiBootstrapService;
import com.cloudbase.service.ContainerRuntimeService;
import com.cloudbase.service.DeploymentOrchestrator;
import com.cloudbase.service.PlanQuotaService;
import com.cloudbase.service.ProjectService;
import com.cloudbase.service.ServiceMetricsService;
import com.cloudbase.service.StartCommandValidator;
import com.cloudbase.service.VanitySubdomainService;
import com.cloudbase.service.VolumeMountValidator;
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
import java.util.Locale;
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
    private final ServiceMetricsService serviceMetricsService;
    private final PlanQuotaService planQuotaService;
    private final UserRepository userRepository;
    private final VanitySubdomainService vanitySubdomainService;

    public ProjectServiceImpl(
            ProjectRepository projectRepository,
            ServiceRepository serviceRepository,
            DeploymentRepository deploymentRepository,
            ComposeGenerator composeGenerator,
            DeploymentOrchestrator orchestrator,
            CiBootstrapService ciBootstrapService,
            ContainerRuntimeService containerRuntime,
            ServiceMetricsService serviceMetricsService,
            PlanQuotaService planQuotaService,
            UserRepository userRepository,
            VanitySubdomainService vanitySubdomainService
    ) {
        this.projectRepository = projectRepository;
        this.serviceRepository = serviceRepository;
        this.deploymentRepository = deploymentRepository;
        this.composeGenerator = composeGenerator;
        this.orchestrator = orchestrator;
        this.ciBootstrapService = ciBootstrapService;
        this.containerRuntime = containerRuntime;
        this.serviceMetricsService = serviceMetricsService;
        this.planQuotaService = planQuotaService;
        this.userRepository = userRepository;
        this.vanitySubdomainService = vanitySubdomainService;
    }

    @Override
    public List<ProjectEntity> listForUser(UserEntity user) {
        List<ProjectEntity> projects = user.getRole() == UserRole.ADMIN
                ? projectRepository.findAll()
                : projectRepository.findByOwnerId(user.getId());
        projects.forEach(p -> p.getServices().size());
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
        planQuotaService.assertNotAlreadyOver(user);
        planQuotaService.assertCanCreateProject(user);

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
        requireDeploymentEnabled(user);
        ProjectEntity project = getProject(projectId, user);
        List<ServiceEntity> services = serviceRepository.findByProject_Id(projectId);
        for (ServiceEntity service : services) {
            assertNotActivelyDeploying(service);
        }

        log.info("DELETE project requested id={} name={} services={} by={}",
                projectId, project.getName(), services.size(), user.getEmail());

        // 1) Tear down every service in Portainer/NPM first (verified)
        for (ServiceEntity service : services) {
            cancelActiveDeploymentsQuietly(service.getId());
            orchestrator.removeInfrastructure(service);
        }

        // 2) Project-level leftovers (shared volume folder + project Docker network)
        orchestrator.removeProjectLeftovers(project.getOwnerId(), projectId);

        // 3) DB: deployments → vanity → services → project (shared vars live on project row)
        deploymentRepository.deleteByProjectId(projectId);
        for (ServiceEntity service : services) {
            vanitySubdomainService.clearIfServiceDeleted(service.getId(), project.getOwnerId());
            serviceRepository.delete(service);
        }
        projectRepository.delete(project);
        log.info("DELETE project complete id={} — {} services torn down from Portainer/NPM then DB",
                projectId, services.size());
    }

    @Override
    public ServiceEntity addService(String projectId, UserEntity user, CreateServiceRequest request) {
        requireDeploymentEnabled(user);
        ProjectEntity project = getProject(projectId, user);

        int memoryMb = request.quota() != null ? request.quota().memoryMb() : 512;
        int cpuMilli = request.quota() != null ? request.quota().cpuMilli() : 500;
        int storageGb = request.quota() != null ? request.quota().storageGb() : 2;
        int volumeGb = request.volume() != null ? Math.max(0, request.volume().sizeGb()) : 0;

        planQuotaService.assertNotAlreadyOver(user);
        planQuotaService.assertCanAddService(user, memoryMb, volumeGb, cpuMilli);
        if (request.sourceType() != ServiceSourceType.GITHUB) {
            planQuotaService.assertCanDeploy(user);
        }

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
            if (request.sourceType() == ServiceSourceType.GITHUB) {
                Object existing = details.get("startCommand");
                if (existing == null || String.valueOf(existing).isBlank() || "null".equals(String.valueOf(existing))) {
                    String runtime = String.valueOf(details.getOrDefault("runtime", "node"));
                    details.put("startCommand", defaultStartCommand(runtime));
                }
                String sanitized = StartCommandValidator.sanitizeForStorage(String.valueOf(details.get("startCommand")));
                if (sanitized != null) {
                    details.put("startCommand", sanitized);
                } else {
                    details.remove("startCommand");
                }
                service.setSourceDetails(details);
            } else if (request.sourceType() == ServiceSourceType.DOCKER && details.get("startCommand") != null) {
                String sanitized = StartCommandValidator.sanitizeForStorage(String.valueOf(details.get("startCommand")));
                if (sanitized != null) {
                    details.put("startCommand", sanitized);
                } else {
                    details.remove("startCommand");
                }
                service.setSourceDetails(details);
            }
        }

        if (request.volume() != null) {
            service.setVolumeMountPath(VolumeMountValidator.normalizeAndValidate(request.volume().mountPath()));
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
                saved.setContainerPort(composeGenerator.resolveContainerPort(saved));
            }
            saved = serviceRepository.save(saved);
            // Same as Docker/DB: start deploy (auto-builds image if needed — user stays in CloudBase)
            try {
                orchestrator.startDeploy(saved, user.getEmail(), new DeployServiceRequest(null, null), null);
            } catch (Exception e) {
                log.warn("Auto-deploy on addService (GitHub) failed for {}: {}", saved.getId(), e.toString());
            }
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
        try {
            ServiceStatus live = containerRuntime.resolveLiveStatus(service);
            if (live != service.getStatus()) {
                service.setStatus(live);
                service = serviceRepository.save(service);
            }
        } catch (Exception ignored) {
            // keep stored status — never hang the page on Portainer
        }
        return service;
    }

    @Override
    public void deleteService(String serviceId, UserEntity user) {
        requireDeploymentEnabled(user);
        ServiceEntity service = getService(serviceId, user);
        assertNotActivelyDeploying(service);
        String ownerId = service.getProject().getOwnerId();
        cancelActiveDeploymentsQuietly(serviceId);
        // Portainer + NPM must succeed and verify gone — do not clear vanity / DB if teardown fails
        log.info("DELETE service requested id={} name={} by={}", serviceId, service.getName(), user.getEmail());
        orchestrator.removeInfrastructure(service);
        vanitySubdomainService.clearIfServiceDeleted(serviceId, ownerId);
        deploymentRepository.deleteByServiceId(serviceId);
        serviceRepository.delete(service);
        log.info("DELETE service DB row removed id={} — Portainer/NPM teardown previously verified", serviceId);
    }

    private void assertNotActivelyDeploying(ServiceEntity service) {
        ServiceStatus st = service.getStatus();
        if (st == ServiceStatus.BUILDING || st == ServiceStatus.DEPLOYING) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Stop or wait for the active deploy on \"" + service.getName()
                            + "\" before deleting. CloudBase will not delete mid-deploy.");
        }
    }

    private void cancelActiveDeploymentsQuietly(String serviceId) {
        Instant now = Instant.now();
        for (DeploymentEntity dep : deploymentRepository.findByServiceIdOrderByStartedAtDesc(serviceId)) {
            if (dep.getStatus() == DeploymentStatus.QUEUED
                    || dep.getStatus() == DeploymentStatus.BUILDING
                    || dep.getStatus() == DeploymentStatus.DEPLOYING) {
                dep.setStatus(DeploymentStatus.CANCELLED);
                dep.setFinishedAt(now);
                dep.setLogs((dep.getLogs() == null ? "" : dep.getLogs() + "\n") + "Cancelled by delete");
                deploymentRepository.save(dep);
            } else {
                break;
            }
        }
    }

    @Override
    public ServiceEntity stopService(String serviceId, UserEntity user) {
        requireDeploymentEnabled(user);
        ServiceEntity service = getService(serviceId, user);
        // Abort in-flight deploys so UI cannot stick on DEPLOYING forever
        Instant now = Instant.now();
        for (DeploymentEntity dep : deploymentRepository.findByServiceIdOrderByStartedAtDesc(serviceId)) {
            if (dep.getStatus() == DeploymentStatus.QUEUED
                    || dep.getStatus() == DeploymentStatus.BUILDING
                    || dep.getStatus() == DeploymentStatus.DEPLOYING) {
                dep.setStatus(DeploymentStatus.CANCELLED);
                dep.setFinishedAt(now);
                dep.setLogs((dep.getLogs() == null ? "" : dep.getLogs() + "\n") + "Cancelled by stop");
                deploymentRepository.save(dep);
            } else {
                break;
            }
        }
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
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Restart failed. Try Deploy if the service is not running.");
        }
        service.setStatus(ServiceStatus.RUNNING);
        return serviceRepository.save(service);
    }

    @Override
    public DeploymentEntity deploy(String serviceId, UserEntity user, DeployServiceRequest request) {
        requireDeploymentEnabled(user);
        planQuotaService.assertCanDeploy(user);
        ServiceEntity service = getService(serviceId, user);
        return orchestrator.startDeploy(service, user.getEmail(), request, null);
    }

    @Override
    public DeploymentEntity deployAsSystem(String serviceId, String triggeredBy, DeployServiceRequest request) {
        ServiceEntity service = serviceRepository.findById(serviceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service not found"));
        String ownerId = service.getProject().getOwnerId();
        UserEntity owner = userRepository.findById(ownerId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service owner not found"));
        // Webhooks must not bypass lockouts — same rules as interactive deploy
        requireDeploymentEnabled(owner);
        planQuotaService.assertCanDeploy(owner);
        return orchestrator.startDeploy(service, triggeredBy, request, null);
    }

    @Override
    public DeploymentEntity rollback(String serviceId, String deploymentId, UserEntity user) {
        requireDeploymentEnabled(user);
        planQuotaService.assertCanDeploy(user);
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
        log.info("Env vars updated for {} - pending deploy", serviceId);
        return saved;
    }

    @Override
    public ServiceEntity setSubdomain(String serviceId, UserEntity user, SetSubdomainRequest request) {
        // Legacy endpoint: only accepts bring-your-own domains (not vanity *.baseDomain).
        return setCustomDomain(serviceId, user, new SetCustomDomainRequest(request.subdomain()));
    }

    @Override
    public DomainCheckResponse checkCustomDomain(String serviceId, UserEntity user, String domain) {
        ServiceEntity service = getService(serviceId, user);
        if (service.getSourceType() == ServiceSourceType.DATABASE) {
            return new DomainCheckResponse("", false, "Databases are not publicly routed");
        }

        String raw = normalizeHostname(domain);
        if (raw.isBlank()) {
            return new DomainCheckResponse("", true, "Empty value clears the custom domain");
        }

        String invalid = validateCustomHostname(raw);
        if (invalid != null) {
            return new DomainCheckResponse(raw, false, invalid);
        }

        if (raw.equalsIgnoreCase(nullToEmpty(service.getCustomDomain()))) {
            return new DomainCheckResponse(raw, true, "Already assigned to this service");
        }

        if (isHostnameTakenByOther(raw, serviceId)) {
            return new DomainCheckResponse(raw, false, "Domain already in use");
        }

        return new DomainCheckResponse(raw, true, "Available");
    }

    @Override
    public VanityStatusResponse vanityStatus(String serviceId, UserEntity user) {
        getService(serviceId, user);
        return vanitySubdomainService.status(user, serviceId);
    }

    @Override
    public DomainCheckResponse checkVanitySubdomain(String serviceId, UserEntity user, String slug) {
        getService(serviceId, user);
        return vanitySubdomainService.check(user, serviceId, slug);
    }

    @Override
    public ServiceEntity setVanitySubdomain(String serviceId, UserEntity user, String slug) {
        requireDeploymentEnabled(user);
        getService(serviceId, user);
        return vanitySubdomainService.claim(user, serviceId, slug);
    }

    @Override
    public ServiceEntity clearVanitySubdomain(String serviceId, UserEntity user) {
        requireDeploymentEnabled(user);
        getService(serviceId, user);
        return vanitySubdomainService.release(user, serviceId);
    }

    @Override
    public ServiceEntity setCustomDomain(String serviceId, UserEntity user, SetCustomDomainRequest request) {
        requireDeploymentEnabled(user);
        ServiceEntity service = getService(serviceId, user);
        if (service.getSourceType() == ServiceSourceType.DATABASE) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Databases are not publicly routed");
        }

        orchestrator.ensureOpaquePlatformDomain(service);

        String raw = normalizeHostname(request.domain());
        if (raw.isBlank()) {
            service.setCustomDomain(null);
            ServiceEntity saved = serviceRepository.save(service);
            orchestrator.ensureProxyHost(saved);
            return saved;
        }

        String invalid = validateCustomHostname(raw);
        if (invalid != null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, invalid);
        }
        if (isHostnameTakenByOther(raw, serviceId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Domain already in use");
        }

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

    private static String normalizeHostname(String domain) {
        String raw = domain == null ? "" : domain.trim().toLowerCase();
        raw = raw.replaceFirst("^https?://", "");
        raw = raw.replaceAll("/.*$", "");
        raw = raw.replaceAll("[^a-z0-9.-]", "");
        return raw;
    }

    /** @return error message, or null if valid */
    private String validateCustomHostname(String raw) {
        String base = orchestrator.getBaseDomain();
        if (raw.equals(base) || raw.endsWith("." + base)) {
            return "Use Custom domain for your own hostname, or claim your one vanity subdomain on the platform domain.";
        }
        if (!raw.contains(".") || raw.startsWith(".") || raw.endsWith(".") || raw.contains("..")) {
            return "Enter a full hostname like app.example.com";
        }
        return null;
    }

    private boolean isHostnameTakenByOther(String raw, String serviceId) {
        boolean takenCustom = serviceRepository.findByCustomDomainIgnoreCase(raw)
                .filter(other -> !other.getId().equals(serviceId))
                .isPresent();
        if (takenCustom) {
            return true;
        }
        return serviceRepository.findBySubdomainIgnoreCase(raw)
                .filter(other -> !other.getId().equals(serviceId))
                .isPresent();
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    @Override
    public List<Map<String, Object>> getServiceLogs(String serviceId, UserEntity user, int tail) {
        ServiceEntity service = getService(serviceId, user);
        try {
            List<Map<String, Object>> containerLogs = containerRuntime.fetchLogs(service, tail);
            if (containerLogs != null && !containerLogs.isEmpty()) {
                return containerLogs;
            }
        } catch (ResponseStatusException e) {
            if (e.getStatusCode() != HttpStatus.NOT_FOUND && e.getStatusCode() != HttpStatus.BAD_GATEWAY) {
                throw e;
            }
        } catch (Exception ignored) {
            // fall through to deployment log trail
        }
        List<Map<String, Object>> fromDeploy = deploymentLogLines(serviceId, Math.max(20, tail));
        if (!fromDeploy.isEmpty()) {
            return fromDeploy;
        }
        String hint = switch (service.getStatus()) {
            case BUILDING -> "Build in progress. Container logs appear after the image is ready and Redeploy finishes.";
            case DEPLOYING -> "Starting container… Logs appear once it is running.";
            case FAILED -> "Last deploy did not finish. Open Deployments for details, fix the issue, then Redeploy.";
            case PENDING, STOPPED -> "No running container yet. Deploy the service to see logs.";
            default -> "No running container yet. Deploy the service to see logs.";
        };
        return List.of(Map.of(
                "id", "hint-0",
                "timestamp", Instant.now().toString(),
                "level", "info",
                "stream", "system",
                "message", hint
        ));
    }

    /** When the container is not up yet, surface the latest deployment log trail in the Logs tab. */
    private List<Map<String, Object>> deploymentLogLines(String serviceId, int maxLines) {
        List<DeploymentEntity> deps = deploymentRepository.findByServiceIdOrderByStartedAtDesc(serviceId);
        if (deps.isEmpty()) {
            return List.of();
        }
        List<Map<String, Object>> out = new ArrayList<>();
        int remaining = maxLines;
        for (DeploymentEntity dep : deps) {
            if (remaining <= 0) {
                break;
            }
            Instant base = dep.getStartedAt() != null ? dep.getStartedAt() : Instant.now();
            out.add(Map.of(
                    "id", dep.getId() + "-head",
                    "timestamp", base.toString(),
                    "level", "info",
                    "stream", "deploy",
                    "message", "── Deploy " + dep.getId() + " · " + dep.getStatus() + " ──"
            ));
            remaining--;
            String raw = dep.getLogs();
            if (raw == null || raw.isBlank()) {
                continue;
            }
            String[] parts = raw.replace("\r\n", "\n").replace('\r', '\n').split("\n");
            Instant lineTs = base;
            for (String part : parts) {
                if (remaining <= 0) {
                    break;
                }
                String msg = part.trim();
                if (msg.isEmpty()) {
                    continue;
                }
                lineTs = lineTs.plusMillis(50);
                String level = "info";
                String lower = msg.toLowerCase(Locale.ROOT);
                if (lower.contains("could not") || lower.contains("failed") || lower.contains("error")) {
                    level = "error";
                } else if (lower.contains("wait") || lower.contains("connect github") || lower.contains("not ready")) {
                    level = "warn";
                }
                out.add(Map.of(
                        "id", dep.getId() + "-" + remaining,
                        "timestamp", lineTs.toString(),
                        "level", level,
                        "stream", "deploy",
                        "message", softenDeployLogLine(msg)
                ));
                remaining--;
            }
            if (deps.indexOf(dep) == 0) {
                break; // latest deployment is enough for the Logs tab
            }
        }
        return out;
    }

    private static String softenDeployLogLine(String msg) {
        return msg
                .replaceAll("(?i)\\bHTTP\\s*\\d{3}\\b", "")
                .replaceAll("(?i)\\bcb-svc-[a-z0-9]+\\b", "")
                .replaceAll("(?i)Failed to write \\.github/workflows/\\S+", "Could not set up the build workflow")
                .replaceAll("(?i)Setup failed:\\s*", "")
                .replaceAll("\\s{2,}", " ")
                .trim();
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
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Could not run command. Try again after Deploy.");
        }
    }

    @Override
    public Map<String, Object> getServiceMetrics(String serviceId, UserEntity user) {
        return getServiceMetrics(serviceId, user, "1h");
    }

    @Override
    public Map<String, Object> getServiceMetrics(String serviceId, UserEntity user, String range) {
        ServiceEntity service = getService(serviceId, user);
        Map<String, Object> live = containerRuntime.fetchMetrics(service);
        try {
            serviceMetricsService.recordSample(serviceId, live);
        } catch (Exception e) {
            log.debug("Could not persist metrics sample for {}: {}", serviceId, e.toString());
        }
        Map<String, Object> out = new LinkedHashMap<>(live);
        out.put("range", range == null || range.isBlank() ? "1h" : range);
        out.put("history", serviceMetricsService.history(serviceId, range));
        return out;
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
        requireDeploymentEnabled(user);
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
            Map<String, Object> previousDetails = service.getSourceDetails() != null
                    ? new HashMap<>(service.getSourceDetails())
                    : new HashMap<>();
            Map<String, Object> details = new HashMap<>(previousDetails);
            details.putAll(request.sourceDetails());

            // Database engine + internal port are immutable after create.
            if (service.getSourceType() == ServiceSourceType.DATABASE) {
                Object lockedType = previousDetails.get("dbType");
                if (lockedType != null) {
                    details.put("dbType", lockedType);
                }
                Object lockedPort = previousDetails.get("containerPort");
                if (lockedPort != null) {
                    details.put("containerPort", lockedPort);
                } else if (service.getContainerPort() != null) {
                    details.put("containerPort", service.getContainerPort());
                }
            }

            if (request.sourceDetails().get("runtime") != null) {
                details.put("runtime", request.sourceDetails().get("runtime"));
            }
            if (details.containsKey("startCommand")) {
                String sanitized = StartCommandValidator.sanitizeForStorage(String.valueOf(details.get("startCommand")));
                if (sanitized != null) {
                    details.put("startCommand", sanitized);
                } else {
                    details.remove("startCommand");
                }
            }
            service.setSourceDetails(details);
            if (details.get("containerPort") instanceof Number n) {
                service.setContainerPort(n.intValue());
            } else {
                service.setContainerPort(composeGenerator.resolveContainerPort(service));
            }
            // Re-bootstrap CI only when GitHub build source fields actually change (avoid slow GitHub I/O on every save)
            if (service.getSourceType() == com.cloudbase.model.ServiceSourceType.GITHUB
                    && githubCiFieldsChanged(previousDetails, details)) {
                ServiceEntity savedGh = serviceRepository.save(service);
                try {
                    Map<String, Object> enriched = ciBootstrapService.bootstrapGitHubService(user, savedGh);
                    savedGh.setSourceDetails(enriched);
                    if (enriched.get("containerPort") instanceof Number pn) {
                        savedGh.setContainerPort(pn.intValue());
                    }
                    return serviceRepository.save(savedGh);
                } catch (Exception e) {
                    log.warn("CI re-bootstrap on update failed for {}: {}", serviceId, e.toString());
                }
            }
        }
        if (request.runtime() != null && !request.runtime().isBlank()) {
            Map<String, Object> details = service.getSourceDetails() != null
                    ? new HashMap<>(service.getSourceDetails())
                    : new HashMap<>();
            details.put("runtime", request.runtime().trim());
            service.setSourceDetails(details);
        }
        if (request.quota() != null) {
            int memDelta = request.quota().memoryMb() - service.getQuotaMemoryMb();
            int cpuDelta = request.quota().cpuMilli() - service.getQuotaCpuMilli();
            planQuotaService.assertCanUpdateQuotas(user, memDelta, 0, cpuDelta);
            service.setQuotaMemoryMb(request.quota().memoryMb());
            service.setQuotaCpuMilli(request.quota().cpuMilli());
            service.setQuotaStorageGb(request.quota().storageGb());
        }
        if (Boolean.TRUE.equals(request.removeVolume())) {
            service.setVolumeMountPath(null);
            service.setVolumeSizeGb(null);
        } else if (request.volume() != null) {
            int oldVol = service.getVolumeSizeGb() != null ? service.getVolumeSizeGb() : 0;
            int newVol = request.volume().sizeGb();
            planQuotaService.assertCanUpdateQuotas(user, 0, newVol - oldVol, 0);
            service.setVolumeMountPath(VolumeMountValidator.normalizeAndValidate(request.volume().mountPath()));
            service.setVolumeSizeGb(request.volume().sizeGb());
        }
        return serviceRepository.save(service);
    }

    @Override
    public DeploymentEntity cancelDeployment(String serviceId, String deploymentId, UserEntity user) {
        requireDeploymentEnabled(user);
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
        DeploymentEntity saved = deploymentRepository.save(dep);

        serviceRepository.findById(serviceId).ifPresent(s -> {
            if (s.getStatus() == ServiceStatus.DEPLOYING
                    || s.getStatus() == ServiceStatus.BUILDING
                    || s.getStatus() == ServiceStatus.PENDING) {
                s.setStatus(ServiceStatus.STOPPED);
                serviceRepository.save(s);
            }
        });
        return saved;
    }

    private static boolean githubCiFieldsChanged(Map<String, Object> before, Map<String, Object> after) {
        if (after == null) {
            return false;
        }
        String[] keys = {
                "repositoryUrl", "branch", "rootDirectory", "buildCommand", "runtime", "startCommand"
        };
        for (String key : keys) {
            String a = String.valueOf(before != null ? before.getOrDefault(key, "") : "").trim();
            String b = String.valueOf(after.getOrDefault(key, "")).trim();
            if ("null".equalsIgnoreCase(a)) a = "";
            if ("null".equalsIgnoreCase(b)) b = "";
            if (!a.equals(b)) {
                return true;
            }
        }
        return false;
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

    private static String defaultStartCommand(String runtime) {
        String r = runtime == null ? "node" : runtime.toLowerCase(java.util.Locale.ROOT);
        return switch (r) {
            case "java" -> "java -jar /app/app.jar";
            case "python" -> "python -m uvicorn main:app --host 0.0.0.0 --port 8000";
            case "go" -> "/app/app";
            case "dotnet" -> "dotnet App.dll";
            case "php" -> "apache2-foreground";
            case "rust" -> "/app/app";
            case "node" -> "nginx -g \"daemon off;\"";
            default -> "";
        };
    }

    /**
     * Hard gate for all mutating / deploy actions.
     * Admins are exempt. Everyone else must be ACTIVE with deploymentEnabled.
     */
    private void requireDeploymentEnabled(UserEntity user) {
        if (user.getRole() == UserRole.ADMIN) {
            return;
        }
        if (user.getAccountStatus() != AccountStatus.ACTIVE) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Account is suspended. Deploy and manage actions are blocked.");
        }
        if (!user.isDeploymentEnabled()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Deployment access is disabled. An admin must enable Deploy before you can manage projects or services.");
        }
    }

    private void requireOwnerOrAdmin(String ownerId, UserEntity user) {
        if (user.getRole() != UserRole.ADMIN && !ownerId.equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Access denied");
        }
    }
}
