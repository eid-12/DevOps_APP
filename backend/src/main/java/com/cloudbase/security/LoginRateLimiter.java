package com.cloudbase.security;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Throttles failed logins so passwords cannot be brute-forced. BCrypt is slow but not a substitute
 * for a lockout. Counts consecutive failures per email and per client IP; once a threshold is hit,
 * further attempts are rejected with 429 until the lock expires. A successful login clears the email.
 */
@Component
public class LoginRateLimiter {

    static final int MAX_PER_EMAIL = 8;
    static final int MAX_PER_IP = 40;
    static final Duration LOCK = Duration.ofMinutes(15);

    private final Clock clock;
    private final Object lock = new Object();
    private final Map<String, Bucket> byEmail = new ConcurrentHashMap<>();
    private final Map<String, Bucket> byIp = new ConcurrentHashMap<>();

    public LoginRateLimiter() {
        this(Clock.systemUTC());
    }

    LoginRateLimiter(Clock clock) {
        this.clock = clock;
    }

    /** Reject the attempt early if this email or IP is currently locked out. */
    public void checkAllowed(String email) {
        checkAllowed(email, currentIp());
    }

    /** Record one failed attempt; locks the email/IP once the threshold is reached. */
    public void recordFailure(String email) {
        recordFailure(email, currentIp());
    }

    /** Clear the email's failures after a successful login. */
    public void clearFailures(String email) {
        byEmail.remove(normalize(email));
    }

    void checkAllowed(String email, String ip) {
        Instant now = clock.instant();
        synchronized (lock) {
            if (isLocked(byEmail.get(normalize(email)), now) || isLocked(byIp.get(normalize(ip)), now)) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Too many failed attempts. Try again in a few minutes.");
            }
        }
    }

    void recordFailure(String email, String ip) {
        Instant now = clock.instant();
        synchronized (lock) {
            bump(byEmail.computeIfAbsent(normalize(email), k -> new Bucket()), now, MAX_PER_EMAIL);
            bump(byIp.computeIfAbsent(normalize(ip), k -> new Bucket()), now, MAX_PER_IP);
        }
    }

    private static boolean isLocked(Bucket b, Instant now) {
        return b != null && b.lockedUntil != null && now.isBefore(b.lockedUntil);
    }

    private void bump(Bucket b, Instant now, int max) {
        if (b.lockedUntil != null && now.isBefore(b.lockedUntil)) {
            return;
        }
        if (b.windowStart == null || Duration.between(b.windowStart, now).compareTo(LOCK) > 0) {
            b.windowStart = now;
            b.count = 0;
            b.lockedUntil = null;
        }
        b.count++;
        if (b.count >= max) {
            b.lockedUntil = now.plus(LOCK);
        }
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private static String currentIp() {
        var attrs = RequestContextHolder.getRequestAttributes();
        if (attrs instanceof ServletRequestAttributes sra) {
            HttpServletRequest request = sra.getRequest();
            String forwarded = request.getHeader("X-Forwarded-For");
            if (forwarded != null && !forwarded.isBlank()) {
                int comma = forwarded.indexOf(',');
                return (comma < 0 ? forwarded : forwarded.substring(0, comma)).trim();
            }
            String ip = request.getRemoteAddr();
            return ip == null || ip.isBlank() ? "unknown" : ip;
        }
        return "unknown";
    }

    private static final class Bucket {
        Instant windowStart;
        int count;
        Instant lockedUntil;
    }
}
