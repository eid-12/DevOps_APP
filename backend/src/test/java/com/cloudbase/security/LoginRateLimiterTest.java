package com.cloudbase.security;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class LoginRateLimiterTest {

    @Test
    void locksAnEmailAfterTooManyFailures() {
        MutableClock clock = new MutableClock(Instant.parse("2026-10-29T08:00:00Z"));
        LoginRateLimiter limiter = new LoginRateLimiter(clock);

        for (int i = 0; i < LoginRateLimiter.MAX_PER_EMAIL; i++) {
            assertDoesNotThrow(() -> limiter.checkAllowed("a@x.com", "1.1.1.1"));
            limiter.recordFailure("a@x.com", "1.1.1.1");
        }
        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> limiter.checkAllowed("a@x.com", "1.1.1.1"));
        assertEquals(429, ex.getStatusCode().value());
    }

    @Test
    void lockExpiresAndSuccessClearsFailures() {
        MutableClock clock = new MutableClock(Instant.parse("2026-10-29T08:00:00Z"));
        LoginRateLimiter limiter = new LoginRateLimiter(clock);

        for (int i = 0; i < LoginRateLimiter.MAX_PER_EMAIL; i++) {
            limiter.recordFailure("a@x.com", "1.1.1.1");
        }
        clock.plus(LoginRateLimiter.LOCK.plusSeconds(1));
        assertDoesNotThrow(() -> limiter.checkAllowed("a@x.com", "1.1.1.1"));

        // A success mid-way clears the counter so a legitimate user is never locked by old failures.
        limiter.recordFailure("b@x.com", "2.2.2.2");
        limiter.clearFailures("b@x.com");
        for (int i = 0; i < LoginRateLimiter.MAX_PER_EMAIL - 1; i++) {
            limiter.recordFailure("b@x.com", "2.2.2.2");
        }
        assertDoesNotThrow(() -> limiter.checkAllowed("b@x.com", "2.2.2.2"));
    }

    @Test
    void oneIpLocksOutEvenWhenSprayingDifferentEmails() {
        MutableClock clock = new MutableClock(Instant.parse("2026-10-29T08:00:00Z"));
        LoginRateLimiter limiter = new LoginRateLimiter(clock);

        for (int i = 0; i < LoginRateLimiter.MAX_PER_IP; i++) {
            limiter.recordFailure("user" + i + "@x.com", "9.9.9.9");
        }
        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> limiter.checkAllowed("fresh@x.com", "9.9.9.9"));
        assertEquals(429, ex.getStatusCode().value());
    }

    /** Minimal adjustable clock, matching the style of EmailRateLimiterTest. */
    private static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant start) {
            this.now = start;
        }

        void plus(java.time.Duration d) {
            now = now.plus(d);
        }

        @Override
        public Instant instant() {
            return now;
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }
    }
}
