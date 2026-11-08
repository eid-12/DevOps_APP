package com.cloudbase.dto;

import com.cloudbase.model.DatabaseType;
import com.cloudbase.model.EnvironmentVariable;
import com.cloudbase.model.ResourceQuota;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.model.VolumeMount;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.Map;

public final class ProjectDtos {

    private ProjectDtos() {
    }

    /** Upper bounds on tenant-supplied text, so one account cannot store or echo back unbounded payloads. */
    public static final int MAX_NAME = 100;
    public static final int MAX_DESCRIPTION = 2000;
    public static final int MAX_ENV_VARS = 200;
    public static final int MAX_ENV_VALUE = 32_768;

    public record CreateProjectRequest(
            @NotBlank @Size(max = MAX_NAME) String name,
            @Size(max = MAX_DESCRIPTION) String description
    ) {
    }

    public record CreateServiceRequest(
            @NotBlank @Size(max = MAX_NAME) String name,
            @NotNull ServiceSourceType sourceType,
            @NotNull @Size(max = 50) Map<String, Object> sourceDetails,
            @Size(max = MAX_ENV_VARS) List<EnvironmentVariable> envVars,
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
            @NotNull @Size(max = MAX_ENV_VARS) List<EnvironmentVariable> envVars
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
            @NotBlank @Size(max = 4096) String command
    ) {
    }

    public record UpsertSharedVariableRequest(
            String id,
            @NotBlank @Size(max = 128) String key,
            @Size(max = MAX_ENV_VALUE) String value,
            boolean isSecret,
            @Size(max = 100) List<String> serviceIds
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
