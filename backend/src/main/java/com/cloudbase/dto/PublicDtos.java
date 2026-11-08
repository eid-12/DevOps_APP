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
    /**
     * Unauthenticated landing-page status. Only aggregate counts: no software versions, hardware or component
     * names, which would let anyone fingerprint the host and pick exploits. Admins get the details elsewhere.
     */
    public record PlatformStatusResponse(
            boolean online,
            int activeContainers,
            int totalContainers,
            int stacks,
            int images,
            int volumes
    ) {
    }
}
