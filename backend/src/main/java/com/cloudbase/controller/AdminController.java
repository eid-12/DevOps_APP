package com.cloudbase.controller;

import com.cloudbase.dto.AdminDtos.AccountStatusRequest;
import com.cloudbase.dto.AdminDtos.AuditLogEntry;
import com.cloudbase.dto.AdminDtos.DeploymentAccessRequest;
import com.cloudbase.dto.AdminDtos.HostingSettingsResponse;
import com.cloudbase.dto.AdminDtos.HostingSettingsUpdateRequest;
import com.cloudbase.dto.AdminDtos.InfrastructureOverview;
import com.cloudbase.dto.AdminDtos.RoleChangeRequest;
import com.cloudbase.email.EmailService;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.UserAccount;
import com.cloudbase.service.AdminService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final AdminService adminService;
    private final EmailService emailService;

    public AdminController(AdminService adminService, EmailService emailService) {
        this.adminService = adminService;
        this.emailService = emailService;
    }

    @GetMapping("/users")
    public List<UserAccount> users(@AuthenticationPrincipal UserEntity admin) {
        return adminService.listUsers();
    }

    @PatchMapping("/users/{userId}/deployment-access")
    public UserAccount updateDeploymentAccess(
            @AuthenticationPrincipal UserEntity admin,
            @PathVariable String userId,
            @RequestBody DeploymentAccessRequest request
    ) {
        return adminService.updateDeploymentAccess(admin, userId, request.enabled());
    }

    @PatchMapping("/users/{userId}/account-status")
    public UserAccount updateAccountStatus(
            @AuthenticationPrincipal UserEntity admin,
            @PathVariable String userId,
            @RequestBody AccountStatusRequest request
    ) {
        return adminService.updateAccountStatus(admin, userId, request.accountStatus());
    }

    @PatchMapping("/users/{userId}/role")
    public UserAccount updateRole(
            @AuthenticationPrincipal UserEntity admin,
            @PathVariable String userId,
            @RequestBody RoleChangeRequest request
    ) {
        return adminService.updateRole(admin, userId, request.role());
    }

    @PostMapping("/users/{userId}/verify-email")
    public UserAccount verifyUserEmail(
            @AuthenticationPrincipal UserEntity admin,
            @PathVariable String userId
    ) {
        return adminService.verifyUserEmail(admin, userId);
    }

    @GetMapping("/infrastructure")
    public InfrastructureOverview infrastructure(@AuthenticationPrincipal UserEntity admin) {
        return adminService.infrastructureOverview();
    }

    @GetMapping("/audit-logs")
    public List<AuditLogEntry> auditLogs(@AuthenticationPrincipal UserEntity admin) {
        return adminService.listAuditLogs();
    }

    @GetMapping("/hosting-settings")
    public HostingSettingsResponse hostingSettings(@AuthenticationPrincipal UserEntity admin) {
        return adminService.getHostingSettings();
    }

    @PutMapping("/hosting-settings")
    public HostingSettingsResponse updateHostingSettings(
            @AuthenticationPrincipal UserEntity admin,
            @RequestBody HostingSettingsUpdateRequest request
    ) {
        return adminService.updateHostingSettings(admin, request);
    }

    @PostMapping("/users/{userId}/password-reset")
    public com.cloudbase.dto.AuthDtos.MessageResponse sendPasswordReset(
            @AuthenticationPrincipal UserEntity admin,
            @PathVariable String userId
    ) {
        return adminService.sendPasswordReset(admin, userId);
    }

    /**
     * One-time: register sending domain in Resend (e.g. mawrid.cloudbase.website).
     * Returns DNS records to add in Cloudflare.
     */
    @PostMapping("/email/domain")
    public Map<String, Object> createEmailDomain(@AuthenticationPrincipal UserEntity admin) {
        return emailService.createDomain();
    }

    @GetMapping("/email/status")
    public Map<String, Object> emailStatus(@AuthenticationPrincipal UserEntity admin) {
        return Map.of("enabled", emailService.isEnabled());
    }

    /** Send all branded email templates to an inbox for visual QA. */
    @PostMapping("/email/preview")
    public Map<String, Object> previewEmails(
            @AuthenticationPrincipal UserEntity admin,
            @RequestParam(required = false) String to
    ) {
        return emailService.sendPreviewTemplates(to);
    }
}
