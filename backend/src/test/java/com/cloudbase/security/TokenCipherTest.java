package com.cloudbase.security;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** GitHub tokens are unreadable in the database; legacy plaintext still works; a rotated secret means "reconnect". */
class TokenCipherTest {

    private static final String SECRET = "test-secret-that-is-long-enough-for-hs512-signing-0123456789abcdef";
    private final TokenCipher cipher = new TokenCipher(SECRET);

    @Test
    void roundTripsAndNeverStoresTheTokenInTheClear() {
        String token = "gho_" + "x".repeat(36);
        String stored = cipher.encrypt(token);
        assertTrue(stored.startsWith(TokenCipher.PREFIX));
        assertFalse(stored.contains(token));
        assertEquals(token, cipher.decrypt(stored));
        assertNotEquals(stored, cipher.encrypt(token), "a fresh IV each time");
    }

    @Test
    void legacyPlaintextIsStillReadable() {
        assertEquals("synthetic-token", cipher.decrypt("synthetic-token"));
        assertNull(cipher.decrypt(null));
    }

    @Test
    void aRotatedSecretOrTamperingReadsAsDisconnected() {
        String stored = cipher.encrypt("gho_secret");
        assertNull(new TokenCipher(SECRET + "-rotated").decrypt(stored));
        String tampered = stored.substring(0, stored.length() - 2) + (stored.endsWith("A") ? "B" : "A") + "=";
        assertNull(cipher.decrypt(tampered));
    }

    @Test
    void encryptingTwiceDoesNotDoubleWrap() {
        String stored = cipher.encrypt("gho_secret");
        assertEquals(stored, cipher.encrypt(stored));
    }
}
