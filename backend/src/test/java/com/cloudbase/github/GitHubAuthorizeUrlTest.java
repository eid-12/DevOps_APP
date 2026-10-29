package com.cloudbase.github;

import com.cloudbase.service.PlatformSettingsService;
import org.junit.jupiter.api.Test;
import org.springframework.web.reactive.function.client.WebClient;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class GitHubAuthorizeUrlTest {
    @Test
    void encodesSpaceSeparatedScopesAndPreservesStateAndCallback() {
        var settings = mock(PlatformSettingsService.class);
        var props = new GitHubOAuthProperties("client", "secret",
                "https://www.example.test/auth/github/callback", null, null, null);
        var client = new GitHubOAuthClient(WebClient.builder(), props, settings);
        URI url = URI.create(client.buildAuthorizeUrl("state-safe_123"));
        assertEquals("github.com", url.getHost());
        String decoded = URLDecoder.decode(url.getRawQuery(), StandardCharsets.UTF_8);
        assertTrue(decoded.contains("scope=read:user repo user:email workflow read:packages"));
        assertTrue(decoded.contains("redirect_uri=https://www.example.test/auth/github/callback"));
        assertTrue(decoded.contains("state=state-safe_123"));
    }

    @Test
    void retainsExplicitAdministratorScopeOverride() {
        var settings = mock(PlatformSettingsService.class);
        when(settings.hasOverride(PlatformSettingsService.GITHUB_SCOPES)).thenReturn(true);
        when(settings.get(PlatformSettingsService.GITHUB_SCOPES)).thenReturn("read:user");
        var props = new GitHubOAuthProperties("client", "secret", null, null, null, null);
        assertEquals("read:user", new GitHubOAuthClient(WebClient.builder(), props, settings).scopes());
    }
}
