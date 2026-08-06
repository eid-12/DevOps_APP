package com.cloudbase.service.impl;

import com.cloudbase.dto.AdminDtos.AuditLogEntry;
import com.cloudbase.dto.AdminDtos.InfrastructureOverview;
import com.cloudbase.dto.AuthDtos.MessageResponse;
import com.cloudbase.email.EmailService;
import com.cloudbase.email.ResendProperties;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.AccountStatus;
import com.cloudbase.model.AuditAction;
import com.cloudbase.model.UserAccount;
import com.cloudbase.model.UserRole;
import com.cloudbase.npm.NpmClient;
import com.cloudbase.portainer.PortainerClient;
import com.cloudbase.repository.ServiceRepository;
import com.cloudbase.repository.UserRepository;
import com.cloudbase.security.JwtService;
import com.cloudbase.service.AdminService;
import com.cloudbase.service.AuditService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Comparator;
import java.util.List;
import java.util.Map;

@Service
@Transactional
public class AdminServiceImpl implements AdminService {

    private final UserRepository userRepository;
    private final ServiceRepository serviceRepository;
    private final PortainerClient portainerClient;
    private final NpmClient npmClient;
    private final EmailService emailService;
    private final JwtService jwtService;
    private final ResendProperties resendProperties;
    private final AuditService auditService;

    public AdminServiceImpl(
            UserRepository userRepository,
            ServiceRepository serviceRepository,
            PortainerClient portainerClient,
            NpmClient npmClient,
            EmailService emailService,
            JwtService jwtService,
            ResendProperties resendProperties,
            AuditService auditService
    ) {
        this.userRepository = userRepository;
        this.serviceRepository = serviceRepository;
        this.portainerClient = portainerClient;
        this.npmClient = npmClient;
        this.emailService = emailService;
        this.jwtService = jwtService;
        this.resendProperties = resendProperties;
        this.auditService = auditService;
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
        user.setDeploymentEnabled(enabled);
        UserEntity saved = userRepository.save(user);
        auditService.record(
                actor,
                enabled ? AuditAction.DEPLOY_ACCESS_ENABLED : AuditAction.DEPLOY_ACCESS_DISABLED,
                saved.getName(),
                enabled ? "Deployment access enabled" : "Deployment access disabled"
        );
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
        UserEntity saved = userRepository.save(user);
        if (previous != AccountStatus.ACTIVE && status == AccountStatus.ACTIVE) {
            emailService.sendAccountActivated(saved.getEmail(), saved.getName());
        }
        AuditAction action = status == AccountStatus.SUSPENDED
                ? AuditAction.ACCOUNT_SUSPENDED
                : AuditAction.ACCOUNT_ACTIVATED;
        String details = status == AccountStatus.SUSPENDED
                ? "Account suspended"
                : "Account set to " + status.name();
        auditService.record(actor, action, saved.getName(), details);
        return AuthServiceImpl.toModel(saved);
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
        try {
            portainerClient.getStatus().block();
            portainerStatus = "connected";
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

        return new InfrastructureOverview(
                portainerStatus,
                npmStatus,
                "active",
                (int) runningServices,
                "–",
                "–"
        );
    }

    private UserEntity requireUser(String userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
    }
}
