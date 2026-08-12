package com.cloudbase.email;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory limits so verification / password-reset emails cannot be spammed.
 * Survives only for the JVM lifetime (fine for single-instance deploy).
 */
@Service
public class EmailRateLimiter {

    public enum Action {
        VERIFICATION,
        PASSWORD_RESET
    }

    private static final Duration COOLDOWN = Duration.ofSeconds(60);
    private static final Duration WINDOW = Duration.ofHours(1);
    private static final int MAX_PER_WINDOW = 5;
    private static final int MAX_VERIFY_FAILURES = 5;
    private static final Duration VERIFY_LOCK = Duration.ofMinutes(15);

    private final Map<String, SendBucket> sends = new ConcurrentHashMap<>();
    private final Map<String, VerifyBucket> verifies = new ConcurrentHashMap<>();

    /** Record a successful outbound email (register / resend / forgot). */
    public void recordSend(Action action, String email) {
        String key = key(action, email);
        Instant now = Instant.now();
        sends.compute(key, (k, existing) -> {
            SendBucket b = existing == null ? new SendBucket() : existing;
            if (b.windowStart == null || now.isAfter(b.windowStart.plus(WINDOW))) {
                b.windowStart = now;
                b.count = 0;
            }
            b.count++;
            b.lastSentAt = now;
            return b;
        });
    }

    /**
     * Block another send if cooldown or hourly cap is exceeded.
     * Call <strong>before</strong> generating a new code / token.
     */
    public void checkCanSend(Action action, String email) {
        String key = key(action, email);
        Instant now = Instant.now();
        SendBucket b = sends.get(key);
        if (b == null || b.lastSentAt == null) {
            return;
        }

        Instant cooldownEnds = b.lastSentAt.plus(COOLDOWN);
        if (now.isBefore(cooldownEnds)) {
            long wait = Math.max(1, Duration.between(now, cooldownEnds).getSeconds());
            throw new ResponseStatusException(
                    HttpStatus.TOO_MANY_REQUESTS,
                    "Please wait " + wait + " seconds before requesting another email."
            );
        }

        if (b.windowStart != null && !now.isAfter(b.windowStart.plus(WINDOW)) && b.count >= MAX_PER_WINDOW) {
            Instant windowEnds = b.windowStart.plus(WINDOW);
            long waitMin = Math.max(1, Duration.between(now, windowEnds).toMinutes());
            throw new ResponseStatusException(
                    HttpStatus.TOO_MANY_REQUESTS,
                    "Too many emails sent. Try again in about " + waitMin + " minute(s)."
            );
        }
    }

    /** Wrong verification code - after several failures the code is locked. */
    public void checkVerifyAllowed(String email) {
        VerifyBucket b = verifies.get(normalize(email));
        if (b == null) {
            return;
        }
        Instant now = Instant.now();
        if (b.lockedUntil != null && now.isBefore(b.lockedUntil)) {
            long wait = Math.max(1, Duration.between(now, b.lockedUntil).getSeconds());
            throw new ResponseStatusException(
                    HttpStatus.TOO_MANY_REQUESTS,
                    "Too many wrong codes. Request a new code in " + wait + " seconds."
            );
        }
    }

    /** @return true if the account should invalidate the current code (hit max failures). */
    public boolean recordVerifyFailure(String email) {
        String key = normalize(email);
        Instant now = Instant.now();
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

    private static String key(Action action, String email) {
        return action.name() + ":" + normalize(email);
    }

    private static String normalize(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
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
