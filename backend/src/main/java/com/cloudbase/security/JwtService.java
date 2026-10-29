package com.cloudbase.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Date;

@Service
public class JwtService {

    private final SecretKey key;
    private final long expirationMs;

    public JwtService(
            @Value("${jwt.secret}") String secret,
            @Value("${jwt.expiration-ms:86400000}") long expirationMs
    ) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expirationMs = expirationMs;
    }

    /**
     * Session token. The "pwd" claim is a one-way fingerprint of the password hash at issue time:
     * changing or resetting the password invalidates every session token issued before it.
     */
    public String generateToken(String userId, String role, String passwordHash) {
        return Jwts.builder()
                .subject(userId)
                .claim("role", role)
                .claim("pwd", passwordFingerprint(passwordHash))
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + expirationMs))
                .signWith(key)
                .compact();
    }

    /** True when the session token was issued for the user's current password. */
    public boolean isCurrentForPassword(Claims claims, String passwordHash) {
        String claimed = claims.get("pwd", String.class);
        return claimed != null && MessageDigest.isEqual(
                claimed.getBytes(StandardCharsets.UTF_8), passwordFingerprint(passwordHash).getBytes(StandardCharsets.UTF_8));
    }

    public long getExpirationMs() {
        return expirationMs;
    }

    public long getExpiresInSeconds() {
        return Math.max(1L, expirationMs / 1000L);
    }

    public Date getExpiration(String token) {
        return parseToken(token).getExpiration();
    }

    /**
     * Short-lived password-reset token (30 minutes), bound to the user's current password hash
     * so it stops working once the password changes (single use).
     */
    public String generatePasswordResetToken(String userId, String currentPasswordHash) {
        return Jwts.builder()
                .subject(userId)
                .claim("purpose", "password_reset")
                .claim("pwf", passwordFingerprint(currentPasswordHash))
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + 30 * 60 * 1000L))
                .signWith(key)
                .compact();
    }

    public String parsePasswordResetUserId(String token) {
        return passwordResetClaims(token).getSubject();
    }

    /** True when the token was issued against this exact password hash (i.e. not used yet). */
    public boolean isPasswordResetTokenCurrent(String token, String currentPasswordHash) {
        String issuedFor = passwordResetClaims(token).get("pwf", String.class);
        return issuedFor != null && MessageDigest.isEqual(
                issuedFor.getBytes(StandardCharsets.UTF_8),
                passwordFingerprint(currentPasswordHash).getBytes(StandardCharsets.UTF_8)
        );
    }

    private Claims passwordResetClaims(String token) {
        Claims claims = parseToken(token);
        if (!"password_reset".equals(claims.get("purpose", String.class))) {
            throw new IllegalArgumentException("Invalid password reset token");
        }
        return claims;
    }

    /** Keyed digest so the token never carries anything derived from the hash an attacker could use offline. */
    private String passwordFingerprint(String passwordHash) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            byte[] digest = mac.doFinal((passwordHash == null ? "" : passwordHash).getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }

    /** Short-lived CSRF state for GitHub OAuth (bound to CloudBase userId). */
    public String generateOAuthState(String userId) {
        return Jwts.builder()
                .subject(userId)
                .claim("purpose", "github_oauth")
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + 10 * 60 * 1000L))
                .signWith(key)
                .compact();
    }

    public String parseOAuthStateUserId(String state) {
        Claims claims = parseToken(state);
        if (!"github_oauth".equals(claims.get("purpose", String.class))) {
            throw new IllegalArgumentException("Invalid OAuth state purpose");
        }
        return claims.getSubject();
    }

    public Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public String extractUserId(String token) {
        return parseToken(token).getSubject();
    }

    public boolean isTokenValid(String token) {
        try {
            parseToken(token);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
