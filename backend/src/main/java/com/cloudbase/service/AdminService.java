package com.cloudbase.service;

import com.cloudbase.dto.AdminDtos.AuditLogEntry;
import com.cloudbase.dto.AdminDtos.HostingSettingsResponse;
import com.cloudbase.dto.AdminDtos.HostingSettingsUpdateRequest;
import com.cloudbase.dto.AdminDtos.InfrastructureOverview;
import com.cloudbase.dto.AuthDtos.MessageResponse;
import com.cloudbase.dto.PublicDtos.PlatformStatusResponse;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.AccountStatus;
import com.cloudbase.model.UserAccount;
import com.cloudbase.model.UserRole;

import java.util.List;

public interface AdminService {
    List<UserAccount> listUsers();

    UserAccount updateDeploymentAccess(UserEntity actor, String userId, boolean enabled);

    UserAccount updateAccountStatus(UserEntity actor, String userId, AccountStatus status);

    UserAccount updateRole(UserEntity actor, String userId, UserRole role);

    InfrastructureOverview infrastructureOverview();

    /** Public landing metrics (no auth, no secrets). */
    PlatformStatusResponse platformStatus();

    /** Admin-triggered password reset email for a user. */
    MessageResponse sendPasswordReset(UserEntity actor, String userId);

    List<AuditLogEntry> listAuditLogs();

    HostingSettingsResponse getHostingSettings();

    HostingSettingsResponse updateHostingSettings(UserEntity actor, HostingSettingsUpdateRequest request);
}
