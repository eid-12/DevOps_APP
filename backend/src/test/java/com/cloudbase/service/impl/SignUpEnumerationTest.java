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
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.server.ResponseStatusException;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** With email on, sign-up answers the same for a taken address as for a new one; the owner is told by email. */
class SignUpEnumerationTest {

    private final UserRepository users = mock(UserRepository.class);
    private final EmailService email = mock(EmailService.class);
    private final AuthServiceImpl auth = new AuthServiceImpl(users,
            new JwtService("test-secret-that-is-long-enough-for-hs512-signing-0123456789abcdef", 3_600_000L),
            new BCryptPasswordEncoder(4), mock(GitHubOAuthClient.class), mock(GitHubOAuthService.class),
            mock(GitHubOAuthProperties.class), email, new EmailRateLimiter(), mock(LoginRateLimiter.class),
            mock(ResendProperties.class), mock(PlanQuotaService.class));

    private static AuthDtos.RegisterRequest request(String mail) {
        return new AuthDtos.RegisterRequest("Visitor", mail, "Strong-Pass!2026");
    }

    @Test
    void takenAndNewAddressesGetTheSameAnswer() {
        when(email.isEnabled()).thenReturn(true);
        when(users.save(any())).thenAnswer(i -> i.getArgument(0));

        when(users.existsByEmailIgnoreCase("new@cloudbase.test")).thenReturn(false);
        AuthDtos.AuthResponse fresh = auth.register(request("new@cloudbase.test"));

        UserEntity owner = new UserEntity();
        owner.setId("u-owner");
        owner.setName("Real Owner");
        owner.setEmail("taken@cloudbase.test");
        owner.setRole(UserRole.ADMIN);
        owner.setAccountStatus(AccountStatus.ACTIVE);
        when(users.existsByEmailIgnoreCase("taken@cloudbase.test")).thenReturn(true);
        when(users.findByEmail("taken@cloudbase.test")).thenReturn(Optional.of(owner));
        AuthDtos.AuthResponse taken = auth.register(request("taken@cloudbase.test"));

        assertEquals(fresh.message(), taken.message());
        assertNull(taken.token());
        assertEquals(fresh.user().role(), taken.user().role(), "the real account's role is never shown");
        assertEquals(fresh.user().accountStatus(), taken.user().accountStatus());
        assertEquals("Visitor", taken.user().name(), "only what the visitor typed comes back");
        assertTrue(taken.user().id().matches("u-[0-9a-f]{8}"));
        assertNotEquals("u-owner", taken.user().id());
        verify(email).sendAccountAlreadyExists("taken@cloudbase.test", "Real Owner");
        verify(users, never()).save(eq(owner));
    }

    @Test
    void withoutEmailATakenAddressIsStillRefused() {
        when(email.isEnabled()).thenReturn(false);
        when(users.existsByEmailIgnoreCase(anyString())).thenReturn(true);
        assertThrows(ResponseStatusException.class, () -> auth.register(request("taken@cloudbase.test")));
    }
}
