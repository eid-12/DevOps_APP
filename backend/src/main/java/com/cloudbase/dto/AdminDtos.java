package com.cloudbase.dto;

import com.cloudbase.model.AccountStatus;
import com.cloudbase.model.UserRole;

public final class AdminDtos {

    private AdminDtos() {
    }

    public record DeploymentAccessRequest(boolean enabled) {
    }

    public record AccountStatusRequest(AccountStatus accountStatus) {
    }

    public record RoleChangeRequest(UserRole role) {
    }

    public record InfrastructureOverview(
            String portainerStatus,
            String nginxProxyManagerStatus,
            String cloudflareTunnelStatus,
            int activeContainers,
            String hostCpuUsage,
            String hostRamUsage
    ) {
    }

    public record AuditLogEntry(
            String id,
            String timestamp,
            String actorName,
            String actorEmail,
            String action,
            String target,
            String details
    ) {
    }
}
