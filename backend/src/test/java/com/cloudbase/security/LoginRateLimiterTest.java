package com.cloudbase.security;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class LoginRateLimiterTest {

    private final MutableClock clock = new MutableClock(Instant.parse("2026-10-29T08:00:00Z"));
    private final LoginRateLimiter limiter = new LoginRateLimiter(clock);

    private void fail(String email, String ip, int times) {
        for (int i = 0; i < times; i++) {
            limiter.recordFailure(email, ip);
        }
    }

    private void assertLocked(String email, String ip) {
        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> limiter.checkAllowed(email, ip));
        assertEquals(429, ex.getStatusCode().value());
    }

    @Test
    void locksAnEmailAndIpPairAfterRepeatedFailures() {
        fail("a@x.com", "1.1.1.1", LoginRateLimiter.MAX_PER_PAIR - 1);
        assertDoesNotThrow(() -> limiter.checkAllowed("a@x.com", "1.1.1.1"));
        fail("a@x.com", "1.1.1.1", 1);
        assertLocked("a@x.com", "1.1.1.1");
    }

    @Test
    void emailCasingAndWhitespaceCannotBypassTheLimit() {
        for (int i = 0; i < LoginRateLimiter.MAX_PER_PAIR; i++) {
            limiter.recordFailure(i % 2 == 0 ? "A@X.com" : "  a@x.COM ", "1.1.1.1");
        }
        assertLocked("a@x.com", "1.1.1.1");
    }

    @Test
    void attackerOnOneNetworkDoesNotLockTheOwnerOutFromTheirs() {
        fail("victim@x.com", "6.6.6.6", LoginRateLimiter.MAX_PER_PAIR);
        assertLocked("victim@x.com", "6.6.6.6");
        assertDoesNotThrow(() -> limiter.checkAllowed("victim@x.com", "2.2.2.2"));
    }

    @Test
    void guessingSpreadOverManyIpsIsStillCappedPerEmail() {
        for (int i = 0; i < LoginRateLimiter.MAX_PER_EMAIL; i++) {
            limiter.recordFailure("victim@x.com", "10.0.0." + i);
        }
        assertLocked("victim@x.com", "203.0.113.9");
    }

    @Test
    void successClearsOnlyItsOwnPairNotProtectionForOtherAccountsOrTheEmail() {
        // Spraying one IP across many accounts...
        for (int i = 0; i < LoginRateLimiter.MAX_PER_IP - 1; i++) {
            limiter.recordFailure("user" + i + "@x.com", "9.9.9.9");
        }
        // ...then logging into the attacker's own account from that IP must not reset the IP-wide count.
        limiter.clearFailures("attacker@x.com", "9.9.9.9");
        limiter.recordFailure("one-more@x.com", "9.9.9.9");
        assertLocked("anyone@x.com", "9.9.9.9");

        // A success also leaves the email-wide counter (spread over other IPs) in place.
        for (int i = 0; i < LoginRateLimiter.MAX_PER_EMAIL - 1; i++) {
            limiter.recordFailure("victim@x.com", "10.1.0." + i);
        }
        limiter.clearFailures("victim@x.com", "10.1.0.0");
        limiter.recordFailure("victim@x.com", "10.1.0.200");
        assertLocked("victim@x.com", "198.51.100.1");
    }

    @Test
    void sharedIpUsersAreNotLockedOutByOneAccountsFailures() {
        fail("forgetful@x.com", "100.64.0.1", LoginRateLimiter.MAX_PER_PAIR);
        assertDoesNotThrow(() -> limiter.checkAllowed("colleague@x.com", "100.64.0.1"));
    }

    @Test
    void locksExpire() {
        fail("a@x.com", "1.1.1.1", LoginRateLimiter.MAX_PER_PAIR);
        assertLocked("a@x.com", "1.1.1.1");
        clock.plus(LoginRateLimiter.WINDOW.plusSeconds(1));
        assertDoesNotThrow(() -> limiter.checkAllowed("a@x.com", "1.1.1.1"));
    }

    private static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant start) {
            this.now = start;
        }

        void plus(Duration d) {
            now = now.plus(d);
        }

        @Override
        public Instant instant() {
            return now;
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }
    }
}
