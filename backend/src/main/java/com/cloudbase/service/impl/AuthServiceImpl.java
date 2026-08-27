package com.cloudbase.service.impl;

import com.cloudbase.dto.AuthDtos.AuthResponse;
import com.cloudbase.dto.AuthDtos.ConnectGitHubRequest;
import com.cloudbase.dto.AuthDtos.LoginRequest;
import com.cloudbase.dto.AuthDtos.MessageResponse;
import com.cloudbase.dto.AuthDtos.RegisterRequest;
import com.cloudbase.email.EmailRateLimiter;
import com.cloudbase.email.EmailService;
import com.cloudbase.email.ResendProperties;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.github.GitHubOAuthClient;
import com.cloudbase.github.GitHubOAuthProperties;
import com.cloudbase.github.GitHubOAuthService;
import com.cloudbase.model.AccountStatus;
import com.cloudbase.model.GitHubConnection;
import com.cloudbase.model.UserAccount;
import com.cloudbase.model.UserRole;
import com.cloudbase.repository.UserRepository;
import com.cloudbase.security.JwtService;
import com.cloudbase.service.AuthService;
import com.cloudbase.service.PlanQuotaService;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriComponentsBuilder;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class AuthServiceImpl implements AuthService {

    private static final List<String> STEP1_SCOPES = List.of("read:user", "repo", "user:email", "workflow");
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final int CODE_TTL_MINUTES = 15;

    private final UserRepository userRepository;
    private final JwtService jwtService;
    private final PasswordEncoder passwordEncoder;
    private final GitHubOAuthClient gitHubOAuthClient;
    private final GitHubOAuthService gitHubOAuthService;
    private final EmailService emailService;
    private final EmailRateLimiter emailRateLimiter;
    private final ResendProperties resendProperties;
    private final PlanQuotaService planQuotaService;
    private final String oauthSuccessRedirect;
    private final String oauthFailureRedirect;

    public AuthServiceImpl(
            UserRepository userRepository,
            JwtService jwtService,
            PasswordEncoder passwordEncoder,
            GitHubOAuthClient gitHubOAuthClient,
            GitHubOAuthService gitHubOAuthService,
            GitHubOAuthProperties gitHubOAuthProperties,
            EmailService emailService,
            EmailRateLimiter emailRateLimiter,
            ResendProperties resendProperties,
            PlanQuotaService planQuotaService
    ) {
        this.userRepository = userRepository;
        this.jwtService = jwtService;
        this.passwordEncoder = passwordEncoder;
        this.gitHubOAuthClient = gitHubOAuthClient;
        this.gitHubOAuthService = gitHubOAuthService;
        this.emailService = emailService;
        this.emailRateLimiter = emailRateLimiter;
        this.resendProperties = resendProperties;
        this.planQuotaService = planQuotaService;
        this.oauthSuccessRedirect = gitHubOAuthProperties.successRedirect();
        this.oauthFailureRedirect = gitHubOAuthProperties.failureRedirect();
    }

    @Override
    public AuthResponse login(LoginRequest request) {
        UserEntity user = userRepository.findByEmail(request.email())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password"));

        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password");
        }

        if (!user.isEmailVerified()) {
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN,
                    "Email not verified. Enter the 6-digit code we sent, or request a new one."
            );
        }
        if (user.getAccountStatus() == AccountStatus.SUSPENDED) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account has been suspended. Contact an administrator.");
        }

        String token = jwtService.generateToken(user.getId(), user.getRole().name());
        var exp = jwtService.getExpiration(token);
        return new AuthResponse(
                token,
                toModel(user),
                "Login successful",
                exp.toInstant().toString(),
                jwtService.getExpiresInSeconds()
        );
    }

    @Override
    public AuthResponse register(RegisterRequest request) {
        if (userRepository.existsByEmail(request.email())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Email already registered");
        }

        if (emailService.isEnabled()) {
            emailRateLimiter.acquireSend(EmailRateLimiter.Action.VERIFICATION, request.email());
        }

        String code = generateVerificationCode();
        UserEntity user = UserEntity.builder()
                .id("u-" + UUID.randomUUID().toString().substring(0, 8))
                .name(request.name())
                .email(request.email())
                .passwordHash(passwordEncoder.encode(request.password()))
                .role(UserRole.USER)
                .accountStatus(AccountStatus.PENDING_ACTIVATION)
                .deploymentEnabled(false)
                .emailVerified(false)
                .emailVerificationCode(code)
                .emailVerificationExpiresAt(Instant.now().plus(CODE_TTL_MINUTES, ChronoUnit.MINUTES))
                .build();

        if (!emailService.isEnabled()) {
            user.setEmailVerified(true);
            user.setAccountStatus(AccountStatus.ACTIVE);
            user.setEmailVerificationCode(null);
            user.setEmailVerificationExpiresAt(null);
            userRepository.save(user);
            String token = jwtService.generateToken(user.getId(), user.getRole().name());
            var exp = jwtService.getExpiration(token);
            return new AuthResponse(
                    token,
                    toModel(user),
                    "Account created. An admin must enable Deploy before you ship apps.",
                    exp.toInstant().toString(),
                    jwtService.getExpiresInSeconds()
            );
        }

        userRepository.save(user);
        emailService.sendEmailVerificationCode(user.getEmail(), user.getName(), code);
        return new AuthResponse(
                null,
                toModel(user),
                "We sent a 6-digit verification code to your email. Enter it to confirm your address."
        );
    }

    @Override
    public MessageResponse verifyEmail(String email, String code) {
        emailRateLimiter.checkVerifyAllowed(email);

        UserEntity user = userRepository.findByEmail(email)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid email or code"));

        if (user.isEmailVerified()) {
            return new MessageResponse("Email already verified. You can sign in - deployment stays locked until an admin enables it.");
        }

        if (user.getEmailVerificationCode() == null
                || user.getEmailVerificationExpiresAt() == null
                || Instant.now().isAfter(user.getEmailVerificationExpiresAt())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Code expired. Request a new verification code.");
        }

        if (!user.getEmailVerificationCode().equals(code.trim())) {
            boolean locked = emailRateLimiter.recordVerifyFailure(email);
            if (locked) {
                user.setEmailVerificationCode(null);
                user.setEmailVerificationExpiresAt(null);
                userRepository.save(user);
                throw new ResponseStatusException(
                        HttpStatus.TOO_MANY_REQUESTS,
                        "Too many wrong codes. Request a new verification code."
                );
            }
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid verification code");
        }

        emailRateLimiter.clearVerifyFailures(email);
        user.setEmailVerified(true);
        user.setEmailVerificationCode(null);
        user.setEmailVerificationExpiresAt(null);
        // Can sign in immediately; admin must still enable deployment.
        user.setAccountStatus(AccountStatus.ACTIVE);
        user.setDeploymentEnabled(false);
        userRepository.save(user);

        emailService.sendRegistrationPending(user.getEmail(), user.getName());
        emailService.notifyAdminNewRegistration(user.getName(), user.getEmail());

        return new MessageResponse("Email verified. You can sign in now. Deployment stays disabled until an admin enables it.");
    }

    @Override
    public MessageResponse resendVerificationCode(String email) {
        if (!emailService.isEnabled()) {
            throw new ResponseStatusException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "Email delivery is not configured. Ask an administrator to verify your account."
            );
        }
        UserEntity user = userRepository.findByEmail(email)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "If the account exists, a code will be sent."));

        if (user.isEmailVerified()) {
            return new MessageResponse("Email already verified.");
        }

        emailRateLimiter.acquireSend(EmailRateLimiter.Action.VERIFICATION, user.getEmail());
        String code = generateVerificationCode();
        user.setEmailVerificationCode(code);
        user.setEmailVerificationExpiresAt(Instant.now().plus(CODE_TTL_MINUTES, ChronoUnit.MINUTES));
        userRepository.save(user);
        emailService.sendEmailVerificationCode(user.getEmail(), user.getName(), code);
        emailRateLimiter.clearVerifyFailures(user.getEmail());
        return new MessageResponse("A new verification code was sent to your email.");
    }

    @Override
    public MessageResponse forgotPassword(String email) {
        if (!emailService.isEnabled()) {
            throw new ResponseStatusException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "Email delivery is not configured. Ask an administrator to reset your password."
            );
        }
        String generic = "If an account exists for that email, a reset link has been sent.";
        java.util.Optional<UserEntity> found = userRepository.findByEmail(email);
        if (found.isEmpty()) {
            emailRateLimiter.noteUnknownInbox(EmailRateLimiter.Action.PASSWORD_RESET, email);
            return new MessageResponse(generic);
        }
        UserEntity user = found.get();
        emailRateLimiter.acquireSend(EmailRateLimiter.Action.PASSWORD_RESET, user.getEmail());
        String token = jwtService.generatePasswordResetToken(user.getId());
        String resetUrl = UriComponentsBuilder
                .fromUriString(resendProperties.appBaseUrl())
                .path("/auth")
                .queryParam("mode", "reset")
                .queryParam("token", token)
                .build()
                .toUriString();
        emailService.sendPasswordReset(user.getEmail(), user.getName(), resetUrl);
        return new MessageResponse(generic);
    }

    @Override
    public MessageResponse resetPassword(String token, String newPassword) {
        if (newPassword == null || newPassword.length() < 6) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Password must be at least 6 characters");
        }
        final String userId;
        try {
            userId = jwtService.parsePasswordResetUserId(token);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid or expired reset token");
        }
        UserEntity user = userRepository.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid or expired reset token"));
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        userRepository.save(user);
        return new MessageResponse("Password updated. You can sign in now.");
    }

    @Override
    public UserAccount resolveUser(String token) {
        return toModel(resolveEntity(token));
    }

    @Override
    public UserEntity resolveEntity(String token) {
        if (token == null || !jwtService.isTokenValid(token)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Missing or invalid token");
        }
        String userId = jwtService.extractUserId(token);
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));
    }

    @Override
    public UserAccount resolveUserFromId(String userId) {
        UserEntity user = userRepository.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));
        return toModel(user);
    }

    @Override
    public UserAccount connectGitHub(UserEntity user, ConnectGitHubRequest request) {
        String username = request.username().trim().replace("@", "");
        if (username.isBlank() || !username.matches("^[A-Za-z0-9-]{1,39}$")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid GitHub username");
        }

        UserEntity managed = userRepository.findById(user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));

        managed.setGithubUsername(username);
        managed.setGithubAvatarUrl("https://github.com/" + username + ".png");
        managed.setGithubConnectedAt(Instant.now());
        managed.setGithubScopes(String.join(",", STEP1_SCOPES));
        // Token stays null until OAuth (Step 2)
        managed.setGithubAccessToken(null);

        return toModel(userRepository.save(managed));
    }

    @Override
    public UserAccount disconnectGitHub(UserEntity user) {
        UserEntity managed = userRepository.findById(user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));

        managed.setGithubUsername(null);
        managed.setGithubAvatarUrl(null);
        managed.setGithubDisplayName(null);
        managed.setGithubConnectedAt(null);
        managed.setGithubScopes(null);
        managed.setGithubAccessToken(null);

        return toModel(userRepository.save(managed));
    }

    @Override
    public String beginGitHubOAuth(UserEntity user) {
        if (!gitHubOAuthClient.isConfigured()) {
            throw new ResponseStatusException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "GitHub OAuth is not configured on the server"
            );
        }
        String state = jwtService.generateOAuthState(user.getId());
        return gitHubOAuthClient.buildAuthorizeUrl(state);
    }

    @Override
    public String completeGitHubOAuth(String code, String state) {
        try {
            if (code == null || code.isBlank() || state == null || state.isBlank()) {
                return failureRedirect("missing_code_or_state");
            }

            String userId = jwtService.parseOAuthStateUserId(state);
            UserEntity user = userRepository.findById(userId)
                    .orElseThrow(() -> new IllegalArgumentException("User not found for OAuth state"));

            GitHubOAuthService.ExchangeResult result = gitHubOAuthService.exchangeCodeFull(code);
            List<String> scopes = gitHubOAuthClient.parseScopes(result.token().scope());

            user.setGithubUsername(result.user().login());
            user.setGithubAvatarUrl(result.user().avatarUrl());
            user.setGithubDisplayName(result.user().name());
            user.setGithubConnectedAt(Instant.now());
            user.setGithubScopes(String.join(",", scopes));
            user.setGithubAccessToken(result.token().accessToken());
            userRepository.save(user);

            return oauthSuccessRedirect;
        } catch (Exception e) {
            return failureRedirect(e.getMessage() != null ? e.getMessage() : "oauth_failed");
        }
    }

    private String failureRedirect(String reason) {
        String safe = reason == null || reason.isBlank() ? "oauth_failed" : reason;
        if (safe.length() > 120) {
            safe = safe.substring(0, 120);
        }
        return UriComponentsBuilder.fromUriString(oauthFailureRedirect)
                .replaceQueryParam("github", "error")
                .replaceQueryParam("reason", safe)
                .build()
                .toUriString();
    }

    @Override
    public String githubOAuthErrorRedirect(String reason) {
        return failureRedirect(reason != null ? reason : "access_denied");
    }

    @Override
    public com.cloudbase.dto.AuthDtos.GitHubProfileResponse exchangeGitHubCode(UserEntity user, String code) {
        GitHubOAuthService.ExchangeResult result = gitHubOAuthService.exchangeCodeFull(code);
        List<String> scopes = gitHubOAuthClient.parseScopes(result.token().scope());

        UserEntity managed = userRepository.findById(user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));

        managed.setGithubUsername(result.user().login());
        managed.setGithubAvatarUrl(result.user().avatarUrl());
        managed.setGithubDisplayName(result.user().name());
        managed.setGithubConnectedAt(Instant.now());
        managed.setGithubScopes(String.join(",", scopes));
        managed.setGithubAccessToken(result.token().accessToken());
        userRepository.save(managed);

        return new com.cloudbase.dto.AuthDtos.GitHubProfileResponse(
                result.user().login(),
                result.user().name(),
                result.user().avatarUrl(),
                scopes
        );
    }

    @Override
    public java.util.List<com.cloudbase.dto.AuthDtos.GitHubRepoResponse> listGitHubRepos(UserEntity user) {
        UserEntity managed = userRepository.findById(user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));

        if (managed.getGithubAccessToken() == null || managed.getGithubAccessToken().isBlank()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "GitHub is not connected with a valid token. Connect GitHub from Account first."
            );
        }

        return gitHubOAuthClient.listRepos(managed.getGithubAccessToken()).stream()
                .map(r -> new com.cloudbase.dto.AuthDtos.GitHubRepoResponse(
                        r.fullName(),
                        r.name(),
                        r.htmlUrl(),
                        r.isPrivate(),
                        r.defaultBranch()
                ))
                .toList();
    }

    public static UserAccount toModel(UserEntity entity) {
        return new UserAccount(
                entity.getId(),
                entity.getName(),
                entity.getEmail(),
                entity.getRole(),
                entity.getAccountStatus(),
                entity.isDeploymentEnabled(),
                entity.isEmailVerified(),
                toGitHub(entity),
                entity.isOnboardingDismissed(),
                new com.cloudbase.model.NotificationPrefs(
                        entity.isNotifyEmailDeployments(),
                        entity.isNotifyEmailFailures(),
                        entity.isNotifyEmailWeeklyUsage()
                )
        );
    }

    @Override
    public java.util.Map<String, Object> getPlan() {
        return planQuotaService.planInfo();
    }

    @Override
    public java.util.Map<String, Object> getUsage(UserEntity user) {
        return planQuotaService.usageFor(user);
    }

    @Override
    public UserAccount updateProfile(UserEntity user, String name) {
        UserEntity managed = userRepository.findById(user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));
        String trimmed = name == null ? "" : name.trim();
        if (trimmed.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Name is required");
        }
        if (trimmed.length() > 120) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Name is too long");
        }
        managed.setName(trimmed);
        return toModel(userRepository.save(managed));
    }

    @Override
    public MessageResponse changePassword(UserEntity user, String currentPassword, String newPassword) {
        UserEntity managed = userRepository.findById(user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));
        if (currentPassword == null || currentPassword.isBlank()
                || newPassword == null || newPassword.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Current and new password are required");
        }
        if (!isStrongPassword(newPassword)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Password must be at least 8 characters and include upper, lower, digit, and special character"
            );
        }
        if (!passwordEncoder.matches(currentPassword, managed.getPasswordHash())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Current password is incorrect");
        }
        managed.setPasswordHash(passwordEncoder.encode(newPassword));
        userRepository.save(managed);
        return new MessageResponse("Password changed");
    }

    @Override
    public UserAccount dismissOnboarding(UserEntity user) {
        UserEntity managed = userRepository.findById(user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));
        managed.setOnboardingDismissed(true);
        return toModel(userRepository.save(managed));
    }

    @Override
    public UserAccount updateNotificationPrefs(
            UserEntity user,
            boolean emailDeployments,
            boolean emailFailures,
            boolean emailWeeklyUsage
    ) {
        UserEntity managed = userRepository.findById(user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));
        managed.setNotifyEmailDeployments(emailDeployments);
        managed.setNotifyEmailFailures(emailFailures);
        managed.setNotifyEmailWeeklyUsage(emailWeeklyUsage);
        return toModel(userRepository.save(managed));
    }

    private static boolean isStrongPassword(String password) {
        if (password == null || password.length() < 8) return false;
        boolean upper = false, lower = false, digit = false, special = false;
        for (int i = 0; i < password.length(); i++) {
            char c = password.charAt(i);
            if (Character.isUpperCase(c)) upper = true;
            else if (Character.isLowerCase(c)) lower = true;
            else if (Character.isDigit(c)) digit = true;
            else special = true;
        }
        return upper && lower && digit && special;
    }

    private static String generateVerificationCode() {
        int n = SECURE_RANDOM.nextInt(1_000_000);
        return String.format("%06d", n);
    }

    private static GitHubConnection toGitHub(UserEntity entity) {
        if (entity.getGithubUsername() == null || entity.getGithubUsername().isBlank()) {
            return GitHubConnection.disconnected();
        }
        List<String> scopes = entity.getGithubScopes() == null || entity.getGithubScopes().isBlank()
                ? List.of()
                : Arrays.stream(entity.getGithubScopes().split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
        return new GitHubConnection(
                true,
                entity.getGithubUsername(),
                entity.getGithubDisplayName(),
                entity.getGithubAvatarUrl(),
                entity.getGithubConnectedAt(),
                scopes
        );
    }
}
