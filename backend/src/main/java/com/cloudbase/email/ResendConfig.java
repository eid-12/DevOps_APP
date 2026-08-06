package com.cloudbase.email;

import com.resend.Resend;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(ResendProperties.class)
public class ResendConfig {

    @Bean
    @ConditionalOnProperty(prefix = "resend", name = "enabled", havingValue = "true")
    public Resend resendClient(ResendProperties properties) {
        if (properties.apiKey() == null || properties.apiKey().isBlank()) {
            throw new IllegalStateException("resend.enabled=true but resend.api-key is empty");
        }
        return new Resend(properties.apiKey());
    }
}
