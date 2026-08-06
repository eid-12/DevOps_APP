package com.cloudbase.github;

import org.springframework.http.HttpStatus;

/**
 * Typed GitHub OAuth failure so controllers can return clear 4xx/502 bodies
 * instead of a generic 500.
 */
public class GitHubOAuthException extends RuntimeException {

    private final HttpStatus status;
    private final String errorCode;

    public GitHubOAuthException(HttpStatus status, String errorCode, String message) {
        super(message);
        this.status = status;
        this.errorCode = errorCode;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getErrorCode() {
        return errorCode;
    }

    public static GitHubOAuthException notConfigured() {
        return new GitHubOAuthException(
                HttpStatus.SERVICE_UNAVAILABLE,
                "github_oauth_not_configured",
                "GitHub OAuth is not configured. Set github.oauth.client-id and github.oauth.client-secret."
        );
    }

    public static GitHubOAuthException badRequest(String errorCode, String message) {
        return new GitHubOAuthException(HttpStatus.BAD_REQUEST, errorCode, message);
    }

    public static GitHubOAuthException unauthorized(String errorCode, String message) {
        return new GitHubOAuthException(HttpStatus.UNAUTHORIZED, errorCode, message);
    }

    public static GitHubOAuthException badGateway(String errorCode, String message) {
        return new GitHubOAuthException(HttpStatus.BAD_GATEWAY, errorCode, message);
    }
}
