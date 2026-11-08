package com.cloudbase.controller;

import com.cloudbase.dto.AuthDtos.AuthResponse;
import com.cloudbase.dto.AuthDtos.LoginRequest;
import com.cloudbase.dto.AuthDtos.RegisterRequest;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.UserAccount;
import com.cloudbase.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request);
    }

    @PostMapping("/register")
    public AuthResponse register(@Valid @RequestBody RegisterRequest request) {
        return authService.register(request);
    }

    @PostMapping("/forgot-password")
    public com.cloudbase.dto.AuthDtos.MessageResponse forgotPassword(
            @Valid @RequestBody com.cloudbase.dto.AuthDtos.ForgotPasswordRequest request
    ) {
        return authService.forgotPassword(request.email());
    }

    @PostMapping("/reset-password")
    public com.cloudbase.dto.AuthDtos.MessageResponse resetPassword(
            @Valid @RequestBody com.cloudbase.dto.AuthDtos.ResetPasswordRequest request
    ) {
        return authService.resetPassword(request.token(), request.password());
    }

    @PostMapping("/verify-email")
    public com.cloudbase.dto.AuthDtos.MessageResponse verifyEmail(
            @Valid @RequestBody com.cloudbase.dto.AuthDtos.VerifyEmailRequest request
    ) {
        return authService.verifyEmail(request.email(), request.code());
    }

    @PostMapping("/resend-verification")
    public com.cloudbase.dto.AuthDtos.MessageResponse resendVerification(
            @Valid @RequestBody com.cloudbase.dto.AuthDtos.ResendVerificationRequest request
    ) {
        return authService.resendVerificationCode(request.email());
    }

    @GetMapping("/me")
    public UserAccount me(@AuthenticationPrincipal UserEntity user) {
        return authService.resolveUserFromId(user.getId());
    }

    @GetMapping("/plan")
    public Map<String, Object> plan(@AuthenticationPrincipal UserEntity user) {
        return authService.getPlan();
    }

    @GetMapping("/usage")
    public Map<String, Object> usage(@AuthenticationPrincipal UserEntity user) {
        return authService.getUsage(user);
    }

    @PutMapping("/profile")
    public UserAccount updateProfile(
            @AuthenticationPrincipal UserEntity user,
            @Valid @RequestBody com.cloudbase.dto.AuthDtos.UpdateProfileRequest request
    ) {
        return authService.updateProfile(user, request.name());
    }

    @PostMapping("/change-password")
    public com.cloudbase.dto.AuthDtos.AuthResponse changePassword(
            @AuthenticationPrincipal UserEntity user,
            @Valid @RequestBody com.cloudbase.dto.AuthDtos.ChangePasswordRequest request
    ) {
        return authService.changePassword(user, request.currentPassword(), request.newPassword());
    }

    @PostMapping("/onboarding/dismiss")
    public UserAccount dismissOnboarding(@AuthenticationPrincipal UserEntity user) {
        return authService.dismissOnboarding(user);
    }

    @PutMapping("/notifications")
    public UserAccount updateNotifications(
            @AuthenticationPrincipal UserEntity user,
            @RequestBody com.cloudbase.dto.AuthDtos.NotificationPrefsRequest request
    ) {
        return authService.updateNotificationPrefs(
                user,
                request.emailDeployments(),
                request.emailFailures(),
                request.emailWeeklyUsage()
        );
    }

    // GitHub is linked only through POST /github/exchange: the SPA checks the OAuth state against the browser that
    // started the flow, and the code is stored on the signed-in caller. There is deliberately no unauthenticated
    // callback here: one would link whichever browser followed the link to whoever generated the state.

    @DeleteMapping("/github")
    public UserAccount disconnectGitHub(@AuthenticationPrincipal UserEntity user) {
        return authService.disconnectGitHub(user);
    }

    /**
     * Frontend OAuth code exchange (requires CloudBase JWT).
     * POST /api/auth/github/exchange  { "code": "<authorization_code>" }
     * Exchanges code at GitHub, persists token + profile on the logged-in user.
     */
    @PostMapping("/github/exchange")
    public com.cloudbase.dto.AuthDtos.GitHubProfileResponse exchangeGitHubCode(
            @AuthenticationPrincipal UserEntity user,
            @Valid @RequestBody com.cloudbase.dto.AuthDtos.ExchangeGitHubCodeRequest request
    ) {
        return authService.exchangeGitHubCode(user, request.code());
    }

    /** Repositories for the connected GitHub account (uses stored access token). */
    @GetMapping("/github/repos")
    public java.util.List<com.cloudbase.dto.AuthDtos.GitHubRepoResponse> listGitHubRepos(
            @AuthenticationPrincipal UserEntity user
    ) {
        return authService.listGitHubRepos(user);
    }
}
