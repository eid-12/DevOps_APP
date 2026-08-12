package com.cloudbase.dto;

import com.cloudbase.model.DatabaseType;
import com.cloudbase.model.EnvironmentVariable;
import com.cloudbase.model.ResourceQuota;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.model.VolumeMount;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.Map;

public final class ProjectDtos {

    private ProjectDtos() {
    }

    public record CreateProjectRequest(
            @NotBlank String name,
            String description
    ) {
    }

    public record CreateServiceRequest(
            @NotBlank String name,
            @NotNull ServiceSourceType sourceType,
            @NotNull Map<String, Object> sourceDetails,
            List<EnvironmentVariable> envVars,
            VolumeMount volume,
            ResourceQuota quota
    ) {
    }

    public record GitHubSourceDetails(
            @NotBlank String repositoryUrl,
            @NotBlank String branch,
            boolean autoDeploy
    ) {
    }

    public record DockerSourceDetails(
            @NotBlank String imageName,
            String imageTag,
            String registryUrl
    ) {
    }

    public record DatabaseSourceDetails(
            @NotNull DatabaseType dbType,
            @NotBlank String serviceName
    ) {
    }

    public record DeployServiceRequest(
            String commitSha,
            String imageTag
    ) {
    }

    public record UpdateEnvVarsRequest(
            @NotNull List<EnvironmentVariable> envVars
    ) {
    }

    public record SetSubdomainRequest(
            @NotBlank String subdomain
    ) {
    }

    /** Bring-your-own hostname (not *.baseDomain). Pass empty string to clear. */
    public record SetCustomDomainRequest(
            String domain
    ) {
    }

    public record SetVanitySubdomainRequest(
            @NotBlank String slug
    ) {
    }

    /** Account vanity slot status for the Network UI. */
    public record VanityStatusResponse(
            String baseDomain,
            int limitPerAccount,
            String claimedSlug,
            String claimedFqdn,
            String claimedServiceId,
            boolean thisServiceHoldsVanity
    ) {
    }

    /** Pre-save availability check for a custom hostname. */
    public record DomainCheckResponse(
            String domain,
            boolean available,
            String reason
    ) {
    }

    public record ExecRequest(
            @NotBlank String command
    ) {
    }

    public record UpsertSharedVariableRequest(
            String id,
            @NotBlank String key,
            String value,
            boolean isSecret,
            List<String> serviceIds
    ) {
    }

    public record UpdateProjectRequest(
            String name,
            String description,
            com.cloudbase.model.ProjectStatus status
    ) {
    }

    public record UpdateServiceRequest(
            String name,
            Map<String, Object> sourceDetails,
            String runtime,
            ResourceQuota quota,
            VolumeMount volume,
            Boolean removeVolume
    ) {
    }
}
