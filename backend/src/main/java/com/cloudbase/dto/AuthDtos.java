package com.cloudbase.dto;

import com.cloudbase.model.UserAccount;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

public final class AuthDtos {

    private AuthDtos() {
    }

    public record LoginRequest(
            @Email @NotBlank String email,
            @NotBlank String password
    ) {
    }

    public record RegisterRequest(
            @NotBlank String name,
            @Email @NotBlank String email,
            @NotBlank String password
    ) {
    }

    public record AuthResponse(
            String token,
            UserAccount user,
            String message,
            /** ISO-8601 absolute expiry of the access token; null when no token issued. */
            String expiresAt,
            /** Seconds until expiry at issue time; 0 when no token. */
            long expiresInSeconds
    ) {
        public AuthResponse(String token, UserAccount user, String message) {
            this(token, user, message, null, 0L);
        }
    }

    /**
     * Step 1 stub: username-only connect (matches Account page mock input).
     * Step 2 replaces this with GitHub OAuth callback exchange.
     */
    public record ConnectGitHubRequest(
            @NotBlank String username
    ) {
    }

    /** Frontend sends the OAuth ?code= here; secret stays on the server. */
    public record ExchangeGitHubCodeRequest(
            @NotBlank String code
    ) {
    }

    public record GitHubProfileResponse(
            String username,
            String displayName,
            String avatarUrl,
            java.util.List<String> scopes
    ) {
    }

    public record GitHubRepoResponse(
            String fullName,
            String name,
            String htmlUrl,
            boolean isPrivate,
            String defaultBranch
    ) {
    }

    public record ForgotPasswordRequest(
            @Email @NotBlank String email
    ) {
    }

    public record MessageResponse(String message) {
    }

    public record ResetPasswordRequest(
            @NotBlank String token,
            @NotBlank String password
    ) {
    }

    public record VerifyEmailRequest(
            @Email @NotBlank String email,
            @NotBlank String code
    ) {
    }

    public record ResendVerificationRequest(
            @Email @NotBlank String email
    ) {
    }

    public record UpdateProfileRequest(
            @NotBlank String name
    ) {
    }

    public record ChangePasswordRequest(
            @NotBlank String currentPassword,
            @NotBlank String newPassword
    ) {
    }

    public record NotificationPrefsRequest(
            boolean emailDeployments,
            boolean emailFailures,
            boolean emailWeeklyUsage
    ) {
    }
}
