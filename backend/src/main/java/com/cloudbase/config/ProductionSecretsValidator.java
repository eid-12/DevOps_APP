package com.cloudbase.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.Arrays;

/**
 * Refuse to boot a production profile with development default secrets.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ProductionSecretsValidator implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(ProductionSecretsValidator.class);
    private static final String DEFAULT_JWT = "cloudbase-dev-secret-min-32chars-padding";
    private static final String DEFAULT_JWT_COMPOSE = "cloudbase-prod-secret-min-32chars-padding";
    private static final String DEFAULT_DB = "cloudbase_secret";

    private final Environment environment;

    public ProductionSecretsValidator(Environment environment) {
        this.environment = environment;
    }

    @Override
    public void run(ApplicationArguments args) {
        boolean prod = Arrays.stream(environment.getActiveProfiles())
                .anyMatch(p -> "prod".equalsIgnoreCase(p) || "production".equalsIgnoreCase(p));
        boolean required = environment.getProperty("cloudbase.require-prod-secrets", Boolean.class, false);
        if (!prod && !required) {
            log.info("Production secret checks skipped (profile is not prod).");
            return;
        }

        String jwt = environment.getProperty("jwt.secret", "");
        String dbPass = environment.getProperty("spring.datasource.password", "");
        String webhook = environment.getProperty("github.webhook-secret", "");

        if (jwt.isBlank() || jwt.equals(DEFAULT_JWT) || jwt.equals(DEFAULT_JWT_COMPOSE) || jwt.length() < 32) {
            throw new IllegalStateException(
                    "Set JWT_SECRET to a random value of at least 32 characters before starting production."
            );
        }
        if (dbPass.isBlank() || dbPass.equals(DEFAULT_DB)) {
            throw new IllegalStateException("Set DB_PASS to a non-default password before starting production.");
        }
        if (webhook.isBlank()) {
            throw new IllegalStateException(
                    "Set GITHUB_WEBHOOK_SECRET before starting production. Empty webhook secrets are rejected."
            );
        }
        log.info("Production secrets check passed.");
    }
}
