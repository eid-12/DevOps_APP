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
import com.cloudbase.service.ComposeInputValidator;
import com.cloudbase.service.ContainerRuntimeService;
import com.cloudbase.service.DeploymentOrchestrator;
import com.cloudbase.service.DomainOwnershipVerifier;
import com.cloudbase.entity.IdempotencyKeyEntity;
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
import java.util.Optional;
import java.util.UUID;

@Service
@Transactional
public class ProjectServiceImpl implements ProjectService {

    private static final String SETUP_PENDING_CI = "PENDING_CI";
    private static final String SETUP_PENDING_DEPLOY = "PENDING_DEPLOY";
    private static final String SETUP_FAILED = "FAILED";
    private static final String SETUP_DONE = "DONE";
    private static final int SETUP_RESUME_AFTER_SECONDS = 60;
    private static final List<com.cloudbase.model.DeploymentStatus> IN_FLIGHT = List.of(
            com.cloudbase.model.DeploymentStatus.QUEUED, com.cloudbase.model.DeploymentStatus.BUILDING,
            com.cloudbase.model.DeploymentStatus.DEPLOYING);
    private static final List<com.cloudbase.model.DeploymentStatus> DELIVERED_OR_RUNNING = List.of(
            com.cloudbase.model.DeploymentStatus.QUEUED, com.cloudbase.model.DeploymentStatus.BUILDING,
            com.cloudbase.model.DeploymentStatus.DEPLOYING, com.cloudbase.model.DeploymentStatus.SUCCESS);

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
    @org.springframework.beans.factory.annotation.Autowired
    private com.cloudbase.repository.IdempotencyKeyRepository idempotencyKeys;
    @org.springframework.beans.factory.annotation.Autowired
    private org.springframework.transaction.support.TransactionTemplate transactions;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.cloudbase.service.DockerJanitor dockerJanitor;
    @jakarta.persistence.PersistenceContext
    private jakarta.persistence.EntityManager entityManager;
    private final UserRepository userRepository;
    private final VanitySubdomainService vanitySubdomainService;

    private final DomainOwnershipVerifier domainOwnershipVerifier;
    /** A requested custom domain must be proven within this time, or requested again. */
    static final java.time.Duration DOMAIN_CLAIM_TTL = java.time.Duration.ofHours(72);

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
            VanitySubdomainService vanitySubdomainService,
            DomainOwnershipVerifier domainOwnershipVerifier
    ) {
        this.domainOwnershipVerifier = domainOwnershipVerifier;
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
    public ProjectEntity createProject(UserEntity user, CreateProjectRequest request, String idempotencyKey) {
        requireDeploymentEnabled(user);
        planQuotaService.assertNotAlreadyOver(user);
        planQuotaService.assertCanCreateProject(user);

        lockOwner(user.getId());
        Optional<ProjectEntity> replay = findReplay(user.getId(), idempotencyKey, "project", request.toString(),
                projectRepository::findById);
        if (replay.isPresent()) {
            return replay.get();
        }

        ProjectEntity project = ProjectEntity.builder()
                .id("proj-" + UUID.randomUUID().toString().substring(0, 8))
                .ownerId(user.getId())
                .ownerName(user.getName())
                .name(request.name())
                .description(request.description())
                .status(ProjectStatus.ACTIVE)
                .build();

        ProjectEntity saved = projectRepository.save(project);
        rememberKey(user.getId(), idempotencyKey, "project", request.toString(), saved.getId());
        return saved;
    }

    /** The original resource when this key was already applied; a key reused for other input is refused. */
    private <T> Optional<T> findReplay(String ownerId, String key, String type, String input,
                                       java.util.function.Function<String, Optional<T>> load) {
        if (key == null) {
            return Optional.empty();
        }
        if (!key.matches("[A-Za-z0-9-]{8,64}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid Idempotency-Key");
        }
        var stored = idempotencyKeys.findById(new IdempotencyKeyEntity.Key(ownerId, key));
        if (stored.isEmpty()) {
            return Optional.empty();
        }
        if (!stored.get().getResourceType().equals(type) || !stored.get().getRequestHash().equals(requestHash(input))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This Idempotency-Key was used for a different request");
        }
        Optional<T> resource = load.apply(stored.get().getResourceId());
        if (resource.isEmpty()) {
            idempotencyKeys.delete(stored.get()); // deleted since: a new create is legitimate
            idempotencyKeys.flush();
        }
        return resource;
    }

    private void rememberKey(String ownerId, String key, String type, String input, String resourceId) {
        if (key != null) {
            idempotencyKeys.save(new IdempotencyKeyEntity(ownerId, key, requestHash(input), type, resourceId, Instant.now()));
        }
    }

    private static String requestHash(String input) {
        try {
            return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
                    .digest(String.valueOf(input).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
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
        if (dockerJanitor != null) dockerJanitor.requestPass();
        log.info("DELETE project complete id={} — {} services torn down from Portainer/NPM then DB",
                projectId, services.size());
    }

    /**
     * Creation is a sequence of committed steps, not one transaction: the service row (with its progress and
     * the idempotency key) commits before any external effect, and each step commits after its effect. A crash
     * therefore leaves a tracked row. Repeating a step is safe because GitHub files and webhooks and the stack
     * (named after the service id) are reused. Nothing is ever deleted as compensation.
     */
    @Override
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
    public ServiceEntity addService(String projectId, UserEntity user, CreateServiceRequest request, String idempotencyKey) {
        String serviceId = transactions.execute(tx -> createServiceRecord(projectId, user, request, idempotencyKey));
        return finishSetup(serviceId, user.getEmail(), true);
    }

    private String createServiceRecord(String projectId, UserEntity user, CreateServiceRequest request, String idempotencyKey) {
        requireDeploymentEnabled(user);
        ProjectEntity project = getProject(projectId, user);

        lockOwner(project.getOwnerId());
        Optional<ServiceEntity> replay = findReplay(project.getOwnerId(), idempotencyKey, "service",
                projectId + "/" + request, serviceRepository::findById);
        if (replay.isPresent()) {
            return replay.get().getId();
        }

        int memoryMb = request.quota() != null ? request.quota().memoryMb() : 512;
        int cpuMilli = request.quota() != null ? request.quota().cpuMilli() : 500;
        int storageGb = request.quota() != null ? request.quota().storageGb() : 2;
        ComposeInputValidator.requireResourceLimits(memoryMb, cpuMilli, storageGb);
        int volumeGb = request.volume() != null ? Math.max(0, request.volume().sizeGb()) : 0;

        planQuotaService.assertNotAlreadyOver(user);
        planQuotaService.assertCanAddService(user, memoryMb, volumeGb, cpuMilli);
        if (request.sourceType() != ServiceSourceType.GITHUB) {
            planQuotaService.assertCanDeploy(user);
        }

        Map<String, Object> details = request.sourceDetails() != null
                ? new HashMap<>(request.sourceDetails())
                : new HashMap<>();
        if (request.sourceType() == ServiceSourceType.GITHUB) {
            rejectManagedGitHubFields(details);
            // Refuse before anything is stored or provisioned: no service may bind a repository its owner cannot push to.
            ciBootstrapService.assertCanPush(serviceOwner(project), String.valueOf(details.getOrDefault("repositoryUrl", "")));
        }
        validateImageDetails(details);
        if (request.sourceType() == ServiceSourceType.DATABASE) {
            // Pinned now: apps keep reaching this database by the same host and schema name after any rename.
            details.put(ComposeGenerator.DB_NAME_KEY, ComposeGenerator.sanitizeDbIdentifier(request.name()));
            details.put(ComposeGenerator.HOST_NAME_KEY, ComposeGenerator.sanitizeName(request.name()));
        }

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
                .setupState(request.sourceType() == ServiceSourceType.GITHUB ? SETUP_PENDING_CI : SETUP_PENDING_DEPLOY)
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
        rememberKey(project.getOwnerId(), idempotencyKey, "service", projectId + "/" + request, saved.getId());
        return saved.getId();
    }

    /** Runs the remaining steps. Each holds the owner lock, so concurrent retries and recovery take turns. */
    private ServiceEntity finishSetup(String serviceId, String actor, boolean retryFailed) {
        try {
            transactions.executeWithoutResult(tx -> {
                ServiceEntity service = lockedService(serviceId);
                if (retryFailed && SETUP_FAILED.equals(service.getSetupState())) {
                    service.setSetupState(service.getSourceType() == ServiceSourceType.GITHUB ? SETUP_PENDING_CI : SETUP_PENDING_DEPLOY);
                    service.setStatus(ServiceStatus.PENDING);
                }
                if (SETUP_PENDING_CI.equals(service.getSetupState())) {
                    Map<String, Object> enriched = ciBootstrapService.bootstrapGitHubService(serviceOwner(service), service);
                    service.setSourceDetails(enriched);
                    service.setContainerPort(enriched.get("containerPort") instanceof Number n
                            ? Integer.valueOf(n.intValue()) : composeGenerator.resolveContainerPort(service));
                    service.setSetupState(SETUP_PENDING_DEPLOY);
                }
                serviceRepository.save(service);
            });
        } catch (RuntimeException e) {
            transactions.executeWithoutResult(tx -> {
                ServiceEntity service = lockedService(serviceId);
                if (SETUP_PENDING_CI.equals(service.getSetupState())) {
                    service.setSetupState(SETUP_FAILED);
                    service.setStatus(ServiceStatus.FAILED);
                    serviceRepository.save(service);
                }
            });
            throw e;
        }
        transactions.executeWithoutResult(tx -> {
            ServiceEntity service = lockedService(serviceId);
            if (SETUP_PENDING_DEPLOY.equals(service.getSetupState())) {
                service.setSetupState(SETUP_DONE);
                serviceRepository.save(service);
                try {
                    orchestrator.startDeploy(service, actor, new DeployServiceRequest(null, null), null);
                } catch (Exception e) {
                    log.warn("Auto-deploy on addService failed for {}: {}", serviceId, e.toString());
                }
            }
        });
        return transactions.execute(tx -> serviceRepository.findByIdWithProject(serviceId).orElseThrow());
    }

    private ServiceEntity lockedService(String serviceId) {
        ServiceEntity service = serviceRepository.findByIdWithProject(serviceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service not found"));
        lockOwner(service.getProject().getOwnerId());
        entityManager.refresh(service);
        return service;
    }

    @Override
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
    public void resumeInterruptedSetups() {
        Instant before = Instant.now().minusSeconds(SETUP_RESUME_AFTER_SECONDS);
        for (ServiceEntity s : serviceRepository.findBySetupStateInAndCreatedAtBefore(List.of(SETUP_PENDING_CI, SETUP_PENDING_DEPLOY), before)) {
            try {
                finishSetup(s.getId(), "setup-recovery", false);
            } catch (RuntimeException e) {
                log.warn("Setup recovery failed for {}: {}", s.getId(), e.toString());
            }
        }
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
        if (dockerJanitor != null) dockerJanitor.requestPass(); // clear anything the teardown could not (e.g. an image freed by this delete)
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
        List<DeploymentEntity> active = deploymentRepository.findByServiceIdAndStatusInAndFinishedAtIsNull(
                serviceId,
                List.of(DeploymentStatus.QUEUED, DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING)
        );
        for (DeploymentEntity dep : active) {
            dep.setStatus(DeploymentStatus.CANCELLED);
            dep.setFinishedAt(now);
            dep.setLogs((dep.getLogs() == null ? "" : dep.getLogs() + "\n") + "Cancelled by delete");
            deploymentRepository.save(dep);
        }
    }

    @Override
    public ServiceEntity stopService(String serviceId, UserEntity user) {
        requireDeploymentEnabled(user);
        ServiceEntity service = getService(serviceId, user);
        // Abort ALL in-flight deploys (including orphans under newer SUCCESS rows)
        Instant now = Instant.now();
        List<DeploymentEntity> active = deploymentRepository.findByServiceIdAndStatusInAndFinishedAtIsNull(
                serviceId,
                List.of(DeploymentStatus.QUEUED, DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING)
        );
        for (DeploymentEntity dep : active) {
            dep.setStatus(DeploymentStatus.CANCELLED);
            dep.setFinishedAt(now);
            dep.setLogs((dep.getLogs() == null ? "" : dep.getLogs() + "\n") + "Cancelled by stop");
            deploymentRepository.save(dep);
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
        if (request != null && request.imageTag() != null && !request.imageTag().isBlank()) {
            ComposeInputValidator.requireImageTag(request.imageTag().trim());
        }
        // A double click or retry with the same input joins the running attempt, however old it is
        // (StaleDeploymentCleanup ends stuck ones). A different commit or tag still supersedes it.
        lockOwner(service.getProject().getOwnerId());
        String tag = request == null ? null : request.imageTag();
        String commit = request == null ? null : request.commitSha();
        var inFlight = deploymentRepository.findByServiceIdAndStatusInAndFinishedAtIsNull(serviceId, IN_FLIGHT).stream()
                .filter(ProjectServiceImpl::isRealAttempt)
                .filter(d -> java.util.Objects.equals(d.getImageTag(), tag) && java.util.Objects.equals(d.getCommitSha(), commit))
                .findFirst();
        if (inFlight.isPresent()) {
            return inFlight.get();
        }
        return orchestrator.startDeploy(service, user.getEmail(), request, null);
    }

    @Override
    public ServiceEntity syncGitHubCi(String serviceId, UserEntity user) {
        requireDeploymentEnabled(user);
        ServiceEntity service = getService(serviceId, user);
        if (service.getSourceType() != ServiceSourceType.GITHUB) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CI sync is only for GitHub services");
        }
        // Ensure auto-deploy stays on when user asks to sync CI/webhook
        Map<String, Object> details = service.getSourceDetails() != null
                ? new HashMap<>(service.getSourceDetails())
                : new HashMap<>();
        if (!details.containsKey("autoDeploy")) {
            details.put("autoDeploy", true);
        }
        service.setSourceDetails(details);
        ServiceEntity saved = serviceRepository.save(service);
        Map<String, Object> enriched = ciBootstrapService.bootstrapGitHubService(serviceOwner(saved), saved);
        saved.setSourceDetails(enriched);
        if (enriched.get("containerPort") instanceof Number n) {
            saved.setContainerPort(n.intValue());
        }
        return serviceRepository.save(saved);
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
        // GitHub redelivers webhooks: one commit deploys once unless the earlier attempt failed.
        lockOwner(ownerId);
        if (request != null && request.commitSha() != null) {
            var existing = deploymentRepository.findByServiceIdAndCommitShaAndStatusIn(
                    serviceId, request.commitSha(), DELIVERED_OR_RUNNING).stream()
                    .filter(ProjectServiceImpl::isRealAttempt)
                    .findFirst();
            if (existing.isPresent()) {
                return existing.get();
            }
        }
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
    public List<DeploymentEntity> getDeployments(String serviceId, UserEntity user, int page, int size) {
        getService(serviceId, user);
        return deploymentRepository.findByServiceIdOrderByStartedAtDesc(serviceId, org.springframework.data.domain.PageRequest.of(
                Math.max(0, page), Math.min(100, Math.max(1, size))));
    }

    @Override
    public ServiceEntity updateEnvVars(String serviceId, UserEntity user, UpdateEnvVarsRequest request) {
        requireDeploymentEnabled(user);
        ServiceEntity service = getService(serviceId, user);
        Map<String, Object> previous = service.getEnvVars() != null ? service.getEnvVars() : Map.of();
        Map<String, Object> next = toEnvMap(request.envVars());
        // A project shared variable saved back unchanged stays a shared copy (it keeps following the project).
        next.replaceAll((key, value) -> {
            if (previous.get(key) instanceof Map<?, ?> old && Boolean.TRUE.equals(old.get(DeploymentOrchestrator.SHARED_MARKER))
                    && value instanceof Map<?, ?> now && java.util.Objects.equals(String.valueOf(old.get("value")), String.valueOf(now.get("value")))) {
                Map<String, Object> kept = new LinkedHashMap<>();
                kept.put("value", now.get("value"));
                kept.put("isSecret", now.get("isSecret"));
                kept.put(DeploymentOrchestrator.SHARED_MARKER, true);
                return kept;
            }
            return value;
        });
        service.setEnvVars(next);
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
            service.setCustomDomainVerifiedAt(null);
            clearDomainClaim(service);
            ServiceEntity saved = serviceRepository.save(service);
            orchestrator.ensureProxyHost(saved);
            return saved;
        }

        String invalid = validateCustomHostname(raw);
        if (invalid != null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, invalid);
        }
        if (raw.equalsIgnoreCase(nullToEmpty(service.getCustomDomain()))) {
            clearDomainClaim(service);
            return serviceRepository.save(service);
        }
        if (isHostnameTakenByOther(raw, serviceId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Domain already in use");
        }

        // Only a claim: nothing is routed, and other tenants may claim the same name, until DNS proves ownership.
        // The current domain (if any) keeps working meanwhile.
        if (!raw.equals(service.getCustomDomainPending()) || claimExpired(service)) {
            service.setCustomDomainPending(raw);
            service.setCustomDomainToken(java.util.HexFormat.of().formatHex(randomBytes(16)));
            service.setCustomDomainRequestedAt(java.time.Instant.now());
        }
        return serviceRepository.save(service);
    }

    @Override
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
    public ServiceEntity verifyCustomDomain(String serviceId, UserEntity user) {
        requireDeploymentEnabled(user);
        // 1. Checks and the DNS proof, holding no transaction during the lookup.
        ServiceEntity current = transactions.execute(tx -> getService(serviceId, user));
        String pending = current.getCustomDomainPending();
        String token = current.getCustomDomainToken();
        if (pending == null || pending.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No custom domain is waiting for verification");
        }
        if (claimExpired(current)) {
            throw new ResponseStatusException(HttpStatus.GONE,
                    "This verification request expired. Save the domain again to get a new TXT value.");
        }
        if (isHostnameTakenByOther(pending, serviceId)) {
            discardClaim(serviceId, token);
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Domain already in use");
        }
        if (!domainOwnershipVerifier.proves(pending, token)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TXT record not found yet. Add a TXT record named "
                    + DomainOwnershipVerifier.recordName(pending) + " with the value "
                    + DomainOwnershipVerifier.recordValue(token) + ", wait for DNS to update, then verify again.");
        }
        // 2. Activate, only if the claim is still the one that was proven. The unique index settles races.
        String previous = current.getCustomDomain();
        java.time.Instant previousVerifiedAt = current.getCustomDomainVerifiedAt();
        java.time.Instant requestedAt = current.getCustomDomainRequestedAt();
        try {
            transactions.executeWithoutResult(tx -> {
                ServiceEntity s = lockedService(serviceId);
                if (!pending.equals(s.getCustomDomainPending()) || !token.equals(s.getCustomDomainToken())) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "The domain request changed; verify again");
                }
                s.setCustomDomain(pending);
                s.setCustomDomainVerifiedAt(java.time.Instant.now());
                clearDomainClaim(s);
                if (s.getContainerName() == null) s.setContainerName(composeGenerator.resolveContainerName(s));
                if (s.getContainerPort() == null) s.setContainerPort(composeGenerator.resolveContainerPort(s));
                serviceRepository.saveAndFlush(s);
            });
        } catch (org.springframework.dao.DataIntegrityViolationException e) {
            discardClaim(serviceId, token);
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Domain already in use");
        }
        // 3. Route it now. If routing fails, put the previous domain and the claim back and route those again.
        try {
            orchestrator.routeNow(serviceId);
        } catch (RuntimeException routingFailure) {
            log.warn("Routing {} for {} failed; restoring the previous domain: {}", pending, serviceId, routingFailure.getMessage());
            transactions.executeWithoutResult(tx -> {
                ServiceEntity s = lockedService(serviceId);
                s.setCustomDomain(previous);
                s.setCustomDomainVerifiedAt(previousVerifiedAt);
                s.setCustomDomainPending(pending);
                s.setCustomDomainToken(token);
                s.setCustomDomainRequestedAt(requestedAt);
                serviceRepository.saveAndFlush(s);
            });
            try {
                orchestrator.routeNow(serviceId);
            } catch (RuntimeException e) {
                log.error("Restoring routes for {} also failed: {}", serviceId, e.getMessage());
            }
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Ownership is proven, but " + pending
                    + " could not be routed right now. "
                    + (previous == null ? "Nothing changed" : previous + " stays active") + "; verify again in a minute.");
        }
        return transactions.execute(tx -> getService(serviceId, user));
    }

    /**
     * A claim that lost to another service's active domain ends here, so a later claim gets a fresh token and TXT
     * values published for this one can never activate the domain afterwards.
     */
    private void discardClaim(String serviceId, String token) {
        transactions.executeWithoutResult(tx -> {
            ServiceEntity s = lockedService(serviceId);
            if (token.equals(s.getCustomDomainToken())) {
                clearDomainClaim(s);
                serviceRepository.save(s);
            }
        });
    }

    private static boolean claimExpired(ServiceEntity service) {
        return service.getCustomDomainRequestedAt() == null
                || service.getCustomDomainRequestedAt().plus(DOMAIN_CLAIM_TTL).isBefore(java.time.Instant.now());
    }

    private static void clearDomainClaim(ServiceEntity service) {
        service.setCustomDomainPending(null);
        service.setCustomDomainToken(null);
        service.setCustomDomainRequestedAt(null);
    }

    private static byte[] randomBytes(int n) {
        byte[] b = new byte[n];
        new java.security.SecureRandom().nextBytes(b);
        return b;
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
        List<Map<String, Object>> deploy = deploymentLogLines(serviceId, Math.max(40, Math.min(80, tail)));
        List<Map<String, Object>> container = List.of();
        try {
            List<Map<String, Object>> fetched = containerRuntime.fetchLogs(service, tail);
            if (fetched != null && !fetched.isEmpty()) {
                container = fetched;
            }
        } catch (ResponseStatusException e) {
            if (e.getStatusCode() != HttpStatus.NOT_FOUND && e.getStatusCode() != HttpStatus.BAD_GATEWAY) {
                throw e;
            }
        } catch (Exception ignored) {
            // fall through to deployment log trail
        }
        if (!deploy.isEmpty() && !container.isEmpty()) {
            List<Map<String, Object>> merged = new ArrayList<>(deploy.size() + container.size() + 1);
            merged.addAll(deploy);
            merged.add(Map.of(
                    "id", "split-container",
                    "timestamp", Instant.now().toString(),
                    "level", "info",
                    "stream", "system",
                    "message", "── Container logs (Portainer) ──"
            ));
            merged.addAll(container);
            return merged;
        }
        if (!container.isEmpty()) {
            return container;
        }
        if (!deploy.isEmpty()) {
            return deploy;
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
        // Same definitions the compose file uses, so the address and schema shown always match the container.
        String networkHost = ComposeGenerator.serviceHostName(service);
        String database = ComposeGenerator.databaseName(service);
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
        // "url" is the standard form most apps read (Node, Python, Go, PHP); Java gets "jdbcUrl".
        // "appVariable" is a line to paste into an app's variables: it references the password instead of copying
        // it, and CloudBase fills it in at deploy time (see DeploymentOrchestrator.resolveReferences).
        // By the pinned host name, not the display name: the reference keeps working after the database is renamed.
        String ref = "${{" + networkHost + ".";
        switch (dbType) {
            case POSTGRESQL -> {
                info.put("database", database);
                info.put("username", "cbuser");
                info.put("password", password);
                info.put("url", "postgresql://cbuser:" + urlEncode(password) + "@" + networkHost + ":" + port + "/" + database);
                info.put("jdbcUrl", "jdbc:postgresql://" + networkHost + ":" + port + "/" + database);
                info.put("appVariable", "DATABASE_URL=postgresql://cbuser:" + ref + "DB_PASSWORD}}@" + networkHost + ":" + port + "/" + database);
            }
            case MYSQL -> {
                info.put("database", database);
                info.put("username", "cbuser");
                info.put("password", password);
                info.put("url", "mysql://cbuser:" + urlEncode(password) + "@" + networkHost + ":" + port + "/" + database);
                info.put("jdbcUrl", "jdbc:mysql://" + networkHost + ":" + port + "/" + database);
                info.put("appVariable", "DATABASE_URL=mysql://cbuser:" + ref + "DB_PASSWORD}}@" + networkHost + ":" + port + "/" + database);
            }
            case REDIS -> {
                info.put("password", password);
                info.put("url", "redis://:" + urlEncode(password) + "@" + networkHost + ":" + port);
                info.put("appVariable", "REDIS_URL=redis://:" + ref + "REDIS_PASSWORD}}@" + networkHost + ":" + port);
            }
            case MONGODB -> {
                info.put("username", "cbuser");
                info.put("password", password);
                info.put("url", "mongodb://cbuser:" + urlEncode(password) + "@" + networkHost + ":" + port + "/?authSource=admin");
                info.put("appVariable", "MONGO_URL=mongodb://cbuser:" + ref + "MONGO_PASSWORD}}@" + networkHost + ":" + port + "/?authSource=admin");
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
            if (vars.size() >= com.cloudbase.dto.ProjectDtos.MAX_ENV_VARS) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "A project can hold at most " + com.cloudbase.dto.ProjectDtos.MAX_ENV_VARS + " shared variables");
            }
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
        requireMaxLength(request.name(), com.cloudbase.dto.ProjectDtos.MAX_NAME, "Name");
        requireMaxLength(request.description(), com.cloudbase.dto.ProjectDtos.MAX_DESCRIPTION, "Description");
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
        if (service.getSourceType() == ServiceSourceType.DATABASE) {
            pinDatabaseNames(service); // databases made before pinning: freeze today's names before any rename
        }
        boolean refreshCi = false;
        requireMaxLength(request.name(), com.cloudbase.dto.ProjectDtos.MAX_NAME, "Name");
        if (request.sourceDetails() != null && request.sourceDetails().size() > 50) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Too many source settings");
        }
        if (request.name() != null && !request.name().isBlank()) {
            service.setName(request.name().trim());
        }
        if (request.sourceDetails() != null) {
            if (service.getSourceType() == ServiceSourceType.GITHUB) rejectManagedGitHubFields(request.sourceDetails());
            Map<String, Object> previousDetails = service.getSourceDetails() != null
                    ? new HashMap<>(service.getSourceDetails())
                    : new HashMap<>();
            Map<String, Object> details = new HashMap<>(previousDetails);
            details.putAll(request.sourceDetails());
            validateImageDetails(details);

            // Database engine, internal port, host name and schema name are immutable after create.
            if (service.getSourceType() == ServiceSourceType.DATABASE) {
                for (String pinned : List.of(ComposeGenerator.DB_NAME_KEY, ComposeGenerator.HOST_NAME_KEY)) {
                    if (previousDetails.get(pinned) != null) details.put(pinned, previousDetails.get(pinned));
                }
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
                refreshCi = true;
            }
            String previousRepo = previousDetails == null ? "" : String.valueOf(previousDetails.getOrDefault("repositoryUrl", ""));
            if (service.getSourceType() == ServiceSourceType.GITHUB
                    && !previousRepo.equals(String.valueOf(details.getOrDefault("repositoryUrl", "")))) {
                // A new repository needs its own authority check; the old verification never carries over.
                ciBootstrapService.assertCanPush(serviceOwner(service), String.valueOf(details.getOrDefault("repositoryUrl", "")));
                details.remove(CiBootstrapServiceImpl.REPO_ACCESS_VERIFIED);
                service.setSourceDetails(details);
            }
        }
        if (request.runtime() != null && !request.runtime().isBlank()) {
            Map<String, Object> details = service.getSourceDetails() != null
                    ? new HashMap<>(service.getSourceDetails())
                    : new HashMap<>();
            if (service.getSourceType() == ServiceSourceType.GITHUB
                    && !request.runtime().trim().equals(details.get("runtime"))) refreshCi = true;
            details.put("runtime", request.runtime().trim());
            service.setSourceDetails(details);
        }
        if (request.quota() != null) {
            ComposeInputValidator.requireResourceLimits(
                    request.quota().memoryMb(), request.quota().cpuMilli(), request.quota().storageGb());
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
        if (refreshCi) {
            Map<String, Object> enriched = ciBootstrapService.bootstrapGitHubService(serviceOwner(service), service);
            service.setSourceDetails(enriched);
            if (enriched.get("containerPort") instanceof Number port) service.setContainerPort(port.intValue());
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
        if (dep.getErrorMessage() == null || dep.getErrorMessage().isBlank()) {
            dep.setErrorMessage("Cancelled by user");
        }
        DeploymentEntity saved = deploymentRepository.save(dep);

        // Only clear service deploy-state when this was the current/latest attempt.
        serviceRepository.findById(serviceId).ifPresent(s -> {
            boolean isLatest = deploymentId.equals(s.getLatestDeploymentId());
            if (isLatest && (s.getStatus() == ServiceStatus.DEPLOYING
                    || s.getStatus() == ServiceStatus.BUILDING
                    || s.getStatus() == ServiceStatus.PENDING)) {
                s.setStatus(ServiceStatus.STOPPED);
                serviceRepository.save(s);
            }
        });
        return saved;
    }

    /** Workflow progress rows only mirror GitHub; a real attempt has a compose file and reached the deploy path. */
    private static boolean isRealAttempt(DeploymentEntity d) {
        return d.getComposeSnapshot() != null;
    }

    private void lockOwner(String ownerId) {
        userRepository.lockById(ownerId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Owner not found"));
    }

    private UserEntity serviceOwner(ServiceEntity service) {
        return serviceOwner(service.getProject());
    }

    private UserEntity serviceOwner(ProjectEntity project) {
        return userRepository.findById(project.getOwnerId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service owner not found"));
    }

    private static void rejectManagedGitHubFields(Map<String, Object> details) {
        if (details.keySet().stream().anyMatch(k -> k.equals("imageName") || k.startsWith("ci"))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "GitHub image and CI status are managed by CloudBase");
        }
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

    /** A password chosen by the user may contain characters that would break a connection URL. */
    private static String urlEncode(String value) {
        return java.net.URLEncoder.encode(value == null ? "" : value, java.nio.charset.StandardCharsets.UTF_8)
                .replace("+", "%20");
    }

    private void pinDatabaseNames(ServiceEntity service) {
        Map<String, Object> details = service.getSourceDetails() != null
                ? new HashMap<>(service.getSourceDetails()) : new HashMap<>();
        if (details.containsKey(ComposeGenerator.DB_NAME_KEY) && details.containsKey(ComposeGenerator.HOST_NAME_KEY)) {
            return;
        }
        details.putIfAbsent(ComposeGenerator.DB_NAME_KEY, ComposeGenerator.databaseName(service));
        details.putIfAbsent(ComposeGenerator.HOST_NAME_KEY, ComposeGenerator.serviceHostName(service));
        service.setSourceDetails(details);
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

    /** Reject image values that could not be written safely into the generated compose YAML. */
    private static void validateImageDetails(Map<String, Object> details) {
        Object image = details.get("imageName");
        if (image != null && !String.valueOf(image).isBlank()) {
            ComposeInputValidator.requireImage(String.valueOf(image).trim());
        }
        Object tag = details.get("imageTag");
        if (tag != null && !String.valueOf(tag).isBlank()) {
            ComposeInputValidator.requireImageTag(String.valueOf(tag).trim());
        }
    }

    private Map<String, Object> toEnvMap(List<EnvironmentVariable> envVars) {
        Map<String, Object> map = new LinkedHashMap<>();
        if (envVars == null) return map;
        for (EnvironmentVariable ev : envVars) {
            if (ev == null || ev.key() == null || ev.key().isBlank()) continue;
            if (ev.value() != null && ev.value().length() > com.cloudbase.dto.ProjectDtos.MAX_ENV_VALUE) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Environment variable values are limited to 32 KB");
            }
            map.put(ComposeInputValidator.requireEnvKey(ev.key().trim()), Map.of(
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

    private static void requireMaxLength(String value, int max, String field) {
        if (value != null && value.length() > max) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field + " is limited to " + max + " characters");
        }
    }

    private void requireOwnerOrAdmin(String ownerId, UserEntity user) {
        if (user.getRole() != UserRole.ADMIN && !ownerId.equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Access denied");
        }
    }
}
