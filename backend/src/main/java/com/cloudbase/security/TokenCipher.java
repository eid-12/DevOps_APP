package com.cloudbase.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * Encrypts users' GitHub access tokens at rest (AES-256-GCM), so a leaked database or backup does not hand out write
 * access to their repositories. The key is derived from {@code jwt.secret} (already required and strong in
 * production) with a purpose label, so no extra setting is needed. Rotating that secret makes stored tokens
 * unreadable; they then read as "not connected" and users reconnect GitHub. Nothing else depends on them.
 *
 * <p>Stored form: {@code enc:v1:} + Base64(12-byte IV || ciphertext+tag). Values without the prefix are legacy
 * plaintext: readable, and re-encrypted on startup by {@code GitHubTokenEncryptionMigrator}.
 */
@Component
public class TokenCipher {

    public static final String PREFIX = "enc:v1:";
    private static final Logger log = LoggerFactory.getLogger(TokenCipher.class);
    private static final byte[] AAD = "cloudbase/github-token".getBytes(StandardCharsets.UTF_8);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final SecretKeySpec key;

    public TokenCipher(@Value("${jwt.secret}") String secret) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            this.key = new SecretKeySpec(mac.doFinal("cloudbase/github-token/v1".getBytes(StandardCharsets.UTF_8)), "AES");
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Cannot derive the token encryption key", e);
        }
    }

    public String encrypt(String plain) {
        if (plain == null || plain.isEmpty() || plain.startsWith(PREFIX)) {
            return plain;
        }
        try {
            byte[] iv = new byte[12];
            RANDOM.nextBytes(iv);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
            c.updateAAD(AAD);
            byte[] sealed = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            return PREFIX + Base64.getEncoder().encodeToString(ByteBuffer.allocate(iv.length + sealed.length).put(iv).put(sealed).array());
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Token encryption failed", e);
        }
    }

    /** Plaintext token, the legacy plaintext as stored, or null when it cannot be decrypted (e.g. rotated secret). */
    public String decrypt(String stored) {
        if (stored == null || !stored.startsWith(PREFIX)) {
            return stored;
        }
        try {
            byte[] all = Base64.getDecoder().decode(stored.substring(PREFIX.length()));
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, all, 0, 12));
            c.updateAAD(AAD);
            return new String(c.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            log.warn("A stored GitHub token could not be decrypted (secret rotated?); it is treated as disconnected");
            return null;
        }
    }
}
