package com.cloudbase.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
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
     * Session token. "sv" is the user's session version at issue time (a server-side counter, nothing
     * derived from the password): a password change or reset increments it and revokes earlier tokens.
     */
    public String generateToken(String userId, String role, int sessionVersion) {
        return Jwts.builder()
                .subject(userId)
                .claim("role", role)
                .claim("sv", sessionVersion)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + expirationMs))
                .signWith(key)
                .compact();
    }

    /** True when the token was issued at the user's current session version (tokens without one are stale). */
    public boolean isCurrentSession(Claims claims, int sessionVersion) {
        Integer issued = claims.get("sv", Integer.class);
        return issued != null && issued == sessionVersion;
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
     * Short-lived password-reset token (30 minutes), bound to the user's current session version
     * so it stops working once any password is set (single use).
     */
    public String generatePasswordResetToken(String userId, int sessionVersion) {
        return Jwts.builder()
                .subject(userId)
                .claim("purpose", "password_reset")
                .claim("sv", sessionVersion)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + 30 * 60 * 1000L))
                .signWith(key)
                .compact();
    }

    public String parsePasswordResetUserId(String token) {
        return passwordResetClaims(token).getSubject();
    }

    /** True when the reset link was issued at the user's current session version (i.e. not used yet). */
    public boolean isPasswordResetTokenCurrent(String token, int sessionVersion) {
        return isCurrentSession(passwordResetClaims(token), sessionVersion);
    }

    private Claims passwordResetClaims(String token) {
        Claims claims = parseToken(token);
        if (!"password_reset".equals(claims.get("purpose", String.class))) {
            throw new IllegalArgumentException("Invalid password reset token");
        }
        return claims;
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
