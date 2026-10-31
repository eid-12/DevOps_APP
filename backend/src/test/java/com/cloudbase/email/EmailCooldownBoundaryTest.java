package com.cloudbase.email;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Resend cooldown boundaries with a controlled clock: a refused request must not extend the wait. */
class EmailCooldownBoundaryTest {

    private Instant now = Instant.parse("2026-10-30T12:00:00Z");
    private final EmailRateLimiter limiter = new EmailRateLimiter(new Clock() {
        @Override public ZoneId getZone() { return ZoneId.of("UTC"); }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    });

    private void send() {
        limiter.acquireSend(EmailRateLimiter.Action.VERIFICATION, "a@b.test", "1.1.1.1");
    }

    @Test
    void refusedRequestsDoNotExtendTheCooldown() {
        send();
        now = now.plusSeconds(55);
        ResponseStatusException e = assertThrows(ResponseStatusException.class, this::send);
        assertTrue(e.getReason().contains("wait 5 seconds"), e.getReason());
        now = now.plusSeconds(5);
        assertDoesNotThrow(this::send);
    }

    @Test
    void advertisedWaitCoversTheEntireRemainingCooldown() {
        send();
        now = now.plusMillis(54_500);
        ResponseStatusException e = assertThrows(ResponseStatusException.class, this::send);
        assertTrue(e.getReason().contains("wait 6 seconds"), e.getReason());
        now = now.plusSeconds(6);
        assertDoesNotThrow(this::send);
    }

    @Test
    void unknownInboxAdvertisesTheSameRoundedUpCooldown() {
        limiter.noteUnknownInbox(EmailRateLimiter.Action.VERIFICATION, "unknown@b.test");
        now = now.plusMillis(54_500);
        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> limiter.noteUnknownInbox(EmailRateLimiter.Action.VERIFICATION, "unknown@b.test"));
        assertTrue(e.getReason().contains("wait 6 seconds"), e.getReason());
    }

    @Test
    void backwardWallClockStepReproducesAnExtendedWaitWithoutAnotherSend() {
        send();
        // 5 seconds setup + 61 seconds browser wait, but a 10-second wall-clock rollback.
        now = now.plusSeconds(66).minusMillis(10_072);
        ResponseStatusException e = assertThrows(ResponseStatusException.class, this::send);
        assertTrue(e.getReason().contains("wait 5 seconds"), e.getReason());
        now = now.plusSeconds(5);
        assertDoesNotThrow(this::send);
    }

    @Test
    void lastSecondStillWaitsAtLeastOneSecond() {
        send();
        now = now.plus(Duration.ofMillis(59_500));
        ResponseStatusException e = assertThrows(ResponseStatusException.class, this::send);
        assertTrue(e.getReason().contains("wait 1 seconds"), e.getReason());
    }
}
