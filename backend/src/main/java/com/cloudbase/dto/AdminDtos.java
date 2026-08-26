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
            int totalContainers,
            int stacks,
            int images,
            int volumes,
            int healthyContainers,
            int unhealthyContainers,
            Integer endpointId,
            String endpointName,
            String hostCpuUsage,
            String hostRamUsage,
            String dockerVersion,
            String error
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

    /** Secrets are never echoed; blank secret fields on update mean "keep current". */
    public record HostingSettingsResponse(
            String portainerUrl,
            boolean portainerApiKeyConfigured,
            String portainerApiKeyHint,
            String portainerEndpointId,
            boolean npmEnabled,
            String npmUrl,
            String npmEmail,
            boolean npmPasswordConfigured,
            String npmPasswordHint,
            String npmCertificateId,
            boolean npmSslForced,
            String githubClientId,
            boolean githubClientSecretConfigured,
            String githubClientSecretHint,
            String githubRedirectUri,
            String githubScopes,
            boolean githubWebhookSecretConfigured,
            String githubWebhookSecretHint,
            String dockerHubUsername,
            boolean dockerHubTokenConfigured,
            String dockerHubTokenHint,
            String dockerHubNamespace,
            String baseDomain,
            String publicApiUrl,
            String dockerNetwork,
            String volumeRoot
    ) {
    }

    public record HostingSettingsUpdateRequest(
            String portainerUrl,
            String portainerApiKey,
            String portainerEndpointId,
            Boolean npmEnabled,
            String npmUrl,
            String npmEmail,
            String npmPassword,
            String npmCertificateId,
            Boolean npmSslForced,
            String githubClientId,
            String githubClientSecret,
            String githubRedirectUri,
            String githubScopes,
            String githubWebhookSecret,
            String dockerHubUsername,
            String dockerHubToken,
            String dockerHubNamespace,
            String baseDomain,
            String publicApiUrl,
            String dockerNetwork,
            String volumeRoot
    ) {
    }
}
