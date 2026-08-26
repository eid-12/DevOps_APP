package com.cloudbase.controller;

import com.cloudbase.dto.PublicDtos.PlatformStatusResponse;
import com.cloudbase.service.AdminService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Unauthenticated endpoints for the marketing landing page (live Mini PC metrics).
 * Cached and rate-limited so anonymous callers cannot hammer Portainer/NPM.
 */
@RestController
@RequestMapping("/api/public")
public class PublicController {

    private static final long CACHE_TTL_MS = 45_000L;
    private static final int RATE_LIMIT = 30;
    private static final long RATE_WINDOW_MS = 60_000L;

    private final AdminService adminService;
    private final AtomicReference<CachedStatus> cache = new AtomicReference<>();
    private final ConcurrentHashMap<String, RateWindow> windows = new ConcurrentHashMap<>();

    public PublicController(AdminService adminService) {
        this.adminService = adminService;
    }

    @GetMapping("/platform-status")
    public PlatformStatusResponse platformStatus(HttpServletRequest request) {
        enforceRateLimit(clientIp(request));
        long now = System.currentTimeMillis();
        CachedStatus hit = cache.get();
        if (hit != null && now - hit.atMs < CACHE_TTL_MS) {
            return hit.body;
        }
        PlatformStatusResponse body = adminService.platformStatus();
        cache.set(new CachedStatus(now, body));
        return body;
    }

    private void enforceRateLimit(String ip) {
        long now = System.currentTimeMillis();
        RateWindow window = windows.compute(ip, (key, existing) -> {
            if (existing == null || now - existing.windowStartMs >= RATE_WINDOW_MS) {
                return new RateWindow(now, 1);
            }
            existing.count++;
            return existing;
        });
        if (window.count > RATE_LIMIT) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many requests");
        }
    }

    private static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            int comma = forwarded.indexOf(',');
            return (comma < 0 ? forwarded : forwarded.substring(0, comma)).trim();
        }
        String ip = request.getRemoteAddr();
        return ip == null || ip.isBlank() ? "unknown" : ip;
    }

    private record CachedStatus(long atMs, PlatformStatusResponse body) {
    }

    private static final class RateWindow {
        private final long windowStartMs;
        private int count;

        private RateWindow(long windowStartMs, int count) {
            this.windowStartMs = windowStartMs;
            this.count = count;
        }
    }
}
