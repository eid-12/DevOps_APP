package com.cloudbase.security;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** CVE-2025-22228: BCrypt ignores everything after 72 bytes. */
class PasswordEncoderLimitTest {

    private final PasswordEncoder encoder = new SecurityConfig(null, null).passwordEncoder();

    @Test
    void longPasswordSharingThePrefixDoesNotMatch() {
        String stored = "Aa1@" + "x".repeat(68);           // exactly 72 bytes
        String hash = encoder.encode(stored);
        assertTrue(encoder.matches(stored, hash));
        assertFalse(encoder.matches(stored + "anything", hash));
    }

    @Test
    void refusesToStoreOverlongPasswords() {
        assertThrows(IllegalArgumentException.class, () -> encoder.encode("Aa1@" + "x".repeat(69)));
        assertThrows(IllegalArgumentException.class, () -> encoder.encode(null));
    }
}
