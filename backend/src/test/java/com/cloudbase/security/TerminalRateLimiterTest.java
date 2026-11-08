package com.cloudbase.security;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class TerminalRateLimiterTest {

    private Instant now = Instant.parse("2026-01-01T00:00:00Z");
    private final TerminalRateLimiter limiter = new TerminalRateLimiter(new Clock() {
        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    });

    @Test
    void refusesCommandsBeyondTheWindowLimitUntilTheWindowSlides() {
        for (int i = 0; i < TerminalRateLimiter.MAX_PER_WINDOW; i++) {
            limiter.acquire("u-1");
        }
        ResponseStatusException e = assertThrows(ResponseStatusException.class, () -> limiter.acquire("u-1"));
        assertEquals(429, e.getStatusCode().value());

        now = now.plus(TerminalRateLimiter.WINDOW).plusSeconds(1);
        assertDoesNotThrow(() -> limiter.acquire("u-1"));
    }

    @Test
    void usersHaveSeparateBudgets() {
        for (int i = 0; i < TerminalRateLimiter.MAX_PER_WINDOW; i++) {
            limiter.acquire("u-1");
        }
        assertDoesNotThrow(() -> limiter.acquire("u-2"));
    }
}
