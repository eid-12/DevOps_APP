package com.cloudbase.email;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class EmailRateLimiterTest {

    @Test
    void oneInboxMaxFivePerHourEvenAcrossIps() {
        MutableClock clock = new MutableClock(Instant.parse("2026-08-27T08:00:00Z"));
        EmailRateLimiter limiter = new EmailRateLimiter(clock);
        for (int i = 0; i < 5; i++) {
            clock.plusSeconds(61);
            limiter.acquireSend(EmailRateLimiter.Action.VERIFICATION, "a@x.com", "1.1.1." + i);
        }
        clock.plusSeconds(61);
        ResponseStatusException ex = assertThrows(
                ResponseStatusException.class,
                () -> limiter.acquireSend(EmailRateLimiter.Action.VERIFICATION, "a@x.com", "9.9.9.9")
        );
        assertEquals(429, ex.getStatusCode().value());
    }

    @Test
    void cooldownBlocksSameInboxBeforeSixtySeconds() {
        MutableClock clock = new MutableClock(Instant.parse("2026-08-27T08:00:00Z"));
        EmailRateLimiter limiter = new EmailRateLimiter(clock);
        limiter.acquireSend(EmailRateLimiter.Action.VERIFICATION, "a@x.com", "1.1.1.1");
        clock.plusSeconds(30);
        ResponseStatusException ex = assertThrows(
                ResponseStatusException.class,
                () -> limiter.acquireSend(EmailRateLimiter.Action.VERIFICATION, "a@x.com", "1.1.1.1")
        );
        assertEquals(429, ex.getStatusCode().value());
    }

    @Test
    void fiftyDifferentInboxesCannotSendFiftyCodes() {
        MutableClock clock = new MutableClock(Instant.parse("2026-08-27T08:00:00Z"));
        EmailRateLimiter limiter = new EmailRateLimiter(clock);
        int sent = 0;
        int blocked = 0;
        for (int i = 0; i < 50; i++) {
            clock.plusSeconds(61);
            try {
                limiter.acquireSend(EmailRateLimiter.Action.VERIFICATION, "user" + i + "@x.com", "10.0.0." + (i % 250));
                sent++;
            } catch (ResponseStatusException e) {
                blocked++;
            }
        }
        assertEquals(EmailRateLimiter.MAX_GLOBAL, sent);
        assertEquals(50 - EmailRateLimiter.MAX_GLOBAL, blocked);
    }

    @Test
    void oneIpCannotBurnTheGlobalCapAlone() {
        MutableClock clock = new MutableClock(Instant.parse("2026-08-27T08:00:00Z"));
        EmailRateLimiter limiter = new EmailRateLimiter(clock);
        int sent = 0;
        for (int i = 0; i < 20; i++) {
            clock.plusSeconds(61);
            try {
                limiter.acquireSend(EmailRateLimiter.Action.VERIFICATION, "n" + i + "@x.com", "8.8.8.8");
                sent++;
            } catch (ResponseStatusException ignored) {
                break;
            }
        }
        assertEquals(EmailRateLimiter.MAX_PER_IP, sent);
    }

    @Test
    void unknownInboxDoesNotEatGlobalBudget() {
        MutableClock clock = new MutableClock(Instant.parse("2026-08-27T08:00:00Z"));
        EmailRateLimiter limiter = new EmailRateLimiter(clock);
        for (int i = 0; i < 30; i++) {
            clock.plusSeconds(61);
            limiter.noteUnknownInbox(EmailRateLimiter.Action.PASSWORD_RESET, "ghost" + i + "@x.com");
        }
        clock.plusSeconds(61);
        limiter.acquireSend(EmailRateLimiter.Action.VERIFICATION, "real@x.com", "1.1.1.1");
    }

    @Test
    void passwordResetHasItsOwnPerEmailBucket() {
        MutableClock clock = new MutableClock(Instant.parse("2026-08-27T08:00:00Z"));
        EmailRateLimiter limiter = new EmailRateLimiter(clock);
        clock.plusSeconds(61);
        assertDoesNotThrow(() -> limiter.acquireSend(EmailRateLimiter.Action.VERIFICATION, "a@x.com", "1.1.1.1"));
        clock.plusSeconds(61);
        assertDoesNotThrow(() -> limiter.acquireSend(EmailRateLimiter.Action.PASSWORD_RESET, "a@x.com", "1.1.1.1"));
    }

    private static final class MutableClock extends Clock {
        private Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        void plusSeconds(long seconds) {
            instant = instant.plusSeconds(seconds);
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
