package com.cloudbase.github;

import org.bouncycastle.crypto.digests.Blake2bDigest;
import org.bouncycastle.crypto.engines.XSalsa20Engine;
import org.bouncycastle.crypto.macs.Poly1305;
import org.bouncycastle.crypto.params.KeyParameter;
import org.bouncycastle.crypto.params.ParametersWithIV;
import org.bouncycastle.math.ec.rfc7748.X25519;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;

/**
 * Encrypts GitHub Actions secrets with libsodium's {@code crypto_box_seal}, which is what GitHub requires.
 * Implemented in-process (Bouncy Castle) so the runtime image needs no Python/PyNaCl and the secret
 * never appears on a command line.
 *
 * <p>Sealed box = ephemeral X25519 key pair, nonce = BLAKE2b-192(epk || recipientPk),
 * {@code crypto_box} (HSalsa20 key derivation + XSalsa20-Poly1305), output = epk || mac || ciphertext.
 */
@Component
public class GitHubSecretEncryptor {

    private static final int KEY = 32;
    private static final int MAC = 16;
    private static final int NONCE = 24;

    private final SecureRandom random = new SecureRandom();

    /** @return base64 sealed box of {@code secretValue} for the repo's base64 Actions public key. */
    public String encrypt(String publicKeyBase64, String secretValue) {
        byte[] recipientPk = Base64.getDecoder().decode(publicKeyBase64);
        if (recipientPk.length != KEY) {
            throw new IllegalArgumentException("GitHub Actions public key must be 32 bytes");
        }
        byte[] ephemeralSk = new byte[KEY];
        X25519.generatePrivateKey(random, ephemeralSk);
        try {
            byte[] sealed = seal(secretValue.getBytes(StandardCharsets.UTF_8), recipientPk, ephemeralSk);
            return Base64.getEncoder().encodeToString(sealed);
        } finally {
            Arrays.fill(ephemeralSk, (byte) 0);
        }
    }

    /** Deterministic core (ephemeral key supplied) so tests can compare against libsodium output. */
    static byte[] seal(byte[] message, byte[] recipientPk, byte[] ephemeralSk) {
        byte[] ephemeralPk = new byte[KEY];
        X25519.generatePublicKey(ephemeralSk, 0, ephemeralPk, 0);

        byte[] shared = new byte[KEY];
        if (!X25519.calculateAgreement(ephemeralSk, 0, recipientPk, 0, shared, 0)) {
            throw new IllegalArgumentException("Invalid GitHub Actions public key");
        }
        byte[] boxKey = hsalsa20(shared, new byte[16]);   // crypto_box_beforenm
        Arrays.fill(shared, (byte) 0);

        Blake2bDigest blake = new Blake2bDigest(NONCE * 8);
        blake.update(ephemeralPk, 0, KEY);
        blake.update(recipientPk, 0, KEY);
        byte[] nonce = new byte[NONCE];
        blake.doFinal(nonce, 0);

        // crypto_secretbox: keystream block 0..31 keys Poly1305, the rest encrypts the message.
        XSalsa20Engine cipher = new XSalsa20Engine();
        cipher.init(true, new ParametersWithIV(new KeyParameter(boxKey), nonce));
        byte[] polyKey = new byte[KEY];
        cipher.processBytes(new byte[KEY], 0, KEY, polyKey, 0);
        byte[] ciphertext = new byte[message.length];
        cipher.processBytes(message, 0, message.length, ciphertext, 0);
        Arrays.fill(boxKey, (byte) 0);

        Poly1305 poly = new Poly1305();
        poly.init(new KeyParameter(polyKey));
        poly.update(ciphertext, 0, ciphertext.length);
        byte[] mac = new byte[MAC];
        poly.doFinal(mac, 0);
        Arrays.fill(polyKey, (byte) 0);

        byte[] out = new byte[KEY + MAC + ciphertext.length];
        System.arraycopy(ephemeralPk, 0, out, 0, KEY);
        System.arraycopy(mac, 0, out, KEY, MAC);
        System.arraycopy(ciphertext, 0, out, KEY + MAC, ciphertext.length);
        return out;
    }

    /** HSalsa20 (the XSalsa20 key-derivation core), 32-byte key + 16-byte input -> 32-byte subkey. */
    static byte[] hsalsa20(byte[] key, byte[] in16) {
        int[] x = new int[16];
        x[0] = 0x61707865; x[5] = 0x3320646e; x[10] = 0x79622d32; x[15] = 0x6b206574; // "expand 32-byte k"
        for (int i = 0; i < 4; i++) {
            x[1 + i] = le32(key, i * 4);
            x[11 + i] = le32(key, 16 + i * 4);
            x[6 + i] = le32(in16, i * 4);
        }
        for (int i = 0; i < 20; i += 2) {
            x[4] ^= Integer.rotateLeft(x[0] + x[12], 7);  x[8] ^= Integer.rotateLeft(x[4] + x[0], 9);
            x[12] ^= Integer.rotateLeft(x[8] + x[4], 13); x[0] ^= Integer.rotateLeft(x[12] + x[8], 18);
            x[9] ^= Integer.rotateLeft(x[5] + x[1], 7);   x[13] ^= Integer.rotateLeft(x[9] + x[5], 9);
            x[1] ^= Integer.rotateLeft(x[13] + x[9], 13); x[5] ^= Integer.rotateLeft(x[1] + x[13], 18);
            x[14] ^= Integer.rotateLeft(x[10] + x[6], 7); x[2] ^= Integer.rotateLeft(x[14] + x[10], 9);
            x[6] ^= Integer.rotateLeft(x[2] + x[14], 13); x[10] ^= Integer.rotateLeft(x[6] + x[2], 18);
            x[3] ^= Integer.rotateLeft(x[15] + x[11], 7); x[7] ^= Integer.rotateLeft(x[3] + x[15], 9);
            x[11] ^= Integer.rotateLeft(x[7] + x[3], 13); x[15] ^= Integer.rotateLeft(x[11] + x[7], 18);
            x[1] ^= Integer.rotateLeft(x[0] + x[3], 7);   x[2] ^= Integer.rotateLeft(x[1] + x[0], 9);
            x[3] ^= Integer.rotateLeft(x[2] + x[1], 13);  x[0] ^= Integer.rotateLeft(x[3] + x[2], 18);
            x[6] ^= Integer.rotateLeft(x[5] + x[4], 7);   x[7] ^= Integer.rotateLeft(x[6] + x[5], 9);
            x[4] ^= Integer.rotateLeft(x[7] + x[6], 13);  x[5] ^= Integer.rotateLeft(x[4] + x[7], 18);
            x[11] ^= Integer.rotateLeft(x[10] + x[9], 7); x[8] ^= Integer.rotateLeft(x[11] + x[10], 9);
            x[9] ^= Integer.rotateLeft(x[8] + x[11], 13); x[10] ^= Integer.rotateLeft(x[9] + x[8], 18);
            x[12] ^= Integer.rotateLeft(x[15] + x[14], 7); x[13] ^= Integer.rotateLeft(x[12] + x[15], 9);
            x[14] ^= Integer.rotateLeft(x[13] + x[12], 13); x[15] ^= Integer.rotateLeft(x[14] + x[13], 18);
        }
        byte[] out = new byte[32];
        int[] pick = {0, 5, 10, 15, 6, 7, 8, 9};
        for (int i = 0; i < 8; i++) {
            int v = x[pick[i]];
            out[i * 4] = (byte) v; out[i * 4 + 1] = (byte) (v >>> 8);
            out[i * 4 + 2] = (byte) (v >>> 16); out[i * 4 + 3] = (byte) (v >>> 24);
        }
        return out;
    }

    private static int le32(byte[] b, int o) {
        return (b[o] & 0xff) | (b[o + 1] & 0xff) << 8 | (b[o + 2] & 0xff) << 16 | (b[o + 3] & 0xff) << 24;
    }
}
