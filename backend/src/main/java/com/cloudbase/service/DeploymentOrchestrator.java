package com.cloudbase.service;

import com.cloudbase.dto.ProjectDtos.DeployServiceRequest;
import com.cloudbase.entity.DeploymentEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.DeploymentStatus;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.model.ServiceStatus;
import com.cloudbase.npm.NpmClient;
import com.cloudbase.portainer.ComposeGenerator;
import com.cloudbase.portainer.PortainerClient;
import com.cloudbase.repository.DeploymentRepository;
import com.cloudbase.repository.ServiceRepository;
import com.cloudbase.service.NotificationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
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
            TransactionTemplate transactionTemplate
    ) {
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

        service.setStatus(ServiceStatus.DEPLOYING);
        service.setLatestDeploymentId(deployment.getId());
        serviceRepository.save(service);
        eventPublisher.publishServiceStatusUpdate(service);
        eventPublisher.publishDeploymentUpdate(deployment);

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
        deployment.setStatus(DeploymentStatus.BUILDING);
        deploymentRepository.save(deployment);
        eventPublisher.publishDeploymentUpdate(deployment);

        List<Map<String, String>> env = composeGenerator.buildPortainerEnv(service, extras);
        String stackName = stackName(service);

        deployment.setStatus(DeploymentStatus.DEPLOYING);
        deploymentRepository.save(deployment);
        eventPublisher.publishDeploymentUpdate(deployment);

        Integer existingStackId = service.getPortainerStackId();
        boolean pullImage = service.getSourceType() != ServiceSourceType.DATABASE;
        final String containerName = composeGenerator.resolveContainerName(service);

        // GitHub: refuse when CI never built an image (avoids opaque Portainer 500).
        if (service.getSourceType() == ServiceSourceType.GITHUB) {
            String gate = githubDeployGateReason(service);
            if (gate != null) {
                onStackFailure(serviceId, deploymentId, new IllegalStateException(gate));
                return deployment;
            }
            String missingImage = missingDockerHubImageReason(service, imageTag);
            if (missingImage != null) {
                onStackFailure(serviceId, deploymentId, new IllegalStateException(missingImage));
                return deployment;
            }
        }

        portainerClient.upsertStack(stackName, compose, env, existingStackId, pullImage)
                .onErrorMap(this::friendlyPortainerError)
                .flatMap(result -> portainerClient.waitUntilRunning(containerName, 12, 2500)
                        .thenReturn(result))
                .flatMap(result -> provisionProxyAndVerifyApp(serviceId).thenReturn(result))
                .subscribe(
                        result -> onStackSuccess(serviceId, deploymentId, result),
                        error -> onStackFailure(serviceId, deploymentId, error)
                );

        return deployment;
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
                    String forwardHost = composeGenerator.resolveContainerName(service);
                    int forwardPort = composeGenerator.resolveContainerPort(service);
                    Integer existingNpmId = service.getNpmProxyHostId();

                    Mono<Void> proxy = domains.isEmpty() || !npmClient.isEnabled()
                            ? Mono.empty()
                            : npmClient.upsertProxyHost(existingNpmId, domains, forwardHost, forwardPort)
                            .doOnNext(hostId -> transactionTemplate.executeWithoutResult(status ->
                                    serviceRepository.findById(serviceId).ifPresent(s -> {
                                        s.setNpmProxyHostId(hostId);
                                        serviceRepository.save(s);
                                    })))
                            .then();

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
        String forwardHost = composeGenerator.resolveContainerName(service);
        int forwardPort = composeGenerator.resolveContainerPort(service);

        npmClient.upsertProxyHost(service.getNpmProxyHostId(), domains, forwardHost, forwardPort)
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

        // 4) NPM proxy host (best effort)
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
            portainerClient.removeNetworkByName(networkName)
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
            DeploymentEntity existing = deploymentRepository.findById(deploymentId).orElse(null);
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
            });

            deploymentRepository.findById(deploymentId).ifPresent(deployment -> {
                if (deployment.getStatus() == DeploymentStatus.CANCELLED) {
                    return;
                }
                deployment.setStatus(DeploymentStatus.SUCCESS);
                deployment.setFinishedAt(Instant.now());
                if (stackId != null) {
                    deployment.setPortainerStackId(stackId);
                }
                deployment.setLogs((deployment.getLogs() == null ? "" : deployment.getLogs() + "\n")
                        + "Portainer stack upserted successfully\n"
                        + "Container verified running\n"
                        + "Public app verified (not a demo page)");
                deploymentRepository.save(deployment);
                eventPublisher.publishDeploymentUpdate(deployment);
            });
            log.info("Deploy succeeded service={} deployment={}", serviceId, deploymentId);
        });
    }

    private void onStackFailure(String serviceId, String deploymentId, Throwable error) {
        transactionTemplate.executeWithoutResult(status -> {
            DeploymentEntity existing = deploymentRepository.findById(deploymentId).orElse(null);
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
            });
            deploymentRepository.findById(deploymentId).ifPresent(deployment -> {
                if (deployment.getStatus() == DeploymentStatus.CANCELLED) {
                    return;
                }
                deployment.setStatus(DeploymentStatus.FAILED);
                deployment.setFinishedAt(Instant.now());
                String msg = error != null && error.getMessage() != null ? error.getMessage() : "unknown error";
                deployment.setErrorMessage(msg);
                deployment.setLogs("Deployment failed: " + msg);
                deploymentRepository.save(deployment);
                eventPublisher.publishDeploymentUpdate(deployment);
            });
            log.error("Deploy failed service={} deployment={}: {}", serviceId, deploymentId,
                    error != null ? error.getMessage() : "unknown");
        });
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

    @SuppressWarnings("unchecked")
    private void mergeSharedVariables(ServiceEntity service, Map<String, String> extras) {
        if (service.getProject() == null || service.getProject().getSharedVariables() == null) {
            return;
        }
        Map<String, Object> env = service.getEnvVars() != null
                ? new HashMap<>(service.getEnvVars())
                : new HashMap<>();
        boolean changed = false;
        for (Map<String, Object> var : service.getProject().getSharedVariables()) {
            if (var == null) continue;
            Object idsObj = var.get("serviceIds");
            boolean applies = false;
            if (idsObj instanceof List<?> ids) {
                for (Object id : ids) {
                    if (service.getId().equals(String.valueOf(id))) {
                        applies = true;
                        break;
                    }
                }
            }
            if (!applies) continue;
            String key = String.valueOf(var.getOrDefault("key", "")).trim();
            if (key.isBlank()) continue;
            String value = var.get("value") == null ? "" : String.valueOf(var.get("value"));
            boolean isSecret = Boolean.TRUE.equals(var.get("isSecret"));
            if (!env.containsKey(key)) {
                env.put(key, Map.of("value", value, "isSecret", isSecret));
                changed = true;
            }
            extras.putIfAbsent(key, value);
        }
        if (changed) {
            service.setEnvVars(env);
            serviceRepository.save(service);
        }
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
            value = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
            env.put(key, Map.of("value", value, "isSecret", true));
        }
        extras.put(key, value);
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
