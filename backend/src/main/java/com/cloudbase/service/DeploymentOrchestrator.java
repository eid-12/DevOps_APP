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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
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
    private final String baseDomain;

    public DeploymentOrchestrator(
            ServiceRepository serviceRepository,
            DeploymentRepository deploymentRepository,
            ComposeGenerator composeGenerator,
            PortainerClient portainerClient,
            NpmClient npmClient,
            DeploymentEventPublisher eventPublisher,
            @Value("${cloudbase.base-domain:cloudbase.website}") String baseDomain
    ) {
        this.serviceRepository = serviceRepository;
        this.deploymentRepository = deploymentRepository;
        this.composeGenerator = composeGenerator;
        this.portainerClient = portainerClient;
        this.npmClient = npmClient;
        this.eventPublisher = eventPublisher;
        this.baseDomain = baseDomain;
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

        portainerClient.upsertStack(stackName, compose, env, existingStackId, pullImage)
                .subscribe(
                        result -> onStackSuccess(serviceId, deploymentId, result),
                        error -> onStackFailure(serviceId, deploymentId, error)
                );

        return deployment;
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
     * Assign a random numeric *.baseDomain hostname that cannot be guessed from the service name.
     * Vanity / name-based platform hosts are rewritten once to opaque numbers.
     */
    public void ensureOpaquePlatformDomain(ServiceEntity service) {
        if (service.getSourceType() == ServiceSourceType.DATABASE) {
            return;
        }
        if (isOpaquePlatformDomain(service.getSubdomain())) {
            // Normalize to full FQDN
            String current = service.getSubdomain().trim().toLowerCase();
            if (!current.contains(".")) {
                service.setSubdomain(current + "." + baseDomain);
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
        for (int attempt = 0; attempt < 32; attempt++) {
            long n = ThreadLocalRandom.current().nextLong(100_000_000_000L, 1_000_000_000_000L); // 12 digits
            String fqdn = n + "." + baseDomain;
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
        return UUID.randomUUID().toString().replace("-", "").substring(0, 12) + "." + baseDomain;
    }

    public boolean isOpaquePlatformDomain(String subdomain) {
        if (subdomain == null || subdomain.isBlank()) {
            return false;
        }
        String host = subdomain.trim().toLowerCase();
        String suffix = "." + baseDomain;
        if (!host.endsWith(suffix) && !host.equals(baseDomain)) {
            // bare numeric slug without suffix still counts
            return host.matches("\\d{10,16}");
        }
        if (!host.endsWith(suffix)) {
            return false;
        }
        String slug = host.substring(0, host.length() - suffix.length());
        return slug.matches("\\d{10,16}");
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

    public void removeInfrastructure(ServiceEntity service) {
        if (service.getPortainerStackId() != null) {
            portainerClient.removeStack(service.getPortainerStackId())
                    .subscribe(
                            v -> log.info("Removed Portainer stack {}", service.getPortainerStackId()),
                            e -> log.warn("Portainer remove failed: {}", e.getMessage())
                    );
        }
        if (service.getNpmProxyHostId() != null) {
            npmClient.deleteProxyHost(service.getNpmProxyHostId())
                    .subscribe(
                            v -> {},
                            e -> log.warn("NPM remove failed: {}", e.getMessage())
                    );
        }
    }

    /** Public HTTPS hostname: custom domain if set, otherwise opaque platform FQDN. */
    public String resolveFqdn(ServiceEntity service) {
        if (service.getSubdomain() != null && !service.getSubdomain().isBlank()) {
            String sub = service.getSubdomain().trim().toLowerCase();
            if (sub.contains(".")) {
                return sub;
            }
            return sub + "." + baseDomain;
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
        return baseDomain;
    }

    public String stackName(ServiceEntity service) {
        return "cb-" + service.getProject().getId() + "-" + service.getId();
    }

    private void onStackSuccess(String serviceId, String deploymentId, Map<String, Object> result) {
        Integer stackId = asInt(result != null ? result.get("Id") : null);
        serviceRepository.findById(serviceId).ifPresent(service -> {
            if (stackId != null) {
                service.setPortainerStackId(stackId);
            }
            service.setStatus(ServiceStatus.RUNNING);
            service.setEnvPendingDeploy(false);
            ensureOpaquePlatformDomain(service);
            serviceRepository.save(service);
            eventPublisher.publishServiceStatusUpdate(service);
            ensureProxyHost(service);
        });

        deploymentRepository.findById(deploymentId).ifPresent(deployment -> {
            deployment.setStatus(DeploymentStatus.SUCCESS);
            deployment.setFinishedAt(Instant.now());
            if (stackId != null) {
                deployment.setPortainerStackId(stackId);
            }
            deployment.setLogs((deployment.getLogs() == null ? "" : deployment.getLogs() + "\n")
                    + "Portainer stack upserted successfully");
            deploymentRepository.save(deployment);
            eventPublisher.publishDeploymentUpdate(deployment);
        });
        log.info("Deploy succeeded service={} deployment={}", serviceId, deploymentId);
    }

    private void onStackFailure(String serviceId, String deploymentId, Throwable error) {
        serviceRepository.findById(serviceId).ifPresent(service -> {
            service.setStatus(ServiceStatus.FAILED);
            serviceRepository.save(service);
            eventPublisher.publishServiceStatusUpdate(service);
        });
        deploymentRepository.findById(deploymentId).ifPresent(deployment -> {
            deployment.setStatus(DeploymentStatus.FAILED);
            deployment.setFinishedAt(Instant.now());
            deployment.setLogs("Deployment failed: " + error.getMessage());
            deploymentRepository.save(deployment);
            eventPublisher.publishDeploymentUpdate(deployment);
        });
        log.error("Deploy failed service={} deployment={}: {}", serviceId, deploymentId, error.getMessage());
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
