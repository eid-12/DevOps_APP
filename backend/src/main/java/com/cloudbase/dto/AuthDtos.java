package com.cloudbase.dto;

import com.cloudbase.model.UserAccount;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class AuthDtos {

    private AuthDtos() {
    }

    public record LoginRequest(
            @Email @NotBlank @Size(max = 254) String email,
            @NotBlank @Size(max = 1024) String password
    ) {
    }

    public record RegisterRequest(
            @NotBlank @Size(max = 120) String name,
            @Email @NotBlank @Size(max = 254) String email,
            @NotBlank @Size(max = 1024) String password
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
