package com.cloudbase.email;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
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
 * Caps verification / password-reset mail so Resend cannot be flooded.
 * In-memory; one API replica. Restart clears the windows.
 *
 * <p>Slot is reserved <em>before</em> the HTTP send (fail closed). Parallel
 * requests share one lock so 50 signups cannot sneak past the global cap.
 */
@Service
public class EmailRateLimiter {

    public enum Action {
        VERIFICATION,
        PASSWORD_RESET
    }

    static final Duration COOLDOWN = Duration.ofSeconds(60);
    static final Duration WINDOW = Duration.ofHours(1);
    /** Same inbox, same action (register + resend share VERIFICATION). */
    static final int MAX_PER_EMAIL = 5;
    /** One client IP across register / resend / forgot. */
    static final int MAX_PER_IP = 8;
    /** Whole JVM: verification + password-reset combined. Hard stop under 50. */
    static final int MAX_GLOBAL = 20;
    static final int MAX_VERIFY_FAILURES = 5;
    static final Duration VERIFY_LOCK = Duration.ofMinutes(15);

    private final Clock clock;
    private final Object lock = new Object();
    private final Map<String, SendBucket> byEmail = new ConcurrentHashMap<>();
    private final Map<String, SendBucket> byIp = new ConcurrentHashMap<>();
    private final SendBucket global = new SendBucket();
    private final Map<String, VerifyBucket> verifies = new ConcurrentHashMap<>();

    public EmailRateLimiter() {
        this(Clock.systemUTC());
    }

    EmailRateLimiter(Clock clock) {
        this.clock = clock;
    }

    /**
     * Reserve one outbound auth email. Throws 429 if cooldown or any hourly cap is hit.
     */
    public void acquireSend(Action action, String email) {
        acquireSend(action, email, currentIp());
    }

    void acquireSend(Action action, String email, String ip) {
        Instant now = Instant.now(clock);
        String emailKey = key(action, email);
        String ipKey = normalize(ip).isEmpty() ? "unknown" : normalize(ip);

        synchronized (lock) {
            SendBucket emailBucket = byEmail.get(emailKey);
            if (emailBucket != null && emailBucket.lastSentAt != null) {
                Instant cooldownEnds = emailBucket.lastSentAt.plus(COOLDOWN);
                if (now.isBefore(cooldownEnds)) {
                    long wait = Math.max(1, Duration.between(now, cooldownEnds).getSeconds());
                    throw tooMany("Please wait " + wait + " seconds before requesting another email.");
                }
            }
            rejectIfCapped(emailBucket, now, MAX_PER_EMAIL, "Too many emails to this address. Try again in about ");
            rejectIfCapped(byIp.get(ipKey), now, MAX_PER_IP, "Too many emails from this network. Try again in about ");
            rejectIfCapped(global, now, MAX_GLOBAL, "Email sending is busy. Try again in about ");

            bump(byEmail.computeIfAbsent(emailKey, k -> new SendBucket()), now);
            bump(byIp.computeIfAbsent(ipKey, k -> new SendBucket()), now);
            bump(global, now);
        }
    }

    /**
     * Forgot-password for an address with no account: apply inbox cooldown/cap only.
     * Must not consume the global Resend budget.
     */
    public void noteUnknownInbox(Action action, String email) {
        Instant now = Instant.now(clock);
        String emailKey = key(action, email);
        synchronized (lock) {
            SendBucket emailBucket = byEmail.get(emailKey);
            if (emailBucket != null && emailBucket.lastSentAt != null) {
                Instant cooldownEnds = emailBucket.lastSentAt.plus(COOLDOWN);
                if (now.isBefore(cooldownEnds)) {
                    long wait = Math.max(1, Duration.between(now, cooldownEnds).getSeconds());
                    throw tooMany("Please wait " + wait + " seconds before requesting another email.");
                }
            }
            rejectIfCapped(emailBucket, now, MAX_PER_EMAIL, "Too many emails to this address. Try again in about ");
            bump(byEmail.computeIfAbsent(emailKey, k -> new SendBucket()), now);
        }
    }

    public void checkVerifyAllowed(String email) {
        VerifyBucket b = verifies.get(normalize(email));
        if (b == null) {
            return;
        }
        Instant now = Instant.now(clock);
        if (b.lockedUntil != null && now.isBefore(b.lockedUntil)) {
            long wait = Math.max(1, Duration.between(now, b.lockedUntil).getSeconds());
            throw tooMany("Too many wrong codes. Request a new code in " + wait + " seconds.");
        }
    }

    public boolean recordVerifyFailure(String email) {
        String key = normalize(email);
        Instant now = Instant.now(clock);
        VerifyBucket updated = verifies.compute(key, (k, existing) -> {
            VerifyBucket b = existing == null ? new VerifyBucket() : existing;
            if (b.lockedUntil != null && now.isAfter(b.lockedUntil)) {
                b.failures = 0;
                b.lockedUntil = null;
            }
            b.failures++;
            if (b.failures >= MAX_VERIFY_FAILURES) {
                b.lockedUntil = now.plus(VERIFY_LOCK);
            }
            return b;
        });
        return updated.failures >= MAX_VERIFY_FAILURES;
    }

    public void clearVerifyFailures(String email) {
        verifies.remove(normalize(email));
    }

    private static void rejectIfCapped(SendBucket b, Instant now, int max, String prefix) {
        if (b == null || b.windowStart == null) {
            return;
        }
        if (now.isAfter(b.windowStart.plus(WINDOW))) {
            return;
        }
        if (b.count >= max) {
            Instant windowEnds = b.windowStart.plus(WINDOW);
            long waitMin = Math.max(1, Duration.between(now, windowEnds).toMinutes());
            throw tooMany(prefix + waitMin + " minute(s).");
        }
    }

    private static void bump(SendBucket b, Instant now) {
        if (b.windowStart == null || now.isAfter(b.windowStart.plus(WINDOW))) {
            b.windowStart = now;
            b.count = 0;
        }
        b.count++;
        b.lastSentAt = now;
    }

    private static ResponseStatusException tooMany(String message) {
        return new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, message);
    }

    private static String key(Action action, String email) {
        return action.name() + ":" + normalize(email);
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private static String currentIp() {
        var attrs = RequestContextHolder.getRequestAttributes();
        if (attrs instanceof ServletRequestAttributes) {
            return clientIp(((ServletRequestAttributes) attrs).getRequest());
        }
        return "unknown";
    }

    static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            int comma = forwarded.indexOf(',');
            return (comma < 0 ? forwarded : forwarded.substring(0, comma)).trim();
        }
        String ip = request.getRemoteAddr();
        return ip == null || ip.isBlank() ? "unknown" : ip;
    }

    private static final class SendBucket {
        Instant lastSentAt;
        Instant windowStart;
        int count;
    }

    private static final class VerifyBucket {
        int failures;
        Instant lockedUntil;
    }
}
