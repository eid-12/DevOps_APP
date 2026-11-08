package com.cloudbase.service.impl;

import com.cloudbase.dto.AuthDtos.AuthResponse;
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
import com.cloudbase.security.LoginRateLimiter;
import com.cloudbase.security.PasswordPolicy;
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
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

@Service
@Transactional
public class AuthServiceImpl implements AuthService {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(AuthServiceImpl.class);

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final int CODE_TTL_MINUTES = 15;

    private final UserRepository userRepository;
    private final JwtService jwtService;
    private final PasswordEncoder passwordEncoder;
    private final GitHubOAuthClient gitHubOAuthClient;
    private final GitHubOAuthService gitHubOAuthService;
    private final EmailService emailService;
    private final EmailRateLimiter emailRateLimiter;
    private final LoginRateLimiter loginRateLimiter;
    private final ResendProperties resendProperties;
    private final PlanQuotaService planQuotaService;

    public AuthServiceImpl(
            UserRepository userRepository,
            JwtService jwtService,
            PasswordEncoder passwordEncoder,
            GitHubOAuthClient gitHubOAuthClient,
            GitHubOAuthService gitHubOAuthService,
            GitHubOAuthProperties gitHubOAuthProperties,
            EmailService emailService,
            EmailRateLimiter emailRateLimiter,
            LoginRateLimiter loginRateLimiter,
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
        this.loginRateLimiter = loginRateLimiter;
        this.resendProperties = resendProperties;
        this.planQuotaService = planQuotaService;
    }

    @Override
    public AuthResponse login(LoginRequest request) {
        // Throttle before any password work so a locked attacker cannot keep guessing.
        loginRateLimiter.checkAllowed(request.email());
        UserEntity user = findUserByEmail(request.email()).orElse(null);
        if (user == null || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            loginRateLimiter.recordFailure(request.email());
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password");
        }
        loginRateLimiter.clearFailures(request.email());

        if (!user.isEmailVerified()) {
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN,
                    "Email not verified. Enter the 6-digit code we sent, or request a new one."
            );
        }
        if (user.getAccountStatus() == AccountStatus.SUSPENDED) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account has been suspended. Contact an administrator.");
        }
        if (user.getAccountStatus() != AccountStatus.ACTIVE) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account is not active. Contact an administrator.");
        }

        String token = jwtService.generateToken(user.getId(), user.getRole().name(), user.getSessionVersion());
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
        String email = normalizeEmail(request.email());
        if (userRepository.existsByEmailIgnoreCase(email)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Email already registered");
        }
        PasswordPolicy.require(request.password());

        if (emailService.isEnabled()) {
            emailRateLimiter.acquireSend(EmailRateLimiter.Action.VERIFICATION, email);
        }

        String code = generateVerificationCode();
        UserEntity user = UserEntity.builder()
                .id("u-" + UUID.randomUUID().toString().substring(0, 8))
                .name(request.name())
                .email(email)
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
            String token = jwtService.generateToken(user.getId(), user.getRole().name(), user.getSessionVersion());
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
        sendVerificationCode(user, code);
        return new AuthResponse(
                null,
                toModel(user),
                "We sent a 6-digit verification code to your email. Enter it to confirm your address."
        );
    }

    // noRollbackFor: destroying the code on lockout must survive the 429.
    @Override
    @org.springframework.transaction.annotation.Transactional(noRollbackFor = ResponseStatusException.class)
    public MessageResponse verifyEmail(String email, String code) {
        UserEntity user = findUserByEmail(email, true).orElse(null);
        emailRateLimiter.checkVerifyAllowed(email);

        // Unknown, verified, expired and wrong all answer alike, so this endpoint does not reveal accounts.
        boolean pending = user != null && !user.isEmailVerified()
                && user.getEmailVerificationCode() != null
                && user.getEmailVerificationExpiresAt() != null
                && Instant.now().isBefore(user.getEmailVerificationExpiresAt());
        if (!pending || code == null || !java.security.MessageDigest.isEqual(
                user.getEmailVerificationCode().getBytes(java.nio.charset.StandardCharsets.UTF_8),
                code.trim().getBytes(java.nio.charset.StandardCharsets.UTF_8))) {
            if (emailRateLimiter.recordVerifyFailure(email)) {
                if (user != null && !user.isEmailVerified()) {
                    user.setEmailVerificationCode(null);
                    user.setEmailVerificationExpiresAt(null);
                    userRepository.save(user);
                }
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Too many wrong codes. Request a new verification code.");
            }
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "That code is incorrect or has expired. Check it or request a new code. If this email is already verified, sign in.");
        }

        emailRateLimiter.clearVerifyFailures(email);
        user.setEmailVerified(true);
        user.setEmailVerificationCode(null);
        user.setEmailVerificationExpiresAt(null);
        // Verification activates a pending account, never overrides an administrative suspension.
        if (user.getAccountStatus() == AccountStatus.PENDING_ACTIVATION) {
            user.setAccountStatus(AccountStatus.ACTIVE);
        }
        user.setDeploymentEnabled(false);
        userRepository.save(user);

        // Courtesy emails must not undo a verification that already succeeded.
        try {
            emailService.sendRegistrationPending(user.getEmail(), user.getName());
            emailService.notifyAdminNewRegistration(user.getName(), user.getEmail());
        } catch (RuntimeException e) {
            log.warn("Post-verification email failed for user {}", user.getId());
        }

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
        String generic = "If this account still needs verification, a new code was sent. Check your inbox and spam folder.";
        UserEntity user = findUserByEmail(email, true).orElse(null);
        if (user == null || user.isEmailVerified()) {
            emailRateLimiter.noteUnknownInbox(EmailRateLimiter.Action.VERIFICATION, email);
            return new MessageResponse(generic);
        }

        emailRateLimiter.acquireSend(EmailRateLimiter.Action.VERIFICATION, user.getEmail());
        String code = generateVerificationCode();
        user.setEmailVerificationCode(code);
        user.setEmailVerificationExpiresAt(Instant.now().plus(CODE_TTL_MINUTES, ChronoUnit.MINUTES));
        userRepository.save(user);
        sendVerificationCode(user, code);
        emailRateLimiter.clearVerifyFailures(user.getEmail());
        return new MessageResponse(generic);
    }

    /** Provider failure becomes a clear 503; the caller's transaction rolls back, so an earlier code stays valid. */
    private void sendVerificationCode(UserEntity user, String code) {
        try {
            emailService.sendEmailVerificationCode(user.getEmail(), user.getName(), code);
        } catch (IllegalStateException e) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "We could not send the email right now. Please try again in a minute.");
        }
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
        Optional<UserEntity> found = findUserByEmail(email);
        if (found.isEmpty()) {
            emailRateLimiter.noteUnknownInbox(EmailRateLimiter.Action.PASSWORD_RESET, email);
            return new MessageResponse(generic);
        }
        UserEntity user = found.get();
        emailRateLimiter.acquireSend(EmailRateLimiter.Action.PASSWORD_RESET, user.getEmail());
        String token = jwtService.generatePasswordResetToken(user.getId(), user.getSessionVersion());
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
        PasswordPolicy.require(newPassword);
        final String userId;
        try {
            userId = jwtService.parsePasswordResetUserId(token);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid or expired reset token");
        }
        // Row lock until commit: concurrent uses of the same link queue here and see the incremented version.
        UserEntity user = userRepository.lockById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid or expired reset token"));
        // Single use: the link carries the session version it was issued at, which setting a password increments.
        if (!jwtService.isPasswordResetTokenCurrent(token, user.getSessionVersion())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid or expired reset token");
        }
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        user.setSessionVersion(user.getSessionVersion() + 1); // signs out every existing session
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
    public AuthResponse changePassword(UserEntity user, String currentPassword, String newPassword) {
        // Row lock until commit: a concurrent change or reset finishes first, then the current-password check fails.
        UserEntity managed = userRepository.lockById(user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));
        if (currentPassword == null || currentPassword.isBlank()
                || newPassword == null || newPassword.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Current and new password are required");
        }
        PasswordPolicy.require(newPassword);
        if (!passwordEncoder.matches(currentPassword, managed.getPasswordHash())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Current password is incorrect");
        }
        managed.setPasswordHash(passwordEncoder.encode(newPassword));
        managed.setSessionVersion(managed.getSessionVersion() + 1);
        UserEntity saved = userRepository.save(managed);
        // Every earlier session token is now invalid; hand this browser a fresh one so it stays signed in.
        String token = jwtService.generateToken(saved.getId(), saved.getRole().name(), saved.getSessionVersion());
        return new AuthResponse(token, toModel(saved), "Password changed. Other sessions were signed out.",
                jwtService.getExpiration(token).toInstant().toString(), jwtService.getExpiresInSeconds());
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

    /** New accounts are stored trimmed + lowercased so one inbox maps to one account. */
    static String normalizeEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * Exact match first (legacy rows may be mixed-case), then a case-insensitive match only
     * when it is unambiguous, so "Alice@X.com" finds "alice@x.com" without guessing between
     * pre-existing case-variant duplicates.
     */
    private Optional<UserEntity> findUserByEmail(String rawEmail) {
        return findUserByEmail(rawEmail, false);
    }

    private Optional<UserEntity> findUserByEmail(String rawEmail, boolean forUpdate) {
        String trimmed = rawEmail == null ? "" : rawEmail.trim();
        Optional<UserEntity> exact = forUpdate ? userRepository.lockByEmail(trimmed) : userRepository.findByEmail(trimmed);
        if (exact.isPresent()) {
            return exact;
        }
        List<UserEntity> matches = forUpdate ? userRepository.lockAllByEmailIgnoreCase(trimmed)
                : userRepository.findAllByEmailIgnoreCase(trimmed);
        return matches.size() == 1 ? Optional.of(matches.get(0)) : Optional.empty();
    }

    private static String generateVerificationCode() {
        int n = SECURE_RANDOM.nextInt(1_000_000);
        return String.format("%06d", n);
    }

    private static GitHubConnection toGitHub(UserEntity entity) {
        if (entity.getGithubUsername() == null || entity.getGithubUsername().isBlank()) {
            return GitHubConnection.disconnected();
        }
        boolean hasToken = entity.getGithubAccessToken() != null && !entity.getGithubAccessToken().isBlank();
        if (!hasToken) {
            // Username-only stub is not a real OAuth link — repo list needs a token.
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
