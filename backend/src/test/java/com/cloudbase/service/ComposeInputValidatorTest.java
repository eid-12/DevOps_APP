package com.cloudbase.service;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ComposeInputValidatorTest {

    @Test
    void acceptsRealImageReferences() {
        for (String image : List.of("nginx", "nginx:1.27-alpine", "nginxdemos/hello", "minipcer/cloudbase-web:a1b2c3d",
                "ghcr.io/org/app:v1.2.3", "registry.example.com:5000/team/app", "library/postgres:16-alpine",
                "org/app@sha256:" + "a".repeat(64), "my_org/my-app__x:latest")) {
            assertDoesNotThrow(() -> ComposeInputValidator.requireImage(image), image);
        }
        assertDoesNotThrow(() -> ComposeInputValidator.requireImageTag("a1b2c3d"));
        assertDoesNotThrow(() -> ComposeInputValidator.requireEnvKey("DATABASE_URL"));
        assertDoesNotThrow(() -> ComposeInputValidator.requireEnvKey("_private1"));
    }

    @Test
    void rejectsValuesThatCouldBreakOutOfAYamlScalar() {
        for (String image : List.of("nginx\nprivileged: true", "nginx latest", "nginx:latest\"", "Nginx", "nginx#x",
                "nginx:", "/nginx", "nginx//app", "")) {
            assertThrows(IllegalArgumentException.class, () -> ComposeInputValidator.requireImage(image), image);
        }
        for (String tag : List.of("latest\nx: y", "-latest", "a b", "a:b", "x".repeat(129))) {
            assertThrows(IllegalArgumentException.class, () -> ComposeInputValidator.requireImageTag(tag), tag);
        }
        for (String key : List.of("A B", "A:B", "1ABC", "A\nB", "A-B", "")) {
            assertThrows(IllegalArgumentException.class, () -> ComposeInputValidator.requireEnvKey(key), key);
        }
    }
}
