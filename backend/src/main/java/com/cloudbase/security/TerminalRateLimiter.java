package com.cloudbase.security;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Caps terminal commands per user. Every command costs several Portainer/Docker calls on the shared host,
 * so an unbounded loop from one account would slow the control plane for everyone.
 * Sliding window: at most {@value #MAX_PER_WINDOW} commands in any {@link #WINDOW}.
 */
@Component
public class TerminalRateLimiter {

    static final int MAX_PER_WINDOW = 30;
    static final Duration WINDOW = Duration.ofMinutes(1);

    private final Clock clock;
    private final Map<String, Deque<Instant>> byUser = new ConcurrentHashMap<>();

    public TerminalRateLimiter() {
        this(Clock.systemUTC());
    }

    TerminalRateLimiter(Clock clock) {
        this.clock = clock;
    }

    public void acquire(String userId) {
        Instant now = clock.instant();
        Instant cutoff = now.minus(WINDOW);
        Deque<Instant> hits = byUser.computeIfAbsent(userId, k -> new ArrayDeque<>());
        synchronized (hits) {
            while (!hits.isEmpty() && !hits.peekFirst().isAfter(cutoff)) {
                hits.pollFirst();
            }
            if (hits.size() >= MAX_PER_WINDOW) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Too many terminal commands. Wait a minute and try again.");
            }
            hits.addLast(now);
        }
    }
}
