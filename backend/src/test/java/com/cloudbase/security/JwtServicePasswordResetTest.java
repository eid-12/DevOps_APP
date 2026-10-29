package com.cloudbase.security;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JwtServicePasswordResetTest {

    private final JwtService jwt = new JwtService("test-secret-that-is-long-enough-for-hs512-signing-0123456789abcdef", 3_600_000L);

    @Test
    void resetTokenIsValidOnlyForThePasswordItWasIssuedAgainst() {
        String token = jwt.generatePasswordResetToken("u-1", "$2a$10$oldhash");

        assertEquals("u-1", jwt.parsePasswordResetUserId(token));
        assertTrue(jwt.isPasswordResetTokenCurrent(token, "$2a$10$oldhash"));
        // After the reset the stored hash changes, so replaying the same link must fail.
        assertFalse(jwt.isPasswordResetTokenCurrent(token, "$2a$10$newhash"));
    }

    @Test
    void sessionAndOAuthTokensAreNotResetTokens() {
        assertThrows(IllegalArgumentException.class, () -> jwt.parsePasswordResetUserId(jwt.generateToken("u-1", "USER", "$2a$10$hash")));
        assertThrows(IllegalArgumentException.class, () -> jwt.parsePasswordResetUserId(jwt.generateOAuthState("u-1")));
    }

    @Test
    void sessionTokenStopsMatchingOnceThePasswordChanges() {
        String token = jwt.generateToken("u-1", "USER", "$2a$10$oldhash");
        assertTrue(jwt.isCurrentForPassword(jwt.parseToken(token), "$2a$10$oldhash"));
        assertFalse(jwt.isCurrentForPassword(jwt.parseToken(token), "$2a$10$newhash"));
        assertFalse(token.contains("oldhash"), "the claim is a one-way fingerprint, not the hash");
    }
}
