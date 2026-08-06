package com.cloudbase.github;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.concurrent.TimeUnit;

/**
 * Encrypts GitHub Actions secrets using libsodium sealed box via PyNaCl.
 */
@Component
public class GitHubSecretEncryptor {

    private static final Logger log = LoggerFactory.getLogger(GitHubSecretEncryptor.class);

    public String encrypt(String publicKeyBase64, String secretValue) {
        Path script = resolveScript();
        if (script == null || !Files.isRegularFile(script)) {
            throw new IllegalStateException("github_secret_encrypt.py not found");
        }
        try {
            ProcessBuilder pb = new ProcessBuilder(
                    "python",
                    script.toAbsolutePath().toString(),
                    publicKeyBase64,
                    secretValue
            );
            pb.redirectErrorStream(true);
            Process p = pb.start();
            String out;
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                out = reader.lines().reduce("", (a, b) -> a.isEmpty() ? b : a + "\n" + b).trim();
            }
            boolean finished = p.waitFor(20, TimeUnit.SECONDS);
            if (!finished) {
                p.destroyForcibly();
                throw new IllegalStateException("Secret encryption timed out");
            }
            if (p.exitValue() != 0 || out.isBlank()) {
                throw new IllegalStateException("Secret encryption failed: " + out);
            }
            return out.lines().reduce((a, b) -> b).orElse(out).trim();
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            log.error("GitHub secret encryption failed", e);
            throw new IllegalStateException("GitHub secret encryption failed: " + e.getMessage(), e);
        }
    }

    private static Path resolveScript() {
        Path[] candidates = new Path[] {
                Paths.get("scripts", "github_secret_encrypt.py"),
                Paths.get("backend", "scripts", "github_secret_encrypt.py"),
                Paths.get(System.getProperty("user.dir", "."), "scripts", "github_secret_encrypt.py"),
                Paths.get(System.getProperty("user.dir", "."), "backend", "scripts", "github_secret_encrypt.py")
        };
        for (Path p : candidates) {
            if (Files.isRegularFile(p)) {
                return p.toAbsolutePath().normalize();
            }
        }
        // DevOps_APP_run junction / OneDrive layout
        Path fromClass = Paths.get("").toAbsolutePath();
        Path sibling = fromClass.resolve("scripts").resolve("github_secret_encrypt.py");
        if (Files.isRegularFile(sibling)) return sibling;
        return sibling;
    }
}
