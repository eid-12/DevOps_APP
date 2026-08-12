package com.cloudbase.service;

import org.springframework.http.HttpStatus;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Validates container-side volume mount paths.
 * Host bind path is always platform-controlled ({@code volumeRoot/user/project/service});
 * users only choose where that volume appears inside their container.
 */
public final class VolumeMountValidator {

    private static final Pattern SAFE = Pattern.compile("^/[A-Za-z0-9._][A-Za-z0-9._/-]{0,198}$");

    /** Paths that would break the container OS or look like host escapes. */
    private static final List<String> BLOCKED_EXACT = List.of(
            "/", "/bin", "/boot", "/dev", "/etc", "/lib", "/lib64",
            "/proc", "/root", "/run", "/sbin", "/sys", "/usr", "/var/run"
    );

    private static final List<String> BLOCKED_PREFIX = List.of(
            "/bin/", "/boot/", "/dev/", "/etc/", "/lib/", "/lib64/",
            "/proc/", "/root/", "/run/", "/sbin/", "/sys/", "/usr/", "/var/run/"
    );

    private VolumeMountValidator() {
    }

    public static String normalizeAndValidate(String raw) {
        if (!StringUtils.hasText(raw)) {
            throw bad("Mount path is required when a volume is enabled.");
        }
        String path = raw.trim().replace('\\', '/');
        while (path.contains("//")) {
            path = path.replace("//", "/");
        }
        if (path.length() > 1 && path.endsWith("/")) {
            path = path.substring(0, path.length() - 1);
        }
        if (!path.startsWith("/")) {
            throw bad("Mount path must be absolute inside the container (start with /).");
        }
        if (path.contains("..") || path.contains(":") || path.contains(" ") || path.contains("\n") || path.contains("\t")) {
            throw bad("Mount path contains illegal characters.");
        }
        if (!SAFE.matcher(path).matches()) {
            throw bad("Mount path may only use letters, digits, '.', '_', '-', and '/'.");
        }

        String lower = path.toLowerCase(Locale.ROOT);
        if (BLOCKED_EXACT.contains(lower)) {
            throw bad("Cannot mount over system path: " + path);
        }
        for (String prefix : BLOCKED_PREFIX) {
            if (lower.startsWith(prefix)) {
                throw bad("Cannot mount under system path: " + path);
            }
        }
        return path;
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
