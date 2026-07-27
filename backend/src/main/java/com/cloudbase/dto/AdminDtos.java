package com.cloudbase.dto;

public final class AdminDtos {

    private AdminDtos() {
    }

    public record DeploymentAccessRequest(boolean enabled) {
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
}
