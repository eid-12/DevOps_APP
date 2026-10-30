package com.cloudbase.service.impl;

import com.cloudbase.dto.AuthDtos;
import com.cloudbase.email.EmailRateLimiter;
import com.cloudbase.email.EmailService;
import com.cloudbase.email.ResendProperties;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.github.GitHubOAuthClient;
import com.cloudbase.github.GitHubOAuthProperties;
import com.cloudbase.github.GitHubOAuthService;
import com.cloudbase.model.AccountStatus;
import com.cloudbase.model.UserRole;
import com.cloudbase.repository.UserRepository;
import com.cloudbase.security.JwtService;
import com.cloudbase.security.LoginRateLimiter;
import com.cloudbase.service.PlanQuotaService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Recovery must not reveal accounts, and mail failures must be clear and must not undo a verification. */
class EmailVerificationRecoveryTest {

    private final UserRepository users = mock(UserRepository.class);
    private final EmailService email = mock(EmailService.class);
    private final AuthServiceImpl auth = new AuthServiceImpl(users,
            new JwtService("test-secret-that-is-long-enough-for-hs512-signing-0123456789abcdef", 3_600_000L),
            new BCryptPasswordEncoder(4), mock(GitHubOAuthClient.class), mock(GitHubOAuthService.class),
            mock(GitHubOAuthProperties.class), email, new EmailRateLimiter(), mock(LoginRateLimiter.class),
            mock(ResendProperties.class), mock(PlanQuotaService.class));

    private UserEntity pending(Instant expires) {
        UserEntity u = new UserEntity();
        u.setId("u1");
        u.setName("QA");
        u.setEmail("qa@cloudbase.test");
        u.setRole(UserRole.USER);
        u.setAccountStatus(AccountStatus.PENDING_ACTIVATION);
        u.setEmailVerificationCode("123456");
        u.setEmailVerificationExpiresAt(expires);
        when(users.findAllByEmailIgnoreCase(anyString())).thenReturn(List.of(u));
        when(email.isEnabled()).thenReturn(true);
        return u;
    }

    private String refusal(String mail, String code) {
        return assertThrows(ResponseStatusException.class, () -> auth.verifyEmail(mail, code)).getReason();
    }

    @Test
    void unknownExpiredAndWrongCodesAnswerAlike() {
        when(users.findAllByEmailIgnoreCase(anyString())).thenReturn(List.of());
        String unknown = refusal("nobody@cloudbase.test", "123456");
        pending(Instant.now().minusSeconds(1));
        assertEquals(unknown, refusal("qa@cloudbase.test", "123456"));
        pending(Instant.now().plusSeconds(60));
        assertEquals(unknown, refusal("qa2@cloudbase.test", "000000"));
    }

    @Test
    void resendAnswersAlikeForUnknownAndPendingAccounts() {
        when(email.isEnabled()).thenReturn(true);
        when(users.findAllByEmailIgnoreCase(anyString())).thenReturn(List.of());
        AuthDtos.MessageResponse unknown = auth.resendVerificationCode("nobody@cloudbase.test");
        pending(Instant.now());
        assertEquals(unknown.message(), auth.resendVerificationCode("qa@cloudbase.test").message());
    }

    @Test
    void deliveryFailureIsAClear503() {
        pending(Instant.now());
        doThrow(new IllegalStateException("provider down")).when(email).sendEmailVerificationCode(any(), any(), any());
        ResponseStatusException e = assertThrows(ResponseStatusException.class, () -> auth.resendVerificationCode("qa@cloudbase.test"));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatusCode());
    }

    @Test
    void aFailedWelcomeEmailDoesNotUndoVerification() {
        UserEntity u = pending(Instant.now().plusSeconds(60));
        doThrow(new IllegalStateException("provider down")).when(email).sendRegistrationPending(any(), any());
        auth.verifyEmail("qa@cloudbase.test", "123456");
        assertTrue(u.isEmailVerified());
    }
}
