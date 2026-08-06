package com.cloudbase.github;

import com.cloudbase.dto.AuthDtos.GitHubProfileResponse;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * Orchestrates: authorization code → access token → GitHub user profile.
 */
@Service
public class GitHubOAuthService {

    private final GitHubOAuthClient client;

    public GitHubOAuthService(GitHubOAuthClient client) {
        this.client = client;
    }

    public GitHubProfileResponse exchangeCodeForProfile(String code) {
        if (!StringUtils.hasText(code)) {
            throw GitHubOAuthException.badRequest("missing_code", "Authorization code is required");
        }
        if (!client.isConfigured()) {
            throw GitHubOAuthException.notConfigured();
        }

        GitHubOAuthClient.TokenResponse token = client.exchangeCode(code.trim());
        GitHubOAuthClient.GitHubUser user = client.fetchUser(token.accessToken());

        return new GitHubProfileResponse(
                user.login(),
                user.name(),
                user.avatarUrl(),
                client.parseScopes(token.scope())
        );
    }

    /** Same as above, but also returns the raw token for persistence. */
    public ExchangeResult exchangeCodeFull(String code) {
        if (!StringUtils.hasText(code)) {
            throw GitHubOAuthException.badRequest("missing_code", "Authorization code is required");
        }
        if (!client.isConfigured()) {
            throw GitHubOAuthException.notConfigured();
        }

        GitHubOAuthClient.TokenResponse token = client.exchangeCode(code.trim());
        GitHubOAuthClient.GitHubUser user = client.fetchUser(token.accessToken());
        return new ExchangeResult(token, user);
    }

    public record ExchangeResult(
            GitHubOAuthClient.TokenResponse token,
            GitHubOAuthClient.GitHubUser user
    ) {
    }
}
