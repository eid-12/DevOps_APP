package com.cloudbase.dto;

public final class PublicDtos {

    private PublicDtos() {
    }

    /** Public SPA bootstrap (no secrets). GitHub client ID is designed to be public. */
    public record AppConfigResponse(
            String githubClientId,
            String githubRedirectUri,
            String githubScopes,
            boolean githubConfigured,
            boolean emailEnabled
    ) {
    }

    /** Safe host metrics for the public landing page (no secrets). */
    public record PlatformStatusResponse(
            boolean online,
            String portainerStatus,
            String npmStatus,
            String tunnelStatus,
            int activeContainers,
            int totalContainers,
            int stacks,
            int images,
            int volumes,
            String hostCpu,
            String hostRam,
            String dockerVersion
    ) {
    }
}
