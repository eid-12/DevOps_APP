package com.cloudbase.service;

import com.cloudbase.dto.ProjectDtos.DeployServiceRequest;
import com.cloudbase.email.EmailService;
import com.cloudbase.entity.DeploymentEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.DeploymentStatus;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.model.ServiceStatus;
import com.cloudbase.npm.NpmClient;
import com.cloudbase.portainer.ComposeGenerator;
import com.cloudbase.portainer.EdgeRouter;
import com.cloudbase.portainer.TenantIsolationVerifier;
import com.cloudbase.portainer.PortainerClient;
import com.cloudbase.repository.DeploymentRepository;
import com.cloudbase.repository.ServiceRepository;
import com.cloudbase.repository.UserRepository;
import com.cloudbase.service.NotificationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Central orchestration: Portainer stacks + NPM proxy hosts + deployment records.
 */
@Service
public class DeploymentOrchestrator {

    private static final Logger log = LoggerFactory.getLogger(DeploymentOrchestrator.class);

    private final ServiceRepository serviceRepository;
    private final DeploymentRepository deploymentRepository;
    private final ComposeGenerator composeGenerator;
    private final PortainerClient portainerClient;
    private final NpmClient npmClient;
    private final DeploymentEventPublisher eventPublisher;
    private final NotificationService notificationService;
    private final PlatformSettingsService platformSettings;
    private final WebClient publicHttp;
    private final VanitySubdomainService vanitySubdomainService;
    private final TransactionTemplate transactionTemplate;
    private final UserRepository userRepository;
    private final EmailService emailService;
    private final EdgeRouter edgeRouter;
    private final TenantIsolationVerifier isolationVerifier;
    /** Asked to run soon after a deploy replaces an image. Optional so unit tests can build the orchestrator. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private DockerJanitor dockerJanitor;

    public DeploymentOrchestrator(
            ServiceRepository serviceRepository,
            DeploymentRepository deploymentRepository,
            ComposeGenerator composeGenerator,
            PortainerClient portainerClient,
            NpmClient npmClient,
            DeploymentEventPublisher eventPublisher,
            NotificationService notificationService,
            PlatformSettingsService platformSettings,
            WebClient.Builder webClientBuilder,
            @org.springframework.context.annotation.Lazy VanitySubdomainService vanitySubdomainService,
            TransactionTemplate transactionTemplate,
            UserRepository userRepository,
            EmailService emailService,
            EdgeRouter edgeRouter,
            TenantIsolationVerifier isolationVerifier
    ) {
        this.edgeRouter = edgeRouter;
        this.isolationVerifier = isolationVerifier;
        this.serviceRepository = serviceRepository;
        this.deploymentRepository = deploymentRepository;
        this.composeGenerator = composeGenerator;
        this.portainerClient = portainerClient;
        this.npmClient = npmClient;
        this.eventPublisher = eventPublisher;
        this.notificationService = notificationService;
        this.platformSettings = platformSettings;
        this.publicHttp = webClientBuilder.build();
        this.vanitySubdomainService = vanitySubdomainService;
        this.transactionTemplate = transactionTemplate;
        this.userRepository = userRepository;
        this.emailService = emailService;
    }

    private String baseDomain() {
        String d = platformSettings.get(PlatformSettingsService.BASE_DOMAIN);
        return (d == null || d.isBlank()) ? "cloudbase.website" : d.trim();
    }

    public DeploymentEntity startDeploy(
            ServiceEntity service,
            String triggeredBy,
            DeployServiceRequest request,
            String rollbackOf
    ) {
        if (service.getContainerName() == null || service.getContainerName().isBlank()) {
            service.setContainerName(composeGenerator.resolveContainerName(service));
        }
        if (service.getContainerPort() == null) {
            service.setContainerPort(composeGenerator.resolveContainerPort(service));
        }

        String imageTag = request != null ? request.imageTag() : null;
        String commitSha = request != null ? request.commitSha() : null;

        // Clear orphan in-flight rows so UI cannot stick on an older DEPLOYING forever.
        Instant now = Instant.now();
        for (DeploymentEntity orphan : deploymentRepository.findByServiceIdAndStatusInAndFinishedAtIsNull(
                service.getId(),
                List.of(DeploymentStatus.QUEUED, DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING)
        )) {
            orphan.setStatus(DeploymentStatus.CANCELLED);
            orphan.setFinishedAt(now);
            orphan.setLogs((orphan.getLogs() == null ? "" : orphan.getLogs() + "\n")
                    + "Cancelled — superseded by a new deploy");
            if (orphan.getErrorMessage() == null || orphan.getErrorMessage().isBlank()) {
                orphan.setErrorMessage("Cancelled — superseded by a new deploy");
            }
            deploymentRepository.save(orphan);
            eventPublisher.publishDeploymentUpdate(orphan);
        }

        DeploymentEntity deployment = DeploymentEntity.builder()
                .id("dep-" + UUID.randomUUID().toString().substring(0, 8))
                .serviceId(service.getId())
                .projectId(service.getProject().getId())
                .status(DeploymentStatus.QUEUED)
                .triggeredBy(triggeredBy)
                .commitSha(commitSha)
                .imageTag(imageTag)
                .rollbackOf(rollbackOf)
                .startedAt(Instant.now())
                .build();
        deployment = deploymentRepository.save(deployment);

        boolean github = service.getSourceType() == ServiceSourceType.GITHUB;
        service.setStatus(github ? ServiceStatus.BUILDING : ServiceStatus.DEPLOYING);
        service.setLatestDeploymentId(deployment.getId());
        serviceRepository.save(service);
        eventPublisher.publishServiceStatusUpdate(service);
        eventPublisher.publishDeploymentUpdate(deployment);
        appendStage(deployment.getId(), DeploymentStatus.QUEUED, "queued",
                "Deploy queued (" + (triggeredBy != null ? triggeredBy : "manual") + ")");

        final String serviceId = service.getId();
        final String deploymentId = deployment.getId();
        final String ownerId = service.getProject().getOwnerId();

        Map<String, String> extras = new HashMap<>();
        if (service.getSourceType() == ServiceSourceType.DATABASE) {
            ensureDbSecrets(service, extras);
        }
        mergeSharedVariables(service, extras);

        String compose = composeGenerator.generateCompose(service, ownerId, imageTag);
        deployment.setComposeSnapshot(compose);
        deploymentRepository.save(deployment);
        appendStage(deploymentId, DeploymentStatus.BUILDING, "building", "Compose file generated");

        List<Map<String, String>> env = resolveReferences(service,
                composeGenerator.buildPortainerEnv(service, extras), deploymentId);
        String stackName = stackName(service);

        Integer existingStackId = service.getPortainerStackId();
        // GHCR images are pre-pulled with the owner's credential below; an unauthenticated re-pull would fail.
        boolean pullImage = service.getSourceType() != ServiceSourceType.DATABASE && !isGhcrImage(service);
        final String containerName = composeGenerator.resolveContainerName(service);

        // GitHub: refuse when CI never built an image (avoids opaque Portainer 500).
        if (github) {
            appendStage(deploymentId, DeploymentStatus.BUILDING, "building",
                    "Checking GitHub image on Docker Hub before Portainer…");
            String gate = githubDeployGateReason(service);
            if (gate != null) {
                onStackFailure(serviceId, deploymentId, new IllegalStateException(gate));
                return reloadDeployment(deployment);
            }
            if (isGhcrImage(service)) {
                appendStage(deploymentId, DeploymentStatus.BUILDING, "building",
                        "Pulling the image from GitHub Container Registry with the owner's GitHub access…");
                String pullError = pullGhcrImage(service, imageTag);
                if (pullError != null) {
                    onStackFailure(serviceId, deploymentId, new IllegalStateException(pullError));
                    return reloadDeployment(deployment);
                }
                appendStage(deploymentId, DeploymentStatus.BUILDING, "building",
                        "Image pulled. Handing off to Portainer.");
            } else {
                String missingImage = missingDockerHubImageReason(service, imageTag);
                if (missingImage != null) {
                    onStackFailure(serviceId, deploymentId, new IllegalStateException(missingImage));
                    return reloadDeployment(deployment);
                }
                appendStage(deploymentId, DeploymentStatus.BUILDING, "building",
                        "Docker image found. Handing off to Portainer.");
            }
        }

        appendStage(deploymentId, DeploymentStatus.DEPLOYING, "deploying",
                "Creating/updating Portainer stack " + stackName + "…");
        service.setStatus(ServiceStatus.DEPLOYING);
        serviceRepository.save(service);
        eventPublisher.publishServiceStatusUpdate(service);

        // The project network is prepared (and checked) before any workload is created. For apps the edge joins
        // it so it can route to them; the reverse proxy itself (with its admin listener) never does.
        // Then the network's isolation is proven by a probe before anything runs on it: no workload is created
        // unless the host stops tenant bridges from reaching published ports (fail closed).
        String projectNetwork = composeGenerator.projectNetworkName(service.getProject().getId());
        Mono<Void> network = edgeRouter.ensureEdge()
                .then(portainerClient.ensureProjectNetwork(projectNetwork, edgeRouter.edgeName(), true))
                .then(Mono.fromCallable(() -> isolationVerifier.verify(projectNetwork))
                        .subscribeOn(Schedulers.boundedElastic())
                        .flatMap(outcome -> outcome.result() == TenantIsolationVerifier.Result.PROTECTED
                                ? Mono.<Void>empty()
                                : Mono.error(new IllegalStateException(isolationRefusal(outcome)))));
        // Logged before subscribing: a fast failure on another thread must not be followed by this stage line.
        appendStage(deploymentId, DeploymentStatus.DEPLOYING, "deploying", "Portainer API call started");
        network.then(Mono.defer(() -> portainerClient.upsertStack(stackName, compose, env, existingStackId, pullImage)))
                .onErrorMap(this::friendlyPortainerError)
                .flatMap(result -> {
                    appendStage(deploymentId, DeploymentStatus.DEPLOYING, "deploying",
                            "Stack accepted. Waiting for the container to become running…");
                    return portainerClient.waitUntilRunning(containerName, 12, 2500).thenReturn(result);
                })
                .flatMap(result -> {
                    appendStage(deploymentId, DeploymentStatus.DEPLOYING, "verify",
                            "Configuring public URL and verifying the app…");
                    return provisionProxyAndVerifyApp(serviceId).thenReturn(result);
                })
                .subscribe(
                        result -> onStackSuccess(serviceId, deploymentId, result),
                        error -> onStackFailure(serviceId, deploymentId, error)
                );

        return reloadDeployment(deployment);
    }

    /**
     * GitHub Actions progress / failure — shown in Deployments + Logs before Portainer runs.
     */
    public void onGitHubWorkflowEvent(
            ServiceEntity service,
            String action,
            String conclusion,
            String commitSha,
            String runUrl
    ) {
        boolean progress = "requested".equalsIgnoreCase(action) || "in_progress".equalsIgnoreCase(action);
        boolean failed = "completed".equalsIgnoreCase(action)
                && conclusion != null
                && !"success".equalsIgnoreCase(conclusion)
                && !"null".equalsIgnoreCase(conclusion)
                && !conclusion.isBlank();

        List<DeploymentEntity> inflight = deploymentRepository.findByServiceIdAndStatusInAndFinishedAtIsNull(
                service.getId(),
                List.of(DeploymentStatus.QUEUED, DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING)
        );
        boolean portainerRunning = inflight.stream().anyMatch(d -> d.getStatus() == DeploymentStatus.DEPLOYING);

        if (progress) {
            if (portainerRunning) {
                return;
            }
            DeploymentEntity d = inflight.stream().findFirst().orElse(null);
            if (d == null) {
                d = DeploymentEntity.builder()
                        .id("dep-" + UUID.randomUUID().toString().substring(0, 8))
                        .serviceId(service.getId())
                        .projectId(service.getProject().getId())
                        .status(DeploymentStatus.BUILDING)
                        .triggeredBy("github-workflow")
                        .commitSha(commitSha)
                        .startedAt(Instant.now())
                        .stage("building")
                        .build();
                d = deploymentRepository.save(d);
                service.setStatus(ServiceStatus.BUILDING);
                service.setLatestDeploymentId(d.getId());
                serviceRepository.save(service);
                eventPublisher.publishServiceStatusUpdate(service);
                eventPublisher.publishDeploymentUpdate(d);
            }
            String extra = safeGitHubRunUrl(runUrl);
            appendStage(d.getId(), DeploymentStatus.BUILDING, "building",
                    "GitHub Actions is building the image" + (extra.isEmpty() ? "" : " — " + extra));
            return;
        }

        if (failed && !portainerRunning) {
            DeploymentEntity d = inflight.stream().findFirst().orElse(null);
            if (d == null) {
                d = DeploymentEntity.builder()
                        .id("dep-" + UUID.randomUUID().toString().substring(0, 8))
                        .serviceId(service.getId())
                        .projectId(service.getProject().getId())
                        .status(DeploymentStatus.BUILDING)
                        .triggeredBy("github-workflow")
                        .commitSha(commitSha)
                        .startedAt(Instant.now())
                        .stage("building")
                        .build();
                d = deploymentRepository.save(d);
                service.setLatestDeploymentId(d.getId());
                serviceRepository.save(service);
            }
            String extra = safeGitHubRunUrl(runUrl);
            onStackFailure(service.getId(), d.getId(), new IllegalStateException(
                    "GitHub Actions failed (" + conclusion + ")"
                            + (extra.isEmpty() ? "" : ". Open the run: " + extra)
                            + ". Fix the workflow, then Redeploy."));
        }
    }

    private DeploymentEntity reloadDeployment(DeploymentEntity deployment) {
        return deploymentRepository.findById(deployment.getId()).orElse(deployment);
    }

    private void appendStage(String deploymentId, DeploymentStatus status, String stage, String message) {
        transactionTemplate.executeWithoutResult(tx ->
                deploymentRepository.findByIdForUpdate(deploymentId).ifPresent(d -> {
                    if (d.getStatus() == DeploymentStatus.CANCELLED
                            || d.getStatus() == DeploymentStatus.SUCCESS
                            || d.getStatus() == DeploymentStatus.FAILED) {
                        return;
                    }
                    if (status != null) {
                        d.setStatus(status);
                    }
                    d.setStage(stage);
                    String line = "[" + clock() + "] [" + stageTitle(stage) + "] " + message;
                    d.setLogs(appendLogLine(d.getLogs(), line));
                    deploymentRepository.save(d);
                    eventPublisher.publishDeploymentUpdate(d);
                    eventPublisher.publishLog(d.getServiceId(), d.getId(), line);
                }));
    }

    private static String appendLogLine(String existing, String line) {
        if (existing == null || existing.isBlank()) {
            return line;
        }
        return existing + "\n" + line;
    }

    private static String clock() {
        return DateTimeFormatter.ofPattern("HH:mm:ss")
                .withZone(ZoneId.systemDefault())
                .format(Instant.now());
    }

    /** Only embed https://github.com/... run URLs from webhooks. */
    private static String safeGitHubRunUrl(String runUrl) {
        if (runUrl == null || runUrl.isBlank()) {
            return "";
        }
        try {
            URI uri = URI.create(runUrl.trim());
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            if (!"https".equalsIgnoreCase(uri.getScheme())) {
                return "";
            }
            if (!"github.com".equals(host) && !host.endsWith(".github.com")) {
                return "";
            }
            return uri.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private static String stageTitle(String stage) {
        if (stage == null) {
            return "Deploy";
        }
        return switch (stage) {
            case "queued" -> "Queued";
            case "building" -> "Building";
            case "deploying" -> "Deploying";
            case "verify" -> "Verify";
            case "success" -> "Success";
            case "failed" -> "Failed";
            default -> stage;
        };
    }

    private Throwable friendlyPortainerError(Throwable error) {
        String msg = error != null && error.getMessage() != null ? error.getMessage() : "Portainer error";
        if (msg.contains("500") && msg.contains("/api/stacks")) {
            return new IllegalStateException(
                    "Deploy failed while creating the container stack. Usually the Docker image does not exist yet "
                            + "(GitHub Actions must build & push first), or Portainer could not pull it. "
                            + "Details: " + msg);
        }
        if (msg.contains("404") && msg.contains("/api/stacks")) {
            return new IllegalStateException("Portainer stack not found. Try Redeploy. Details: " + msg);
        }
        return error;
    }

    /**
     * Returns a failure message if the configured image is missing on Docker Hub; otherwise null.
     */
    private String missingDockerHubImageReason(ServiceEntity service, String imageTagOverride) {
        Map<String, Object> src = service.getSourceDetails();
        if (src == null) {
            return "GitHub source details missing - cannot deploy.";
        }
        String imageName = String.valueOf(src.getOrDefault("imageName", "")).trim();
        if (imageName.isBlank() || "null".equalsIgnoreCase(imageName) || !imageName.contains("/")) {
            return "No Docker image configured for this GitHub service.";
        }
        String tag = imageTagOverride != null && !imageTagOverride.isBlank()
                ? imageTagOverride
                : String.valueOf(src.getOrDefault("imageTag", "latest"));
        if (tag.isBlank() || "null".equalsIgnoreCase(tag)) {
            tag = "latest";
        }
        String full = imageName.contains(":") ? imageName : imageName + ":" + tag;
        if (!dockerHubTagExists(imageName.contains(":") ? imageName.substring(0, imageName.indexOf(':')) : imageName,
                imageName.contains(":") ? imageName.substring(imageName.indexOf(':') + 1) : tag)) {
            return "Docker image not found: " + full
                    + ". Build it with GitHub Actions (reconnect GitHub with the workflow scope), then Redeploy.";
        }
        return null;
    }

    private boolean dockerHubTagExists(String repository, String tag) {
        String repo = repository == null ? "" : repository.trim().toLowerCase(Locale.ROOT);
        String t = tag == null || tag.isBlank() ? "latest" : tag.trim();
        if (!repo.contains("/") || repo.startsWith("library/")) {
            // Official images / unusual refs - let Portainer decide
            return true;
        }
        String[] parts = repo.split("/", 2);
        String url = "https://hub.docker.com/v2/repositories/" + parts[0] + "/" + parts[1] + "/tags/" + t;
        try {
            Integer status = publicHttp.get()
                    .uri(url)
                    .exchangeToMono(res -> res.releaseBody().thenReturn(res.statusCode().value()))
                    .timeout(Duration.ofSeconds(8))
                    .onErrorReturn(0)
                    .block(Duration.ofSeconds(10));
            return status != null && status >= 200 && status < 300;
        } catch (Exception e) {
            log.warn("Docker Hub lookup failed for {}:{} - {}", repo, t, e.getMessage());
            // If Hub is unreachable, don't block; Portainer will still fail clearly if image missing.
            return true;
        }
    }

    /**
     * Wire NPM then (for GitHub apps) hit the public URL and refuse demo/placeholder pages.
     */
    private Mono<Void> provisionProxyAndVerifyApp(String serviceId) {
        return Mono.fromCallable(() -> transactionTemplate.execute(status -> {
                    ServiceEntity service = serviceRepository.findByIdWithProject(serviceId).orElse(null);
                    if (service == null) {
                        return null;
                    }
                    if (service.getSourceType() == ServiceSourceType.DATABASE) {
                        return service;
                    }
                    ensureOpaquePlatformDomain(service);
                    return serviceRepository.save(service);
                }))
                .subscribeOn(Schedulers.boundedElastic())
                .flatMap(service -> {
                    if (service == null) {
                        return Mono.error(new IllegalStateException("Service disappeared during deploy"));
                    }
                    if (service.getSourceType() == ServiceSourceType.DATABASE) {
                        return Mono.empty();
                    }
                    List<String> domains = resolveDomainNames(service);
                    Integer existingNpmId = service.getNpmProxyHostId();

                    Mono<Void> proxy = domains.isEmpty() || !npmClient.isEnabled()
                            ? Mono.empty()
                            : npmClient.upsertProxyHost(existingNpmId, domains, edgeRouter.edgeName(), EDGE_PORT)
                            .doOnNext(hostId -> transactionTemplate.executeWithoutResult(status ->
                                    serviceRepository.findById(serviceId).ifPresent(s -> {
                                        s.setNpmProxyHostId(hostId);
                                        serviceRepository.save(s);
                                    })))
                            .then();
                    proxy = proxy.then(Mono.defer(this::refreshEdgeRoutes));

                    Mono<Void> verify = service.getSourceType() == ServiceSourceType.GITHUB
                            ? verifyGitHubAppHttp(service)
                            : Mono.empty();

                    return proxy.then(verify);
                });
    }

    /**
     * SUCCESS only when the public site responds and is not a demo/nginx hello page.
     */
    private Mono<Void> verifyGitHubAppHttp(ServiceEntity service) {
        String host = primaryPublicHost(service);
        if (host == null || host.isBlank()) {
            return Mono.error(new IllegalStateException("No public hostname assigned for app verification"));
        }
        return probePublicApp(host)
                .retryWhen(reactor.util.retry.Retry.fixedDelay(8, Duration.ofSeconds(3))
                        .filter(err -> {
                            String m = err.getMessage() == null ? "" : err.getMessage();
                            return m.contains("not reachable")
                                    || m.contains("502")
                                    || m.contains("503")
                                    || m.contains("empty");
                        }))
                .then();
    }

    private Mono<String> probePublicApp(String host) {
        String https = "https://" + host + "/";
        String http = "http://" + host + "/";
        return fetchBody(https)
                .onErrorResume(e -> fetchBody(http))
                .flatMap(body -> {
                    if (body == null || body.isBlank()) {
                        return Mono.error(new IllegalStateException("App response empty - not reachable yet"));
                    }
                    if (isDemoOrPlaceholderPage(body)) {
                        return Mono.error(new IllegalStateException(
                                "Deploy rejected: site is serving a demo/nginx test page, not your application. "
                                        + "Build and push your real image (reconnect GitHub with workflow scope), then redeploy."));
                    }
                    if (body.length() < 40) {
                        return Mono.error(new IllegalStateException("App response too small - not a real application page"));
                    }
                    return Mono.just(body);
                });
    }

    private Mono<String> fetchBody(String url) {
        return publicHttp.get()
                .uri(url)
                .exchangeToMono(res -> {
                    int code = res.statusCode().value();
                    if (code == 502 || code == 503 || code == 504) {
                        return res.releaseBody()
                                .then(Mono.error(new IllegalStateException("App not reachable yet (HTTP " + code + ")")));
                    }
                    if (code >= 400) {
                        return res.releaseBody()
                                .then(Mono.error(new IllegalStateException("App returned HTTP " + code)));
                    }
                    return res.bodyToMono(String.class).defaultIfEmpty("");
                })
                .timeout(Duration.ofSeconds(12));
    }

    static boolean isDemoOrPlaceholderPage(String html) {
        String b = html.toLowerCase(Locale.ROOT);
        if (b.contains("nginxdemos") || b.contains("part of f5")) {
            return true;
        }
        // Classic nginxdemos/hello fingerprint
        return b.contains("server address:")
                && b.contains("server name:")
                && (b.contains("auto refresh") || b.contains("uri:"));
    }

    /**
     * @return failure reason, or null if deploy may proceed.
     */
    static final String GHCR = "ghcr.io";
    private static final Duration GHCR_PULL_TIMEOUT = Duration.ofMinutes(5);

    static boolean isGhcrImage(ServiceEntity service) {
        Map<String, Object> src = service.getSourceDetails();
        return service.getSourceType() == ServiceSourceType.GITHUB && src != null
                && String.valueOf(src.getOrDefault("imageName", "")).trim().toLowerCase(Locale.ROOT).startsWith(GHCR + "/");
    }

    /**
     * Pull a tenant's private GHCR image with the service owner's own GitHub token (sent once to the Docker
     * engine via Portainer, never stored there). The pull is also the access check: if the owner cannot read
     * the package, the deploy stops, so nobody can run an image they could not pull themselves.
     *
     * @return null on success, otherwise a user-facing reason
     */
    String pullGhcrImage(ServiceEntity service, String imageTagOverride) {
        Map<String, Object> src = service.getSourceDetails();
        String imageName = String.valueOf(src.get("imageName")).trim();
        String tag = imageTagOverride != null && !imageTagOverride.isBlank()
                ? imageTagOverride.trim()
                : String.valueOf(src.getOrDefault("imageTag", "latest")).trim();
        String ownerId = service.getProject() == null ? null : service.getProject().getOwnerId();
        UserEntity owner = ownerId == null ? null : userRepository.findById(ownerId).orElse(null);
        if (owner == null || !StringUtils.hasText(owner.getGithubAccessToken()) || !StringUtils.hasText(owner.getGithubUsername())) {
            return "Connect GitHub on Account so CloudBase can pull your private image, then redeploy.";
        }
        if (owner.getGithubScopes() == null || java.util.Arrays.stream(owner.getGithubScopes().split("[,\\s]+"))
                .noneMatch("read:packages"::equals)) {
            return "Reconnect GitHub on Account to grant package read access (read:packages), then redeploy.";
        }
        try {
            Boolean sharedRegistry = portainerClient.hasRegistryFor(GHCR).block(Duration.ofSeconds(30));
            if (sharedRegistry == null) return "Deploy refused: could not verify GHCR registry credential isolation. Retry when Portainer is available.";
            if (Boolean.TRUE.equals(sharedRegistry)) {
                return "Deploy refused: Portainer has a shared ghcr.io registry credential, which would bypass each "
                        + "owner's own access. Remove it in Portainer → Registries.";
            }
            portainerClient.pullImageWithAuth(imageName, tag, owner.getGithubUsername(), owner.getGithubAccessToken(), GHCR)
                    .block(GHCR_PULL_TIMEOUT);
            return null;
        } catch (Exception e) {
            String reason = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            return "Could not pull " + imageName + ":" + tag + " from GitHub Container Registry (" + reason
                    + "). Check that the repository's CloudBase workflow finished and that your GitHub account can read the package.";
        }
    }

    private static String githubDeployGateReason(ServiceEntity service) {
        Map<String, Object> src = service.getSourceDetails();
        if (src == null) {
            return "GitHub source details missing - cannot deploy.";
        }
        String imageName = String.valueOf(src.getOrDefault("imageName", "")).trim().toLowerCase(Locale.ROOT);
        if (imageName.contains("nginxdemos/hello")
                || imageName.equals("nginxdemos/hello")
                || imageName.startsWith("nginxdemos/hello:")) {
            return "Deploy blocked: nginxdemos/hello is a test image, not your app. "
                    + "Use your built image (e.g. after GitHub Actions) then redeploy.";
        }
        Object boot = src.get("ciBootstrapped");
        boolean ok = Boolean.TRUE.equals(boot) || "true".equalsIgnoreCase(String.valueOf(boot));
        if (ok) {
            return null;
        }
        // CI failed - still allow if a real image already exists on Docker Hub (checked next).
        // If Hub has no tag, missingDockerHubImageReason will fail with a clear message (not Portainer 500).
        return null;
    }

    public void ensureProxyHost(ServiceEntity service) {
        if (service.getSourceType() == ServiceSourceType.DATABASE) {
            return;
        }
        ensureOpaquePlatformDomain(service);
        List<String> domains = resolveDomainNames(service);
        if (domains.isEmpty()) {
            return;
        }
        npmClient.upsertProxyHost(service.getNpmProxyHostId(), domains, edgeRouter.edgeName(), EDGE_PORT)
                .flatMap(hostId -> refreshEdgeRoutes().thenReturn(hostId))
                .subscribe(
                        hostId -> serviceRepository.findById(service.getId()).ifPresent(s -> {
                            s.setNpmProxyHostId(hostId);
                            if (s.getSubdomain() == null || s.getSubdomain().isBlank()) {
                                s.setSubdomain(service.getSubdomain());
                            }
                            serviceRepository.save(s);
                            eventPublisher.publishServiceStatusUpdate(s);
                        }),
                        error -> log.error("NPM proxy provisioning failed for {}: {}", service.getId(), error.getMessage())
                );
    }

    /**
     * Assign opaque platform hostname: cloudbase{4-digits}.baseDomain
     * Preserves the account's one claimed vanity subdomain when present.
     */
    public void ensureOpaquePlatformDomain(ServiceEntity service) {
        if (service.getSourceType() == ServiceSourceType.DATABASE) {
            return;
        }
        if (vanitySubdomainService.isClaimedVanityForService(service)) {
            return;
        }
        if (isOpaquePlatformDomain(service.getSubdomain())) {
            // Normalize bare slug → full FQDN
            String current = service.getSubdomain().trim().toLowerCase();
            if (!current.contains(".")) {
                service.setSubdomain(current + "." + baseDomain());
                serviceRepository.save(service);
            }
            return;
        }
        String fqdn = allocateOpaqueFqdn(service.getId());
        service.setSubdomain(fqdn);
        serviceRepository.save(service);
        log.info("Assigned opaque platform domain {} → {}", service.getId(), fqdn);
    }

    public String allocateOpaqueFqdn(String excludeServiceId) {
        for (int attempt = 0; attempt < 64; attempt++) {
            int n = ThreadLocalRandom.current().nextInt(1000, 10000); // 4 digits
            String fqdn = "cloudbase" + n + "." + baseDomain();
            boolean taken = serviceRepository.findBySubdomainIgnoreCase(fqdn)
                    .filter(s -> excludeServiceId == null || !s.getId().equals(excludeServiceId))
                    .isPresent()
                    || serviceRepository.findByCustomDomainIgnoreCase(fqdn)
                    .filter(s -> excludeServiceId == null || !s.getId().equals(excludeServiceId))
                    .isPresent();
            if (!taken) {
                return fqdn;
            }
        }
        // Extremely unlikely collision path - still keep exactly 4 digits
        return "cloudbase" + ThreadLocalRandom.current().nextInt(1000, 10000) + "." + baseDomain();
    }

    /** True only for current format: cloudbase{exactly 4 digits}[.baseDomain]. */
    public boolean isOpaquePlatformDomain(String subdomain) {
        if (subdomain == null || subdomain.isBlank()) {
            return false;
        }
        String host = subdomain.trim().toLowerCase();
        String suffix = "." + baseDomain();
        String slug;
        if (host.endsWith(suffix)) {
            slug = host.substring(0, host.length() - suffix.length());
        } else if (host.equals(baseDomain())) {
            return false;
        } else if (!host.contains(".")) {
            slug = host;
        } else {
            return false;
        }
        return slug.matches("cloudbase\\d{4}");
    }

    static String isolationRefusal(TenantIsolationVerifier.Outcome outcome) {
        return "Deploy refused: tenant network isolation could not be confirmed on this host ("
                + outcome.detail() + "). Nothing was deployed. An administrator must enable the egress guard "
                + "(deploy/egress-guard) before tenant workloads can run.";
    }

    /** NPM forwards every tenant hostname to the edge on this port; the edge routes by Host. */
    static final int EDGE_PORT = 80;

    /**
     * Synchronously bring one service's public routing in line with its committed domains: its NPM proxy host
     * (when NPM is enabled) and the edge route table. Throws when either step fails, so callers can undo a change.
     */
    public void routeNow(String serviceId) {
        ServiceEntity service = transactionTemplate.execute(tx -> serviceRepository.findByIdWithProject(serviceId).orElse(null));
        // Not deployed yet: there is nothing to route; the first deploy provisions its routes.
        if (service == null || service.getSourceType() == ServiceSourceType.DATABASE || service.getPortainerStackId() == null) {
            return;
        }
        List<String> domains = resolveDomainNames(service);
        if (npmClient.isEnabled() && !domains.isEmpty()) {
            Integer hostId = npmClient.upsertProxyHost(service.getNpmProxyHostId(), domains, edgeRouter.edgeName(), EDGE_PORT)
                    .block(Duration.ofSeconds(30));
            if (hostId != null && !hostId.equals(service.getNpmProxyHostId())) {
                transactionTemplate.executeWithoutResult(tx -> serviceRepository.findById(serviceId).ifPresent(s -> {
                    s.setNpmProxyHostId(hostId);
                    serviceRepository.save(s);
                }));
            }
        }
        refreshEdgeRoutes().block(Duration.ofSeconds(60));
    }

    /** Rewrite the edge route table from all app services (hostname -> container:port). */
    public Mono<Void> refreshEdgeRoutes() {
        return Mono.fromCallable(() -> transactionTemplate.execute(status -> {
                    Map<String, String> routes = new java.util.TreeMap<>();
                    for (ServiceEntity s : serviceRepository.findAll()) {
                        if (s.getSourceType() == ServiceSourceType.DATABASE || s.getProject() == null) continue;
                        String upstream = composeGenerator.resolveContainerName(s) + ":" + composeGenerator.resolveContainerPort(s);
                        for (String host : resolveDomainNames(s)) routes.put(host, upstream);
                    }
                    return routes;
                }))
                .subscribeOn(Schedulers.boundedElastic())
                .flatMap(edgeRouter::writeRoutes);
    }

    /**
     * Keeps tenant routing working when the edge, its network or the proxy's link to it was recreated: the edge
     * exists and runs, joins every project network that holds an app, and has the current routes.
     */
    @org.springframework.scheduling.annotation.Scheduled(
            fixedDelayString = "${cloudbase.edge.reconcile-ms:120000}", initialDelayString = "${cloudbase.edge.reconcile-initial-ms:40000}")
    public void reconcileEdge() {
        java.util.Set<String> projects = transactionTemplate.execute(status -> serviceRepository.findAll().stream()
                .filter(s -> s.getSourceType() != ServiceSourceType.DATABASE && s.getProject() != null && s.getPortainerStackId() != null)
                .map(s -> s.getProject().getId())
                .collect(java.util.stream.Collectors.toCollection(java.util.TreeSet::new)));
        if (projects == null || projects.isEmpty()) {
            return;
        }
        try {
            edgeRouter.retireIfOutdated().onErrorResume(e -> Mono.just(false))
                    .then(edgeRouter.ensureEdge())
                    .thenMany(reactor.core.publisher.Flux.fromIterable(projects).concatMap(pid -> portainerClient
                            .ensureProjectNetwork(composeGenerator.projectNetworkName(pid), edgeRouter.edgeName(), true)
                            .onErrorResume(e -> Mono.empty())))
                    .then(Mono.defer(this::refreshEdgeRoutes))
                    .block(Duration.ofSeconds(90));
        } catch (RuntimeException e) {
            log.warn("Edge reconcile failed: {}", e.getMessage());
        }
    }

    public List<String> resolveDomainNames(ServiceEntity service) {
        List<String> names = new ArrayList<>();
        String platform = resolveFqdn(service);
        if (platform != null && !platform.isBlank()) {
            names.add(platform);
        }
        if (service.getCustomDomain() != null && !service.getCustomDomain().isBlank()) {
            String custom = service.getCustomDomain().trim().toLowerCase();
            if (!names.contains(custom)) {
                names.add(custom);
            }
        }
        return names;
    }

    /**
     * Tear down everything for a service so recreate later does not collide:
     * Portainer stack (by id or name), app + Watchtower containers, bind-mount data, NPM host.
     * <p>
     * If the service ever had runtime infra, Portainer must confirm stack/container removal.
     * Failures abort the call — callers must NOT delete DB rows when this throws.
     */
    /** Image id and anonymous volume names of a container, captured before it is removed. */
    record Leftovers(String imageId, List<String> anonymousVolumes) {
        static final Leftovers NONE = new Leftovers(null, List.of());
    }

    private static final java.util.regex.Pattern ANONYMOUS_VOLUME = java.util.regex.Pattern.compile("^[0-9a-f]{64}$");

    @SuppressWarnings("unchecked")
    Leftovers leftoversOf(String containerName) {
        try {
            String id = portainerClient.findContainerIdByName(containerName).block(Duration.ofSeconds(10));
            if (id == null) return Leftovers.NONE;
            Map<String, Object> inspect = portainerClient.inspectContainer(id).block(Duration.ofSeconds(10));
            if (inspect == null) return Leftovers.NONE;
            List<String> volumes = new ArrayList<>();
            if (inspect.get("Mounts") instanceof List<?> mounts) {
                for (Object m : mounts) {
                    if (m instanceof Map<?, ?> mount && "volume".equals(String.valueOf(mount.get("Type")))
                            && mount.get("Name") != null && ANONYMOUS_VOLUME.matcher(String.valueOf(mount.get("Name"))).matches()) {
                        volumes.add(String.valueOf(mount.get("Name")));
                    }
                }
            }
            Object image = inspect.get("Image");
            return new Leftovers(image == null ? null : String.valueOf(image), volumes);
        } catch (Exception e) {
            log.debug("Could not read leftovers of {}: {}", containerName, e.getMessage());
            return Leftovers.NONE;
        }
    }

    public void removeInfrastructure(ServiceEntity service) {
        if (service == null) {
            return;
        }
        Duration timeout = Duration.ofSeconds(60);
        String stack = stackName(service);
        String appName = composeGenerator.resolveContainerName(service);
        String wtName = composeGenerator.resolveWatchtowerContainerName(service);
        String ownerId = service.getProject() != null ? service.getProject().getOwnerId() : null;
        String volumePath = composeGenerator.resolveVolumeHostPath(ownerId, service);
        boolean requiresPortainer = requiresPortainerTeardown(service);

        log.info("Removing infra service={} stack={} container={} watchtower={} volume={} strict={}",
                service.getId(), stack, appName, wtName, volumePath, requiresPortainer);

        if (requiresPortainer) {
            try {
                portainerClient.getStatus().block(Duration.ofSeconds(12));
            } catch (Exception e) {
                throw teardownFailed(service.getId(),
                        "Portainer is unreachable. Delete aborted — nothing was removed from CloudBase.", e);
            }
        }

        // 0) What the app container leaves behind once removed: its image and anonymous volumes (e.g. MongoDB's
        //    /data/configdb). Read now, because removing the stack does not delete anonymous volumes.
        Leftovers leftovers = leftoversOf(appName);

        // 1) Portainer stack
        try {
            if (service.getPortainerStackId() != null) {
                portainerClient.removeStack(service.getPortainerStackId()).block(timeout);
            }
            portainerClient.removeStackByName(stack).block(timeout);
        } catch (Exception e) {
            if (requiresPortainer) {
                throw teardownFailed(service.getId(),
                        "Portainer refused or failed to remove the stack. Delete aborted.", e);
            }
            log.warn("Stack cleanup failed for {}: {}", service.getId(), e.getMessage());
        }

        // 2) Force-remove containers by stable names
        try {
            Mono.whenDelayError(
                    portainerClient.forceRemoveContainerByName(appName),
                    portainerClient.forceRemoveContainerByName(wtName)
            ).block(timeout);
        } catch (Exception e) {
            if (requiresPortainer) {
                throw teardownFailed(service.getId(),
                        "Portainer failed to remove containers. Delete aborted.", e);
            }
            log.warn("Container force-remove failed for {}: {}", service.getId(), e.getMessage());
        }

        // 3) Wipe persistent bind-mount data (best effort — host path may be empty)
        try {
            portainerClient.wipeBindMount(volumePath).block(timeout);
        } catch (Exception e) {
            log.warn("Volume wipe failed for {}: {}", volumePath, e.getMessage());
        }

        // 4) Image and anonymous volumes (best effort). Never forced: an image another service still runs stays.
        for (String volume : leftovers.anonymousVolumes()) {
            try {
                portainerClient.removeVolumeIfUnused(volume).block(Duration.ofSeconds(20));
            } catch (Exception e) {
                log.warn("Volume cleanup failed for {}: {}", service.getId(), e.getMessage());
            }
        }
        if (leftovers.imageId() != null) {
            try {
                Boolean removed = portainerClient.removeImageIfUnused(leftovers.imageId()).block(Duration.ofSeconds(30));
                log.info("Image of deleted service={} {}", service.getId(),
                        Boolean.TRUE.equals(removed) ? "removed" : "kept (still used elsewhere or already gone)");
            } catch (Exception e) {
                log.warn("Image cleanup failed for {}: {}", service.getId(), e.getMessage());
            }
        }

        // 5) NPM proxy host (best effort)
        if (service.getNpmProxyHostId() != null) {
            try {
                npmClient.deleteProxyHost(service.getNpmProxyHostId())
                        .onErrorResume(e -> {
                            log.warn("NPM remove failed: {}", e.getMessage());
                            return Mono.empty();
                        })
                        .block(Duration.ofSeconds(20));
            } catch (Exception e) {
                log.warn("NPM remove failed for {}: {}", service.getId(), e.getMessage());
            }
        }

        log.info("Infra removal finished for service={}", service.getId());
    }

    /**
     * Admin revoke (deploy disabled / account suspended): remove stacks, containers, and NPM
     * hosts but keep DB rows and volume data so a later redeploy can restore.
     * Best-effort — never throws to the admin API.
     */
    public void revokeRuntimeKeepData(ServiceEntity service) {
        if (service == null) {
            return;
        }
        Duration timeout = Duration.ofSeconds(45);
        String stack = stackName(service);
        String appName = composeGenerator.resolveContainerName(service);
        String wtName = composeGenerator.resolveWatchtowerContainerName(service);

        log.info("Revoking runtime (keep data) service={} stack={} container={}",
                service.getId(), stack, appName);

        try {
            if (service.getPortainerStackId() != null) {
                portainerClient.removeStack(service.getPortainerStackId())
                        .doOnSuccess(v -> log.info("Revoke removed stack id={}", service.getPortainerStackId()))
                        .block(timeout);
            }
            portainerClient.removeStackByName(stack)
                    .doOnSuccess(v -> log.info("Revoke removed stack by name={}", stack))
                    .block(timeout);
        } catch (Exception e) {
            log.warn("Revoke stack failed for {}: {}", service.getId(), e.toString());
        }

        try {
            Mono.whenDelayError(
                    portainerClient.forceRemoveContainerByName(appName)
                            .doOnSuccess(v -> log.info("Revoke removed container {}", appName)),
                    portainerClient.forceRemoveContainerByName(wtName)
                            .doOnSuccess(v -> log.info("Revoke removed watchtower {}", wtName))
            ).block(timeout);
        } catch (Exception e) {
            log.warn("Revoke containers failed for {}: {}", service.getId(), e.toString());
        }

        if (service.getNpmProxyHostId() != null) {
            try {
                npmClient.deleteProxyHost(service.getNpmProxyHostId())
                        .onErrorResume(e -> {
                            log.warn("Revoke NPM failed: {}", e.getMessage());
                            return Mono.empty();
                        })
                        .block(Duration.ofSeconds(20));
            } catch (Exception e) {
                log.warn("Revoke NPM failed for {}: {}", service.getId(), e.toString());
            }
        }
    }

    /**
     * After all services are torn down: wipe project volume folder + Docker project network.
     * Best-effort for leftovers; does not fail delete if already gone.
     */
    public void removeProjectLeftovers(String ownerId, String projectId) {
        if (projectId == null || projectId.isBlank()) {
            return;
        }
        Duration timeout = Duration.ofSeconds(60);
        String projectVolume = composeGenerator.resolveProjectVolumeHostPath(ownerId, projectId);
        String networkName = composeGenerator.projectNetworkName(projectId);

        log.info("Removing project leftovers project={} volume={} network={}",
                projectId, projectVolume, networkName);

        try {
            portainerClient.wipeBindMount(projectVolume).block(timeout);
        } catch (Exception e) {
            log.warn("Project volume wipe failed for {}: {}", projectVolume, e.getMessage());
        }

        try {
            portainerClient.removeNetworkByName(networkName, edgeRouter.edgeName())
                    .onErrorResume(e -> {
                        log.warn("Project network remove failed for {}: {}", networkName, e.getMessage());
                        return Mono.empty();
                    })
                    .block(timeout);
        } catch (Exception e) {
            log.warn("Project network remove failed for {}: {}", networkName, e.getMessage());
        }
    }

    /** True when CloudBase expects Portainer resources for this service. */
    private static boolean requiresPortainerTeardown(ServiceEntity service) {
        if (service.getPortainerStackId() != null) {
            return true;
        }
        ServiceStatus st = service.getStatus();
        return st == ServiceStatus.RUNNING
                || st == ServiceStatus.STOPPED
                || st == ServiceStatus.FAILED
                || st == ServiceStatus.BUILDING
                || st == ServiceStatus.DEPLOYING;
    }

    private org.springframework.web.server.ResponseStatusException teardownFailed(
            String serviceId, String message, Exception cause
    ) {
        String detail = cause != null && cause.getMessage() != null ? cause.getMessage() : "unknown error";
        log.error("Delete aborted for {}: {} ({})", serviceId, message, detail);
        return new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.BAD_GATEWAY,
                message + " (" + detail + ")"
        );
    }

    /** Public HTTPS hostname: custom domain if set, otherwise opaque platform FQDN. */
    public String resolveFqdn(ServiceEntity service) {
        if (service.getSubdomain() != null && !service.getSubdomain().isBlank()) {
            String sub = service.getSubdomain().trim().toLowerCase();
            if (sub.contains(".")) {
                return sub;
            }
            return sub + "." + baseDomain();
        }
        return allocateOpaqueFqdn(service.getId());
    }

    public String primaryPublicHost(ServiceEntity service) {
        if (service.getCustomDomain() != null && !service.getCustomDomain().isBlank()) {
            return service.getCustomDomain().trim().toLowerCase();
        }
        return resolveFqdn(service);
    }

    public String getBaseDomain() {
        return baseDomain();
    }

    public String stackName(ServiceEntity service) {
        return "cb-" + service.getProject().getId() + "-" + service.getId();
    }

    private void onStackSuccess(String serviceId, String deploymentId, Map<String, Object> result) {
        transactionTemplate.executeWithoutResult(status -> {
            DeploymentEntity existing = deploymentRepository.findByIdForUpdate(deploymentId).orElse(null);
            if (existing != null && existing.getStatus() == DeploymentStatus.CANCELLED) {
                log.info("Ignoring success for cancelled deployment {}", deploymentId);
                return;
            }
            Integer stackId = asInt(result != null ? result.get("Id") : null);
            serviceRepository.findByIdWithProject(serviceId).ifPresent(service -> {
                if (stackId != null) {
                    service.setPortainerStackId(stackId);
                }
                service.setStatus(ServiceStatus.RUNNING);
                service.setEnvPendingDeploy(false);
                ensureOpaquePlatformDomain(service);
                serviceRepository.save(service);
                eventPublisher.publishServiceStatusUpdate(service);
                ensureProxyHost(service);
                String href = "/projects/" + service.getProject().getId() + "/services/" + service.getId();
                notificationService.notifyUser(
                        service.getProject().getOwnerId(),
                        "Deploy succeeded",
                        service.getName() + " is running.",
                        href
                );
                emailDeployOutcome(service, true, service.getName() + " is running.", href);
            });

            deploymentRepository.findById(deploymentId).ifPresent(deployment -> {
                if (deployment.getStatus() == DeploymentStatus.CANCELLED) {
                    return;
                }
                deployment.setStatus(DeploymentStatus.SUCCESS);
                deployment.setStage("success");
                deployment.setFinishedAt(Instant.now());
                if (stackId != null) {
                    deployment.setPortainerStackId(stackId);
                }
                deployment.setLogs(appendLogLine(deployment.getLogs(),
                        "[" + clock() + "] [Success] Portainer stack upserted, container running, public app verified"));
                deploymentRepository.save(deployment);
                eventPublisher.publishDeploymentUpdate(deployment);
            });
            log.info("Deploy succeeded service={} deployment={}", serviceId, deploymentId);
            if (dockerJanitor != null) dockerJanitor.requestPass(); // the image this deploy replaced is now unused
        });
    }

    private void onStackFailure(String serviceId, String deploymentId, Throwable error) {
        transactionTemplate.executeWithoutResult(status -> {
            DeploymentEntity existing = deploymentRepository.findByIdForUpdate(deploymentId).orElse(null);
            if (existing != null && existing.getStatus() == DeploymentStatus.CANCELLED) {
                log.info("Ignoring failure for cancelled deployment {}", deploymentId);
                return;
            }
            serviceRepository.findByIdWithProject(serviceId).ifPresent(service -> {
                service.setStatus(ServiceStatus.FAILED);
                serviceRepository.save(service);
                eventPublisher.publishServiceStatusUpdate(service);
                String href = "/projects/" + service.getProject().getId() + "/services/" + service.getId();
                String msg = error != null && error.getMessage() != null ? error.getMessage() : "unknown error";
                notificationService.notifyUser(
                        service.getProject().getOwnerId(),
                        "Deploy failed",
                        service.getName() + ": " + msg,
                        href
                );
                emailDeployOutcome(service, false, msg, href);
            });
            deploymentRepository.findById(deploymentId).ifPresent(deployment -> {
                if (deployment.getStatus() == DeploymentStatus.CANCELLED) {
                    return;
                }
                deployment.setStatus(DeploymentStatus.FAILED);
                deployment.setStage("failed");
                deployment.setFinishedAt(Instant.now());
                String msg = error != null && error.getMessage() != null ? error.getMessage() : "unknown error";
                deployment.setErrorMessage(msg);
                deployment.setLogs(appendLogLine(deployment.getLogs(),
                        "[" + clock() + "] [Failed] " + msg));
                deploymentRepository.save(deployment);
                eventPublisher.publishDeploymentUpdate(deployment);
            });
            log.error("Deploy failed service={} deployment={}: {}", serviceId, deploymentId,
                    error != null ? error.getMessage() : "unknown");
        });
    }

    private void emailDeployOutcome(ServiceEntity service, boolean success, String detail, String href) {
        try {
            String ownerId = service.getProject() == null ? null : service.getProject().getOwnerId();
            if (ownerId == null || ownerId.isBlank()) {
                return;
            }
            userRepository.findById(ownerId).ifPresent(owner -> {
                if (success && !owner.isNotifyEmailDeployments()) {
                    return;
                }
                if (!success && !owner.isNotifyEmailFailures()) {
                    return;
                }
                emailService.sendDeployResult(
                        owner.getEmail(),
                        owner.getName(),
                        service.getName(),
                        success,
                        detail,
                        href
                );
            });
        } catch (Exception e) {
            log.warn("Deploy email skipped for {}: {}", service.getId(), e.getMessage());
        }
    }

    private void ensureDbSecrets(ServiceEntity service, Map<String, String> extras) {
        Map<String, Object> env = service.getEnvVars() != null
                ? new HashMap<>(service.getEnvVars())
                : new HashMap<>();
        putSecretIfAbsent(env, extras, "DB_PASSWORD");
        putSecretIfAbsent(env, extras, "DB_ROOT_PASSWORD");
        putSecretIfAbsent(env, extras, "REDIS_PASSWORD");
        putSecretIfAbsent(env, extras, "MONGO_PASSWORD");
        service.setEnvVars(env);
        serviceRepository.save(service);
    }

    /** {@code ${{Project.KEY}}} or {@code ${{service-name.KEY}}}, as offered by the Variables tab's reference picker. */
    static final java.util.regex.Pattern VAR_REF = java.util.regex.Pattern.compile(
            "\\$\\{\\{\\s*([^.{}]+?)\\s*\\.\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*}}");

    /**
     * Replaces variable references with values from the same project only: a shared variable, or a variable of
     * another service (for example a database's generated DB_PASSWORD). One pass, no nesting, so a value can never
     * pull in more than it names. Anything that does not resolve is left as written and reported in the deploy log.
     */
    List<Map<String, String>> resolveReferences(ServiceEntity service, List<Map<String, String>> env, String deploymentId) {
        if (env.stream().noneMatch(e -> e.get("value") != null && e.get("value").contains("${{"))) {
            return env;
        }
        Map<String, String> projectVars = new HashMap<>();
        Map<String, Map<String, String>> serviceVars = new HashMap<>();
        if (service.getProject() != null) {
            List<Map<String, Object>> shared = service.getProject().getSharedVariables();
            if (shared != null) {
                for (Map<String, Object> v : shared) {
                    if (v != null && v.get("key") != null) {
                        projectVars.put(String.valueOf(v.get("key")).trim(), v.get("value") == null ? "" : String.valueOf(v.get("value")));
                    }
                }
            }
            // Reachable by display name (what the reference picker inserts) and by host name, which stays the same
            // when a database is renamed. Host names are applied last, so a display name never shadows one.
            Map<String, Map<String, String>> byHost = new HashMap<>();
            for (ServiceEntity other : serviceRepository.findByProject_Id(service.getProject().getId())) {
                if (other.getId().equals(service.getId()) || other.getEnvVars() == null) continue;
                Map<String, String> vars = new HashMap<>();
                other.getEnvVars().forEach((k, v) -> vars.put(k, plainValue(v)));
                serviceVars.put(other.getName().trim().toLowerCase(Locale.ROOT), vars);
                byHost.put(ComposeGenerator.serviceHostName(other), vars);
            }
            serviceVars.putAll(byHost);
        }
        List<String> unresolved = new ArrayList<>();
        List<Map<String, String>> out = new ArrayList<>(env.size());
        for (Map<String, String> entry : env) {
            String value = entry.get("value");
            if (value == null || !value.contains("${{")) {
                out.add(entry);
                continue;
            }
            java.util.regex.Matcher m = VAR_REF.matcher(value);
            StringBuilder sb = new StringBuilder();
            while (m.find()) {
                String scope = m.group(1).trim();
                String key = m.group(2);
                String found = "project".equalsIgnoreCase(scope)
                        ? projectVars.get(key)
                        : serviceVars.getOrDefault(scope.toLowerCase(Locale.ROOT), Map.of()).get(key);
                if (found == null) {
                    unresolved.add(entry.get("name") + " → " + m.group());
                    found = m.group();
                }
                m.appendReplacement(sb, java.util.regex.Matcher.quoteReplacement(found));
            }
            m.appendTail(sb);
            out.add(Map.of("name", entry.get("name"), "value", sb.toString()));
        }
        if (!unresolved.isEmpty() && deploymentId != null) {
            appendStage(deploymentId, DeploymentStatus.BUILDING, "building",
                    "Warning: could not resolve " + String.join(", ", unresolved)
                            + ". Check the service name and key (deploy a database once to create its password).");
        }
        return out;
    }

    /** Marks a service variable that is a copy of a project shared variable (and not the service's own). */
    public static final String SHARED_MARKER = "fromShared";

    /**
     * Copies the project's shared variables into this service (the compose file references every service variable),
     * marked as shared copies so they stay in step with the project on every deploy:
     * <ul>
     *   <li>a shared variable removed from the project or unassigned from this service disappears from it;</li>
     *   <li>a changed value is picked up;</li>
     *   <li>a variable the service defines itself with the same key wins over the shared one.</li>
     * </ul>
     * Copies made before the marker existed are adopted when their value still equals the shared value.
     */
    void mergeSharedVariables(ServiceEntity service, Map<String, String> extras) {
        Map<String, Object> env = service.getEnvVars() != null
                ? new LinkedHashMap<>(service.getEnvVars())
                : new LinkedHashMap<>();
        Map<String, Map<String, Object>> applicable = new LinkedHashMap<>();
        List<Map<String, Object>> shared = service.getProject() == null ? null : service.getProject().getSharedVariables();
        if (shared != null) {
            for (Map<String, Object> var : shared) {
                if (var == null || !(var.get("serviceIds") instanceof List<?> ids)) continue;
                if (ids.stream().noneMatch(id -> service.getId().equals(String.valueOf(id)))) continue;
                String key = String.valueOf(var.getOrDefault("key", "")).trim();
                if (!key.isBlank()) applicable.put(key, var);
            }
        }
        boolean changed = env.entrySet().removeIf(e -> isSharedCopy(e.getValue()) && !applicable.containsKey(e.getKey()));
        for (Map.Entry<String, Map<String, Object>> entry : applicable.entrySet()) {
            String key = entry.getKey();
            String value = entry.getValue().get("value") == null ? "" : String.valueOf(entry.getValue().get("value"));
            boolean isSecret = Boolean.TRUE.equals(entry.getValue().get("isSecret"));
            Object existing = env.get(key);
            boolean ownValue = existing != null && !isSharedCopy(existing) && !value.equals(plainValue(existing));
            if (ownValue) {
                continue; // the service's own variable overrides the project-wide one
            }
            Map<String, Object> copy = new LinkedHashMap<>();
            copy.put("value", value);
            copy.put("isSecret", isSecret);
            copy.put(SHARED_MARKER, true);
            if (!copy.equals(existing)) {
                env.put(key, copy);
                changed = true;
            }
        }
        if (changed) {
            service.setEnvVars(env);
            serviceRepository.save(service);
        }
    }

    private static boolean isSharedCopy(Object value) {
        return value instanceof Map<?, ?> m && Boolean.TRUE.equals(m.get(SHARED_MARKER));
    }

    private static String plainValue(Object value) {
        if (value instanceof Map<?, ?> m) return m.get("value") == null ? "" : String.valueOf(m.get("value"));
        return value == null ? "" : String.valueOf(value);
    }

    private static void putSecretIfAbsent(Map<String, Object> env, Map<String, String> extras, String key) {
        Object existing = env.get(key);
        String value = null;
        if (existing instanceof Map<?, ?> m && m.get("value") != null) {
            value = String.valueOf(m.get("value"));
        } else if (existing != null) {
            value = String.valueOf(existing);
        }
        if (value == null || value.isBlank()) {
            value = generatePassword();
            env.put(key, Map.of("value", value, "isSecret", true));
        }
        extras.put(key, value);
    }

    private static final java.security.SecureRandom PASSWORD_RANDOM = new java.security.SecureRandom();
    private static final char[] PASSWORD_CHARS =
            "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789".toCharArray();

    /** 32 characters from a 57-letter alphabet (~186 bits); URL- and shell-safe, so connection strings never break. */
    static String generatePassword() {
        char[] out = new char[32];
        for (int i = 0; i < out.length; i++) out[i] = PASSWORD_CHARS[PASSWORD_RANDOM.nextInt(PASSWORD_CHARS.length)];
        return new String(out);
    }

    private static Integer asInt(Object value) {
        if (value == null) return null;
        if (value instanceof Number n) return n.intValue();
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
