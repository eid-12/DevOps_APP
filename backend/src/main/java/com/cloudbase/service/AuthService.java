package com.cloudbase.service;

import com.cloudbase.dto.AuthDtos.AuthResponse;
import com.cloudbase.dto.AuthDtos.ConnectGitHubRequest;
import com.cloudbase.dto.AuthDtos.LoginRequest;
import com.cloudbase.dto.AuthDtos.RegisterRequest;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.UserAccount;

public interface AuthService {
    AuthResponse login(LoginRequest request);
    AuthResponse register(RegisterRequest request);
    UserAccount resolveUser(String token);
    UserEntity resolveEntity(String token);
    UserAccount resolveUserFromId(String userId);

    /** Persist GitHub connection on the authenticated user (Step 1 stub - keep for tests). */
    UserAccount connectGitHub(UserEntity user, ConnectGitHubRequest request);

    /** Clear GitHub fields on the authenticated user. */
    UserAccount disconnectGitHub(UserEntity user);

    /** Build GitHub authorize URL for the logged-in CloudBase user. */
    String beginGitHubOAuth(UserEntity user);

    /**
     * Handle GitHub redirect: validate state, exchange code, persist token + profile.
     * @return frontend redirect URL
     */
    String completeGitHubOAuth(String code, String state);

    /** Frontend redirect when GitHub itself returns error=access_denied etc. */
    String githubOAuthErrorRedirect(String reason);

    /**
     * Exchange authorization code for profile, persist token + GitHub fields on the user.
     */
    com.cloudbase.dto.AuthDtos.GitHubProfileResponse exchangeGitHubCode(UserEntity user, String code);

    /** List repositories accessible with the user's stored GitHub token. */
    java.util.List<com.cloudbase.dto.AuthDtos.GitHubRepoResponse> listGitHubRepos(UserEntity user);

    /** Send password-reset email (always returns a generic success message). */
    com.cloudbase.dto.AuthDtos.MessageResponse forgotPassword(String email);

    /** Apply a new password using a reset token from email. */
    com.cloudbase.dto.AuthDtos.MessageResponse resetPassword(String token, String newPassword);

    /** Confirm signup with the 6-digit code emailed to the user. */
    com.cloudbase.dto.AuthDtos.MessageResponse verifyEmail(String email, String code);

    /** Send a fresh verification code (if the account is still unverified). */
    com.cloudbase.dto.AuthDtos.MessageResponse resendVerificationCode(String email);

    /** Free plan ceilings (same for all non-admin users today). */
    java.util.Map<String, Object> getPlan();

    /** Current resource usage for the authenticated user. */
    java.util.Map<String, Object> getUsage(UserEntity user);

    /** Update display name (email stays fixed). */
    UserAccount updateProfile(UserEntity user, String name);

    /** Change password after verifying the current one. */
    com.cloudbase.dto.AuthDtos.MessageResponse changePassword(
            UserEntity user,
            String currentPassword,
            String newPassword
    );

    /** Persist onboarding dismissed flag. */
    UserAccount dismissOnboarding(UserEntity user);

    /** Update email notification preferences. */
    UserAccount updateNotificationPrefs(
            UserEntity user,
            boolean emailDeployments,
            boolean emailFailures,
            boolean emailWeeklyUsage
    );
}
