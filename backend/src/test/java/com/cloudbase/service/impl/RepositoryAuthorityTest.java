package com.cloudbase.service.impl;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.github.GitHubRepoClient;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.service.PlatformSettingsService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * A GitHub service may bind only a repository its owner can push to. Someone else's repository is refused before
 * anything is written to it; a repository shared with the owner as a write collaborator keeps working.
 */
class RepositoryAuthorityTest {

    private static GitHubRepoClient githubSaying(int status, String body) {
        WebClient.Builder builder = WebClient.builder().exchangeFunction(req -> Mono.just(
                ClientResponse.create(HttpStatus.valueOf(status)).header("Content-Type", "application/json").body(body).build()));
        return new GitHubRepoClient(builder);
    }

    @Test
    void githubPermissionsDecidePushAccess() {
        assertTrue(githubSaying(200, "{\"permissions\":{\"admin\":false,\"push\":true,\"pull\":true}}")
                .canPush("t", "victim", "repo"), "write collaborator");
        assertFalse(githubSaying(200, "{\"permissions\":{\"admin\":false,\"push\":false,\"pull\":true}}")
                .canPush("t", "victim", "repo"), "public repository, read only");
        assertFalse(githubSaying(200, "{\"name\":\"repo\"}").canPush("t", "victim", "repo"), "permissions withheld");
        assertFalse(githubSaying(404, "{}").canPush("t", "victim", "private"), "private repository not visible");
    }

    private static UserEntity owner() {
        UserEntity u = new UserEntity();
        u.setId("u-attacker");
        u.setGithubAccessToken("attacker-token");
        return u;
    }

    private static CiBootstrapServiceImpl service(GitHubRepoClient repo) {
        PlatformSettingsService settings = mock(PlatformSettingsService.class);
        when(settings.get(PlatformSettingsService.PUBLIC_API_URL)).thenReturn("https://api.example.test");
        when(settings.get(PlatformSettingsService.GITHUB_WEBHOOK_SECRET)).thenReturn("synthetic");
        return new CiBootstrapServiceImpl(repo, settings);
    }

    private static ServiceEntity githubService(String repoUrl) {
        Map<String, Object> src = new HashMap<>();
        src.put("repositoryUrl", repoUrl);
        return ServiceEntity.builder().id("svc-1").name("app").sourceType(ServiceSourceType.GITHUB).sourceDetails(src).build();
    }

    @Test
    void someoneElsesRepositoryIsRefusedBeforeAnyWrite() {
        GitHubRepoClient repo = mock(GitHubRepoClient.class);
        when(repo.canPush("attacker-token", "victim", "app")).thenReturn(false);

        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> service(repo).assertCanPush(owner(), "https://github.com/victim/app"));
        assertEquals(403, e.getStatusCode().value());

        Map<String, Object> result = service(repo).bootstrapGitHubService(owner(), githubService("https://github.com/victim/app"));
        assertEquals(false, result.get(CiBootstrapServiceImpl.REPO_ACCESS_VERIFIED));
        assertEquals(false, result.get("ciBootstrapped"));
        assertTrue(String.valueOf(result.get("ciMessage")).contains("cannot push to victim/app"));
        verify(repo, org.mockito.Mockito.times(2)).canPush("attacker-token", "victim", "app");
        verifyNoMoreInteractions(repo); // no file, workflow or webhook call
    }

    @Test
    void aSharedRepositoryWithWriteAccessIsProvisioned() {
        GitHubRepoClient repo = mock(GitHubRepoClient.class);
        when(repo.canPush("attacker-token", "teammate", "shared-app")).thenReturn(true);
        when(repo.putTextFile(anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), anyBoolean()))
                .thenReturn(true);

        assertDoesNotThrow(() -> service(repo).assertCanPush(owner(), "https://github.com/teammate/shared-app"));
        Map<String, Object> result = service(repo).bootstrapGitHubService(owner(), githubService("https://github.com/teammate/shared-app"));
        assertEquals(true, result.get(CiBootstrapServiceImpl.REPO_ACCESS_VERIFIED));
        assertEquals(true, result.get("ciBootstrapped"));
    }

    @Test
    void anOwnerWithoutGitHubCannotBindARepository() {
        UserEntity noGitHub = new UserEntity();
        noGitHub.setId("u-2");
        assertEquals(403, assertThrows(ResponseStatusException.class,
                () -> service(mock(GitHubRepoClient.class)).assertCanPush(noGitHub, "https://github.com/a/b")).getStatusCode().value());
    }
}
