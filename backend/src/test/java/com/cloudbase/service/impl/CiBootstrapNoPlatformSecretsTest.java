package com.cloudbase.service.impl;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.github.GitHubRepoClient;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.service.PlatformSettingsService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * Tenant repositories are controlled by the tenant, so CI provisioning must never put a CloudBase
 * credential there. Builds publish to the repository's own GHCR with the job's GITHUB_TOKEN.
 */
class CiBootstrapNoPlatformSecretsTest {

    private Map<String, Object> bootstrap(GitHubRepoClient repoClient, Map<String, Object> src) {
        PlatformSettingsService settings = mock(PlatformSettingsService.class);
        when(settings.get(PlatformSettingsService.DOCKERHUB_TOKEN)).thenReturn("platform-token-must-not-leak");
        when(settings.get(PlatformSettingsService.DOCKERHUB_USERNAME)).thenReturn("minipcer");
        when(settings.get(PlatformSettingsService.DOCKERHUB_NAMESPACE)).thenReturn("minipcer");
        when(settings.get(PlatformSettingsService.PUBLIC_API_URL)).thenReturn("https://api.example.test");
        when(settings.get(PlatformSettingsService.GITHUB_WEBHOOK_SECRET)).thenReturn("webhook-secret");
        when(repoClient.putTextFile(anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), anyBoolean()))
                .thenReturn(true);

        UserEntity owner = new UserEntity();
        owner.setId("u-1");
        owner.setGithubAccessToken("tenant-oauth-token");
        ServiceEntity service = ServiceEntity.builder()
                .id("svc-1").name("app").sourceType(ServiceSourceType.GITHUB).sourceDetails(src).build();
        return new CiBootstrapServiceImpl(repoClient, settings).bootstrapGitHubService(owner, service);
    }

    private static Map<String, Object> source() {
        Map<String, Object> src = new HashMap<>();
        src.put("repositoryUrl", "https://github.com/Tenant/My-App");
        src.put("branch", "main");
        src.put("runtime", "node");
        return src;
    }

    @Test
    void provisioningOnlyWritesFilesAndTheWebhookNeverSecrets() {
        GitHubRepoClient repoClient = mock(GitHubRepoClient.class);
        bootstrap(repoClient, source());

        verify(repoClient, atLeast(0)).fileExists(anyString(), anyString(), anyString(), anyString());
        verify(repoClient, atLeast(1)).putTextFile(anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), anyBoolean());
        verify(repoClient).ensureWebhook(anyString(), anyString(), anyString(), anyString(), anyString(), anyList());
        verifyNoMoreInteractions(repoClient);
    }

    @Test
    void workflowPublishesToTheRepositorysOwnGhcrWithItsScopedTokenOnly() {
        GitHubRepoClient repoClient = mock(GitHubRepoClient.class);
        bootstrap(repoClient, source());

        ArgumentCaptor<String> content = ArgumentCaptor.forClass(String.class);
        verify(repoClient).putTextFile(anyString(), anyString(), anyString(),
                eq(".github/workflows/cloudbase-deploy.yml"), content.capture(), anyString(), anyString(), anyBoolean());
        String workflow = content.getValue();

        assertTrue(workflow.contains("IMAGE_NAME: ghcr.io/tenant/my-app"), workflow);
        assertTrue(workflow.contains("registry: ghcr.io"));
        assertTrue(workflow.contains("packages: write"));
        assertFalse(workflow.toUpperCase().contains("DOCKERHUB"), "workflow must not reference Docker Hub credentials");
        Matcher m = Pattern.compile("secrets\\.([A-Za-z0-9_]+)").matcher(workflow);
        while (m.find()) {
            assertEquals("GITHUB_TOKEN", m.group(1), "only the job's own GITHUB_TOKEN may be referenced");
        }
        // Every action is pinned to a full commit SHA.
        for (String line : workflow.lines().filter(l -> l.trim().startsWith("uses:")).toList()) {
            assertTrue(line.matches(".*@[0-9a-f]{40}( .*)?"), line);
        }
    }

    @Test
    void imageIsDerivedFromTheRepositoryNotFromUserInput() {
        Map<String, Object> src = source();
        src.put("imageName", "ghcr.io/someone-else/their-private-app"); // attempt to point at another package
        Map<String, Object> result = bootstrap(mock(GitHubRepoClient.class), src);
        assertEquals("ghcr.io/tenant/my-app", result.get("imageName"));
        assertFalse(result.containsKey("ciSecretsConfigured"));
        assertTrue(List.of(true).contains(result.get("ciBootstrapped")));
    }
}
