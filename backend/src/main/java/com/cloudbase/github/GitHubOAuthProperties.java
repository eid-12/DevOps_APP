package com.cloudbase.github;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Binds github.oauth.* from application.yml / env vars.
 */
@ConfigurationProperties(prefix = "github.oauth")
public record GitHubOAuthProperties(
        String clientId,
        String clientSecret,
        String redirectUri,
        String scopes,
        String successRedirect,
        String failureRedirect
) {
    public GitHubOAuthProperties {
        if (clientId == null) clientId = "";
        if (clientSecret == null) clientSecret = "";
        if (redirectUri == null || redirectUri.isBlank()) {
            redirectUri = "http://localhost:4200/auth/github/callback";
        }
        if (scopes == null || scopes.isBlank()) {
            scopes = "read:user repo user:email";
        }
        if (successRedirect == null || successRedirect.isBlank()) {
            successRedirect = "http://localhost:4200/account?github=connected";
        }
        if (failureRedirect == null || failureRedirect.isBlank()) {
            failureRedirect = "http://localhost:4200/account?github=error";
        }
    }
}
