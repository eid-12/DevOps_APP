package com.cloudbase.labmail;

import com.cloudbase.email.EmailService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/**
 * Isolated lab only, loaded from outside the JAR by lab.py --email: delivers verification codes to files in the
 * container so the tests can act as the inbox. Addresses starting with "undeliverable" simulate a provider failure.
 */
@Configuration
public class LabMailConfig {

    @Bean
    @Primary
    public EmailService labEmailService() {
        return (EmailService) Proxy.newProxyInstance(EmailService.class.getClassLoader(), new Class<?>[]{EmailService.class}, (p, m, a) -> {
            if (m.getName().equals("hashCode")) return System.identityHashCode(p);
            if (m.getName().equals("equals")) return p == a[0];
            if (m.getName().equals("toString")) return "LabEmailService";
            if (m.getName().equals("isEnabled")) return true;
            if (m.getName().equals("sendEmailVerificationCode")) {
                String to = (String) a[0];
                if (to.startsWith("undeliverable")) throw new IllegalStateException("Failed to send email: lab provider down");
                Files.createDirectories(Path.of("/tmp/lab-mail"));
                Files.writeString(Path.of("/tmp/lab-mail", to), (String) a[2]);
            }
            if (m.getName().equals("sendRegistrationPending") && ((String) a[0]).startsWith("welcomefail")) {
                throw new IllegalStateException("Failed to send email: lab provider down");
            }
            return m.getReturnType() == Map.class ? Map.of() : null;
        });
    }
}
