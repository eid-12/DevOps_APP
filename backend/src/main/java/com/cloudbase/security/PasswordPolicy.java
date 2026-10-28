package com.cloudbase.security;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Single password rule for every path that sets a password (register, reset, change).
 * Mirrors the SPA check in the auth/account forms; the server is the one that counts.
 */
public final class PasswordPolicy {

    public static final String MESSAGE =
            "Password must be at least 8 characters and include upper, lower, digit, and special character";

    private PasswordPolicy() {
    }

    public static boolean isStrong(String password) {
        if (password == null || password.length() < 8) return false;
        boolean upper = false, lower = false, digit = false, special = false;
        for (int i = 0; i < password.length(); i++) {
            char c = password.charAt(i);
            if (Character.isUpperCase(c)) upper = true;
            else if (Character.isLowerCase(c)) lower = true;
            else if (Character.isDigit(c)) digit = true;
            else special = true;
        }
        return upper && lower && digit && special;
    }

    public static void require(String password) {
        if (!isStrong(password)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, MESSAGE);
        }
    }
}
