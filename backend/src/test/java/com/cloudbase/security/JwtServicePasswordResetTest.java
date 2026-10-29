package com.cloudbase.security;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Set;
import java.util.TreeSet;

import com.fasterxml.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JwtServicePasswordResetTest {

    private final JwtService jwt = new JwtService("test-secret-that-is-long-enough-for-hs512-signing-0123456789abcdef", 3_600_000L);

    @Test
    void resetTokenIsValidOnlyAtTheSessionVersionItWasIssuedFor() {
        String token = jwt.generatePasswordResetToken("u-1", 4);

        assertEquals("u-1", jwt.parsePasswordResetUserId(token));
        assertTrue(jwt.isPasswordResetTokenCurrent(token, 4));
        // Setting a password increments the version, so replaying the same link must fail.
        assertFalse(jwt.isPasswordResetTokenCurrent(token, 5));
    }

    @Test
    void sessionAndOAuthTokensAreNotResetTokens() {
        assertThrows(IllegalArgumentException.class, () -> jwt.parsePasswordResetUserId(jwt.generateToken("u-1", "USER", 0)));
        assertThrows(IllegalArgumentException.class, () -> jwt.parsePasswordResetUserId(jwt.generateOAuthState("u-1")));
    }

    @Test
    void sessionTokenStopsMatchingOnceTheSessionVersionMoves() {
        String token = jwt.generateToken("u-1", "USER", 2);
        assertTrue(jwt.isCurrentSession(jwt.parseToken(token), 2));
        assertFalse(jwt.isCurrentSession(jwt.parseToken(token), 3));
    }

    /** Tokens are readable by anyone holding them: they must carry nothing derived from the password. */
    @Test
    void readablePayloadsCarryOnlyNonSecretClaims() throws Exception {
        assertEquals(Set.of("sub", "role", "sv", "iat", "exp"), claimNames(jwt.generateToken("u-1", "USER", 7)));
        assertEquals(Set.of("sub", "purpose", "sv", "iat", "exp"), claimNames(jwt.generatePasswordResetToken("u-1", 7)));
    }

    private static Set<String> claimNames(String token) throws Exception {
        String payload = new String(Base64.getUrlDecoder().decode(token.split("\\.")[1]), StandardCharsets.UTF_8);
        Set<String> names = new TreeSet<>();
        new ObjectMapper().readTree(payload).fieldNames().forEachRemaining(names::add);
        return names;
    }
}
