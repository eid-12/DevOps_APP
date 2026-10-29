package com.cloudbase.service.impl;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.github.GitHubRepoClient;
import com.cloudbase.github.GitHubSecretEncryptor;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.service.PlatformSettingsService;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Tenant repositories are controlled by the tenant, so CloudBase must never write its own
 * registry credentials (or any other platform secret) into their Actions secrets.
 */
class CiBootstrapNoPlatformSecretsTest {

    @Test
    void bootstrapNeverWritesActionsSecretsEvenWhenAPlatformDockerHubTokenIsConfigured() {
        GitHubRepoClient repoClient = mock(GitHubRepoClient.class);
        PlatformSettingsService settings = mock(PlatformSettingsService.class);
        when(settings.get(PlatformSettingsService.DOCKERHUB_TOKEN)).thenReturn("platform-token-must-not-leak");
        when(settings.get(PlatformSettingsService.DOCKERHUB_USERNAME)).thenReturn("minipcer");
        when(settings.get(PlatformSettingsService.DOCKERHUB_NAMESPACE)).thenReturn("minipcer");
        when(settings.get(PlatformSettingsService.PUBLIC_API_URL)).thenReturn("https://api.example.test");
        when(repoClient.putTextFile(anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), anyBoolean()))
                .thenReturn(true);

        UserEntity owner = new UserEntity();
        owner.setId("u-1");
        owner.setGithubAccessToken("tenant-oauth-token");
        Map<String, Object> src = new HashMap<>();
        src.put("repositoryUrl", "https://github.com/tenant/app");
        src.put("branch", "main");
        src.put("runtime", "node");
        ServiceEntity service = ServiceEntity.builder()
                .id("svc-1").name("app").sourceType(ServiceSourceType.GITHUB).sourceDetails(src).build();

        new CiBootstrapServiceImpl(repoClient, new GitHubSecretEncryptor(), settings).bootstrapGitHubService(owner, service);

        verify(repoClient, never()).putActionsSecret(anyString(), anyString(), anyString(), anyString(), anyString(), any());
    }
}
