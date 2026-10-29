package com.cloudbase.service.impl;

import com.cloudbase.email.EmailRateLimiter;
import com.cloudbase.email.EmailService;
import com.cloudbase.email.ResendProperties;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.github.GitHubOAuthClient;
import com.cloudbase.github.GitHubOAuthProperties;
import com.cloudbase.github.GitHubOAuthService;
import com.cloudbase.model.UserRole;
import com.cloudbase.repository.UserRepository;
import com.cloudbase.security.JwtService;
import com.cloudbase.security.LoginRateLimiter;
import com.cloudbase.service.PlanQuotaService;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.server.ResponseStatusException;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Password change and reset read the user under the row lock, so concurrent requests serialize (one wins). */
class PasswordChangeLockTest {

    private final UserRepository users = mock(UserRepository.class);
    private final PasswordEncoder encoder = new BCryptPasswordEncoder(4);
    private final JwtService jwt = new JwtService("test-secret-that-is-long-enough-for-hs512-signing-0123456789abcdef", 3_600_000L);
    private final AuthServiceImpl auth = new AuthServiceImpl(users, jwt, encoder, mock(GitHubOAuthClient.class),
            mock(GitHubOAuthService.class), mock(GitHubOAuthProperties.class), mock(EmailService.class),
            mock(EmailRateLimiter.class), mock(LoginRateLimiter.class), mock(ResendProperties.class), mock(PlanQuotaService.class));
    private final UserEntity user = new UserEntity();

    PasswordChangeLockTest() {
        user.setId("u1");
        user.setRole(UserRole.USER);
        user.setPasswordHash(encoder.encode("Old-Password!1"));
        when(users.lockById("u1")).thenReturn(Optional.of(user));
        when(users.save(any(UserEntity.class))).thenAnswer(i -> i.getArgument(0));
    }

    @Test
    void changePasswordReadsTheUserUnderTheLockAndBumpsTheVersion() {
        auth.changePassword(user, "Old-Password!1", "New-Password!2");
        verify(users).lockById("u1");
        verify(users, never()).findById(anyString());
        assertEquals(1, user.getSessionVersion());
    }

    @Test
    void resetReadsTheUserUnderTheLockAndIsSingleUse() {
        String link = jwt.generatePasswordResetToken("u1", 0);
        auth.resetPassword(link, "Reset-Password!3");
        verify(users).lockById("u1");
        verify(users, never()).findById(anyString());
        assertEquals(1, user.getSessionVersion());
        assertThrows(ResponseStatusException.class, () -> auth.resetPassword(link, "Reset-Again!4"));
    }
}
