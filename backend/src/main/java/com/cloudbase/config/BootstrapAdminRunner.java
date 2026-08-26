package com.cloudbase.config;

import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.AccountStatus;
import com.cloudbase.model.UserRole;
import com.cloudbase.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * Creates or promotes the first administrator when no ADMIN exists yet.
 * Set CLOUDBASE_BOOTSTRAP_ADMIN_EMAIL and CLOUDBASE_BOOTSTRAP_ADMIN_PASSWORD.
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class BootstrapAdminRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(BootstrapAdminRunner.class);

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final String email;
    private final String password;

    public BootstrapAdminRunner(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            @Value("${cloudbase.bootstrap.admin-email:}") String email,
            @Value("${cloudbase.bootstrap.admin-password:}") String password
    ) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.email = email == null ? "" : email.trim().toLowerCase();
        this.password = password == null ? "" : password;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (email.isBlank() || password.isBlank()) {
            return;
        }
        if (userRepository.existsByRole(UserRole.ADMIN)) {
            log.info("Admin bootstrap skipped — an administrator already exists.");
            return;
        }
        if (password.length() < 8) {
            throw new IllegalStateException("CLOUDBASE_BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters.");
        }

        UserEntity user = userRepository.findByEmail(email).orElse(null);
        if (user == null) {
            user = UserEntity.builder()
                    .id("u-" + UUID.randomUUID().toString().substring(0, 8))
                    .name(nameFromEmail(email))
                    .email(email)
                    .passwordHash(passwordEncoder.encode(password))
                    .role(UserRole.ADMIN)
                    .accountStatus(AccountStatus.ACTIVE)
                    .deploymentEnabled(true)
                    .emailVerified(true)
                    .build();
            userRepository.save(user);
            log.info("Created first administrator from bootstrap env: {}", email);
            return;
        }

        user.setRole(UserRole.ADMIN);
        user.setAccountStatus(AccountStatus.ACTIVE);
        user.setDeploymentEnabled(true);
        user.setEmailVerified(true);
        user.setPasswordHash(passwordEncoder.encode(password));
        userRepository.save(user);
        log.info("Promoted existing user to administrator from bootstrap env: {}", email);
    }

    private static String nameFromEmail(String email) {
        String local = email.contains("@") ? email.substring(0, email.indexOf('@')) : email;
        if (local.isBlank()) {
            return "Administrator";
        }
        return local.replace('.', ' ').replace('_', ' ');
    }
}
