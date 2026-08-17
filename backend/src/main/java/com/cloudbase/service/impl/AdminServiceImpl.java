package com.cloudbase.service.impl;

import com.cloudbase.dto.AdminDtos.AuditLogEntry;
import com.cloudbase.dto.AdminDtos.HostingSettingsResponse;
import com.cloudbase.dto.AdminDtos.HostingSettingsUpdateRequest;
import com.cloudbase.dto.AdminDtos.InfrastructureOverview;
import com.cloudbase.dto.AuthDtos.MessageResponse;
import com.cloudbase.email.EmailService;
import com.cloudbase.email.ResendProperties;
import com.cloudbase.entity.DeploymentEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.AccountStatus;
import com.cloudbase.model.AuditAction;
import com.cloudbase.model.DeploymentStatus;
import com.cloudbase.model.ServiceStatus;
import com.cloudbase.model.UserAccount;
import com.cloudbase.model.UserRole;
import com.cloudbase.npm.NpmClient;
import com.cloudbase.portainer.PortainerClient;
import com.cloudbase.repository.DeploymentRepository;
import com.cloudbase.repository.ServiceRepository;
import com.cloudbase.repository.UserRepository;
import com.cloudbase.security.JwtService;
import com.cloudbase.service.AdminService;
import com.cloudbase.service.AuditService;
import com.cloudbase.service.DeploymentOrchestrator;
import com.cloudbase.service.PlatformSettingsService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriComponentsBuilder;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

@Service
@Transactional
public class AdminServiceImpl implements AdminService {

    private static final Logger log = LoggerFactory.getLogger(AdminServiceImpl.class);

    private final UserRepository userRepository;
    private final ServiceRepository serviceRepository;
    private final DeploymentRepository deploymentRepository;
    private final PortainerClient portainerClient;
    private final NpmClient npmClient;
    private final EmailService emailService;
    private final JwtService jwtService;
    private final ResendProperties resendProperties;
    private final AuditService auditService;
    private final PlatformSettingsService platformSettingsService;
    private final DeploymentOrchestrator orchestrator;
    private final TransactionTemplate requiresNewTx;

    public AdminServiceImpl(
            UserRepository userRepository,
            ServiceRepository serviceRepository,
            DeploymentRepository deploymentRepository,
            PortainerClient portainerClient,
            NpmClient npmClient,
            EmailService emailService,
            JwtService jwtService,
            ResendProperties resendProperties,
            AuditService auditService,
            PlatformSettingsService platformSettingsService,
            DeploymentOrchestrator orchestrator,
            org.springframework.transaction.PlatformTransactionManager txManager
    ) {
        this.userRepository = userRepository;
        this.serviceRepository = serviceRepository;
        this.deploymentRepository = deploymentRepository;
        this.portainerClient = portainerClient;
        this.npmClient = npmClient;
        this.emailService = emailService;
        this.jwtService = jwtService;
        this.resendProperties = resendProperties;
        this.auditService = auditService;
        this.platformSettingsService = platformSettingsService;
        this.orchestrator = orchestrator;
        this.requiresNewTx = new TransactionTemplate(txManager);
        this.requiresNewTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Override
    public List<UserAccount> listUsers() {
        return userRepository.findAll().stream()
                .sorted(Comparator.comparing(UserEntity::getName))
                .map(AuthServiceImpl::toModel)
                .toList();
    }

    @Override
    public UserAccount updateDeploymentAccess(UserEntity actor, String userId, boolean enabled) {
        UserEntity user = requireUser(userId);
        boolean wasEnabled = user.isDeploymentEnabled();
        user.setDeploymentEnabled(enabled);
        UserEntity saved = userRepository.save(user);
        auditService.record(
                actor,
                enabled ? AuditAction.DEPLOY_ACCESS_ENABLED : AuditAction.DEPLOY_ACCESS_DISABLED,
                saved.getName(),
                enabled
                        ? "Deployment access enabled"
                        : "Deployment access disabled — all containers revoked"
        );
        if (enabled && !wasEnabled) {
            try {
                emailService.sendDeploymentEnabled(saved.getEmail(), saved.getName());
            } catch (Exception e) {
                log.warn("Deployment-enabled email failed for {}: {}", saved.getEmail(), e.toString());
            }
        }
        if (!enabled && wasEnabled) {
            scheduleRuntimeRevoke(saved.getId(), "deployment access disabled");
        }
        return AuthServiceImpl.toModel(saved);
    }

    @Override
    public UserAccount updateAccountStatus(UserEntity actor, String userId, AccountStatus status) {
        UserEntity user = requireUser(userId);
        if (status == AccountStatus.ACTIVE && !user.isEmailVerified()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Cannot activate account until the user verifies their email."
            );
        }
        AccountStatus previous = user.getAccountStatus();
        user.setAccountStatus(status);
        // Leaving ACTIVE (suspend / deactivate) → tear down all containers; keep volumes.
        boolean revokeRuntime = previous == AccountStatus.ACTIVE && status != AccountStatus.ACTIVE;
        if (revokeRuntime) {
            user.setDeploymentEnabled(false);
        }
        UserEntity saved = userRepository.save(user);
        if (previous != AccountStatus.ACTIVE && status == AccountStatus.ACTIVE) {
            try {
                emailService.sendAccountActivated(saved.getEmail(), saved.getName());
            } catch (Exception e) {
                log.warn("Account-activated email failed for {}: {}", saved.getEmail(), e.toString());
            }
        }
        AuditAction action = status == AccountStatus.SUSPENDED
                ? AuditAction.ACCOUNT_SUSPENDED
                : AuditAction.ACCOUNT_ACTIVATED;
        String details = revokeRuntime
                ? "Account set to " + status.name() + " — all containers revoked"
                : "Account set to " + status.name();
        auditService.record(actor, action, saved.getName(), details);
        if (revokeRuntime) {
            scheduleRuntimeRevoke(saved.getId(), "account " + status.name().toLowerCase());
        }
        return AuthServiceImpl.toModel(saved);
    }

    /**
     * Tear down Portainer/NPM after the admin flag commit succeeds so a Portainer outage
     * cannot roll back the disable/suspend decision.
     */
    private void scheduleRuntimeRevoke(String ownerUserId, String reason) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            revokeAllUserRuntime(ownerUserId, reason);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                revokeAllUserRuntime(ownerUserId, reason);
            }
        });
    }

    private void revokeAllUserRuntime(String ownerUserId, String reason) {
        log.info("Revoking all runtime for user={} reason={}", ownerUserId, reason);
        // REQUIRES_NEW so OSIV / outer request session cannot overwrite STOPPED rows on flush.
        requiresNewTx.executeWithoutResult(status -> {
            List<ServiceEntity> services = serviceRepository.findByOwnerIdWithProject(ownerUserId);
            Instant now = Instant.now();
            int revoked = 0;
            for (ServiceEntity service : services) {
                try {
                    cancelActiveDeployments(service.getId(), now, reason);
                    orchestrator.revokeRuntimeKeepData(service);
                    int updated = serviceRepository.markStoppedClearRuntime(service.getId());
                    log.info("Revoked service={} dbRowsUpdated={}", service.getId(), updated);
                    revoked++;
                } catch (Exception e) {
                    log.warn("Failed to revoke runtime for service {}: {}", service.getId(), e.toString());
                }
            }
            log.info("Revoked runtime for user={} services={} reason={}", ownerUserId, revoked, reason);
        });
    }

    private void cancelActiveDeployments(String serviceId, Instant now, String reason) {
        for (DeploymentEntity dep : deploymentRepository.findByServiceIdOrderByStartedAtDesc(serviceId)) {
            if (dep.getStatus() == DeploymentStatus.QUEUED
                    || dep.getStatus() == DeploymentStatus.BUILDING
                    || dep.getStatus() == DeploymentStatus.DEPLOYING) {
                dep.setStatus(DeploymentStatus.CANCELLED);
                dep.setFinishedAt(now);
                dep.setLogs((dep.getLogs() == null ? "" : dep.getLogs() + "\n")
                        + "Cancelled — " + reason);
                if (dep.getErrorMessage() == null || dep.getErrorMessage().isBlank()) {
                    dep.setErrorMessage("Cancelled — " + reason);
                }
                deploymentRepository.save(dep);
            } else {
                break;
            }
        }
    }

    @Override
    public MessageResponse sendPasswordReset(UserEntity actor, String userId) {
        UserEntity user = requireUser(userId);
        String token = jwtService.generatePasswordResetToken(user.getId());
        String resetUrl = UriComponentsBuilder
                .fromUriString(resendProperties.appBaseUrl())
                .path("/auth")
                .queryParam("mode", "reset")
                .queryParam("token", token)
                .build()
                .toUriString();
        emailService.sendPasswordReset(user.getEmail(), user.getName(), resetUrl);
        auditService.record(
                actor,
                AuditAction.PASSWORD_RESET_SENT,
                user.getName(),
                "Password reset link sent to " + user.getEmail()
        );
        return new MessageResponse("Password reset email sent to " + user.getEmail());
    }

    @Override
    public UserAccount updateRole(UserEntity actor, String userId, UserRole role) {
        UserEntity user = requireUser(userId);
        user.setRole(role);
        UserEntity saved = userRepository.save(user);
        auditService.record(actor, AuditAction.ROLE_CHANGED, saved.getName(), "Role changed to " + role.name());
        return AuthServiceImpl.toModel(saved);
    }

    @Override
    @Transactional(readOnly = true)
    public List<AuditLogEntry> listAuditLogs() {
        return auditService.listRecent().stream()
                .map(e -> new AuditLogEntry(
                        e.getId(),
                        e.getTimestamp() != null ? e.getTimestamp().toString() : null,
                        e.getActorName(),
                        e.getActorEmail(),
                        e.getAction().name(),
                        e.getTarget(),
                        e.getDetails()
                ))
                .toList();
    }

    @Override
    public InfrastructureOverview infrastructureOverview() {
        long runningServices = serviceRepository.findAll().stream()
                .filter(s -> s.getStatus().name().equals("RUNNING"))
                .count();

        String portainerStatus = "disconnected";
        int activeContainers = (int) runningServices;
        String hostCpu = "-";
        String hostRam = "-";
        try {
            portainerClient.getStatus().block();
            portainerStatus = "connected";
            Map<String, Object> endpoint = portainerClient.getEndpoint().block();
            if (endpoint != null) {
                Object snaps = endpoint.get("Snapshots");
                if (snaps instanceof List<?> list && !list.isEmpty() && list.get(0) instanceof Map<?, ?> snap) {
                    Object running = snap.get("RunningContainerCount");
                    if (running instanceof Number n) {
                        activeContainers = n.intValue();
                    }
                    Object cpu = snap.get("TotalCPU");
                    if (cpu instanceof Number n) {
                        hostCpu = n.intValue() + " CPUs";
                    }
                    Object mem = snap.get("TotalMemory");
                    if (mem instanceof Number n) {
                        double gb = n.doubleValue() / (1024d * 1024d * 1024d);
                        hostRam = String.format(java.util.Locale.US, "%.1f GB", gb);
                    }
                }
            }
        } catch (Exception ignored) {
        }

        String npmStatus = "disabled";
        try {
            Map<String, Object> npm = npmClient.getStatus().block();
            if (npm != null && npm.get("status") != null) {
                npmStatus = String.valueOf(npm.get("status"));
            }
        } catch (Exception ignored) {
            npmStatus = "error";
        }

        String tunnelStatus = "active".equalsIgnoreCase(npmStatus) || "connected".equals(portainerStatus)
                ? "active"
                : "unknown";

        return new InfrastructureOverview(
                portainerStatus,
                npmStatus,
                tunnelStatus,
                activeContainers,
                hostCpu,
                hostRam
        );
    }

    @Override
    public HostingSettingsResponse getHostingSettings() {
        return platformSettingsService.view();
    }

    @Override
    public HostingSettingsResponse updateHostingSettings(UserEntity actor, HostingSettingsUpdateRequest request) {
        HostingSettingsResponse before = platformSettingsService.view();
        HostingSettingsResponse saved = platformSettingsService.update(actor, request);
        if (!before.equals(saved)) {
            auditService.record(
                    actor,
                    AuditAction.HOSTING_SETTINGS_UPDATED,
                    "Platform hosting",
                    "Updated selected hosting fields only (partial save)"
            );
        }
        return saved;
    }

    private UserEntity requireUser(String userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
    }
}
