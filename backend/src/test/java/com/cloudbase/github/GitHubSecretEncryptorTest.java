package com.cloudbase.github;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HexFormat;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class GitHubSecretEncryptorTest {

    private static final HexFormat HEX = HexFormat.of();
    // Generated with libsodium (libsodium-wrappers 0.7.15): recipient = crypto_box_seed_keypair(32 x 0x07),
    // ephemeral sk = 01..20, sealed = epk || crypto_box_easy(m, blake2b24(epk||rpk), rpk, esk);
    // libsodium's crypto_box_seal_open opens both vectors.
    private static final byte[] RECIPIENT_PK = HEX.parseHex("761d88ec830413919dfe9d4d1d56f17e653c8c994082df5b137b90a0ae6edf74");
    private static final byte[] EPHEMERAL_SK = HEX.parseHex("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20");

    @Test
    void matchesLibsodiumSealedBoxByteForByte() {
        byte[] sealed = GitHubSecretEncryptor.seal(
                "example-actions-secret-value".getBytes(StandardCharsets.UTF_8), RECIPIENT_PK, EPHEMERAL_SK);
        assertArrayEquals(HEX.parseHex(
                "07a37cbc142093c8b755dc1b10e86cb426374ad16aa853ed0bdfc0b2b86d1c7c"
                        + "8037bf8c6e2bc0ddd656ecadc2ce9934e398d2419bbe95de0d36621674fff058ddc4c640b3ca2ed99e771ff0"),
                sealed);
    }

    @Test
    void matchesLibsodiumForEmptyMessage() {
        byte[] sealed = GitHubSecretEncryptor.seal(new byte[0], RECIPIENT_PK, EPHEMERAL_SK);
        assertArrayEquals(HEX.parseHex(
                "07a37cbc142093c8b755dc1b10e86cb426374ad16aa853ed0bdfc0b2b86d1c7c06764fc24058b360245457fad4ebeaee"),
                sealed);
    }

    @Test
    void encryptUsesFreshEphemeralKeyAndGitHubWireFormat() {
        GitHubSecretEncryptor encryptor = new GitHubSecretEncryptor();
        String key = Base64.getEncoder().encodeToString(RECIPIENT_PK);
        byte[] a = Base64.getDecoder().decode(encryptor.encrypt(key, "secret"));
        byte[] b = Base64.getDecoder().decode(encryptor.encrypt(key, "secret"));
        assertEquals(32 + 16 + "secret".length(), a.length);
        assertNotEquals(HEX.formatHex(a), HEX.formatHex(b));
    }

    @Test
    void rejectsMalformedPublicKey() {
        assertThrows(IllegalArgumentException.class,
                () -> new GitHubSecretEncryptor().encrypt(Base64.getEncoder().encodeToString(new byte[16]), "x"));
    }
}
