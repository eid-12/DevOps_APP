package com.cloudbase.security;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Throttles failed logins so passwords cannot be brute-forced (BCrypt alone is not a lockout).
 *
 * <ul>
 *   <li>Per email + client IP: 8 failures lock that pair. This is the main guard and does not affect the
 *       same account from other networks, so an attacker cannot easily lock a user out of their own account.</li>
 *   <li>Per email across all IPs: 30 failures, against guessing spread over many addresses.</li>
 *   <li>Per IP across all emails: 100 failures, against password spraying, high enough for users behind a
 *       shared NAT.</li>
 * </ul>
 * A successful login clears only its own email + IP pair; it never resets the email-wide or IP-wide
 * counters, so it cannot wipe protection against attacks on other accounts or from other networks.
 * Emails are compared case-insensitively. Client IPs come from {@link ClientIpResolver}.
 */
@Component
public class LoginRateLimiter {

    static final int MAX_PER_PAIR = 8;
    static final int MAX_PER_EMAIL = 30;
    static final int MAX_PER_IP = 100;
    static final Duration WINDOW = Duration.ofMinutes(15);

    private final Clock clock;
    private final Object lock = new Object();
    private final Map<String, Bucket> byPair = new ConcurrentHashMap<>();
    private final Map<String, Bucket> byEmail = new ConcurrentHashMap<>();
    private final Map<String, Bucket> byIp = new ConcurrentHashMap<>();

    public LoginRateLimiter() {
        this(Clock.systemUTC());
    }

    LoginRateLimiter(Clock clock) {
        this.clock = clock;
    }

    public void checkAllowed(String email) {
        checkAllowed(email, ClientIpResolver.current());
    }

    public void recordFailure(String email) {
        recordFailure(email, ClientIpResolver.current());
    }

    public void clearFailures(String email) {
        clearFailures(email, ClientIpResolver.current());
    }

    void checkAllowed(String email, String ip) {
        Instant now = clock.instant();
        synchronized (lock) {
            if (isLocked(byPair.get(pair(email, ip)), now)
                    || isLocked(byEmail.get(normalize(email)), now)
                    || isLocked(byIp.get(normalize(ip)), now)) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Too many failed attempts. Try again in a few minutes.");
            }
        }
    }

    void recordFailure(String email, String ip) {
        Instant now = clock.instant();
        synchronized (lock) {
            bump(byPair.computeIfAbsent(pair(email, ip), k -> new Bucket()), now, MAX_PER_PAIR);
            bump(byEmail.computeIfAbsent(normalize(email), k -> new Bucket()), now, MAX_PER_EMAIL);
            bump(byIp.computeIfAbsent(normalize(ip), k -> new Bucket()), now, MAX_PER_IP);
        }
    }

    void clearFailures(String email, String ip) {
        synchronized (lock) {
            byPair.remove(pair(email, ip));
        }
    }

    private static boolean isLocked(Bucket b, Instant now) {
        return b != null && b.lockedUntil != null && now.isBefore(b.lockedUntil);
    }

    private static void bump(Bucket b, Instant now, int max) {
        if (isLocked(b, now)) {
            return;
        }
        if (b.windowStart == null || Duration.between(b.windowStart, now).compareTo(WINDOW) > 0) {
            b.windowStart = now;
            b.count = 0;
            b.lockedUntil = null;
        }
        if (++b.count >= max) {
            b.lockedUntil = now.plus(WINDOW);
        }
    }

    private static String pair(String email, String ip) {
        return normalize(email) + "|" + normalize(ip);
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private static final class Bucket {
        Instant windowStart;
        int count;
        Instant lockedUntil;
    }
}
