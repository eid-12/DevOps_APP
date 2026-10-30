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

    /** Fault injection around GitHub setup, driven by flag files in the lab API container; simulates GitHub itself. */
    @Bean
    public static org.springframework.beans.factory.config.BeanPostProcessor labCiFaults() {
        return new org.springframework.beans.factory.config.BeanPostProcessor() {
            @Override
            public Object postProcessAfterInitialization(Object bean, String name) {
                if (!(bean instanceof com.cloudbase.service.CiBootstrapService)) return bean;
                return Proxy.newProxyInstance(bean.getClass().getClassLoader(), new Class<?>[]{com.cloudbase.service.CiBootstrapService.class}, (p, m, a) -> {
                    if (!m.getName().equals("bootstrapGitHubService")) return m.invoke(bean, a);
                    if (Files.deleteIfExists(Path.of("/tmp/lab-halt-before-ci"))) Runtime.getRuntime().halt(137);
                    Files.writeString(Path.of("/tmp/lab-ci-calls"), "x", java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
                    if (Files.exists(Path.of("/tmp/lab-ci-fail"))) throw new IllegalStateException("simulated GitHub failure");
                    if (Files.deleteIfExists(Path.of("/tmp/lab-halt-after-ci"))) Runtime.getRuntime().halt(137);
                    Map<String, Object> d = new java.util.HashMap<>(((com.cloudbase.entity.ServiceEntity) a[1]).getSourceDetails());
                    d.put("ciBootstrapped", true);
                    d.put("imageName", "synthetic/app");
                    return d;
                });
            }
        };
    }

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
