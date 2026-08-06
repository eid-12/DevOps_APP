package com.cloudbase.controller;

import com.cloudbase.dto.AuthDtos.AuthResponse;
import com.cloudbase.dto.AuthDtos.ConnectGitHubRequest;
import com.cloudbase.dto.AuthDtos.LoginRequest;
import com.cloudbase.dto.AuthDtos.RegisterRequest;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.UserAccount;
import com.cloudbase.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
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

    /** Legacy stub connect (username only). Prefer OAuth authorize. */
    @PostMapping("/github/connect")
    public UserAccount connectGitHub(
            @AuthenticationPrincipal UserEntity user,
            @Valid @RequestBody ConnectGitHubRequest request
    ) {
        return authService.connectGitHub(user, request);
    }

    /** Start real GitHub OAuth — returns authorize URL for the browser. */
    @GetMapping("/github/authorize")
    public Map<String, String> githubAuthorize(@AuthenticationPrincipal UserEntity user) {
        return Map.of("authorizeUrl", authService.beginGitHubOAuth(user));
    }

    /**
     * GitHub redirects here with ?code=&state=.
     * Public (permitAll) — CSRF protection is the signed state JWT.
     */
    @GetMapping("/github/callback")
    public ResponseEntity<Void> githubCallback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String error,
            @RequestParam(name = "error_description", required = false) String errorDescription
    ) {
        String redirectUrl;
        if (error != null && !error.isBlank()) {
            redirectUrl = authService.githubOAuthErrorRedirect(
                    errorDescription != null ? errorDescription : error
            );
        } else {
            redirectUrl = authService.completeGitHubOAuth(code, state);
        }
        return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create(redirectUrl))
                .build();
    }

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
