package com.cloudbase.security;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;
import org.springframework.stereotype.Component;

/**
 * Encrypts {@code users.github_access_token} on write and decrypts on read, so the rest of the code keeps
 * working with plain tokens. Spring-managed: Hibernate obtains it from the application context.
 */
@Component
@Converter
public class GitHubTokenConverter implements AttributeConverter<String, String> {

    private final TokenCipher cipher;

    public GitHubTokenConverter(TokenCipher cipher) {
        this.cipher = cipher;
    }

    @Override
    public String convertToDatabaseColumn(String token) {
        return cipher.encrypt(token);
    }

    @Override
    public String convertToEntityAttribute(String stored) {
        return cipher.decrypt(stored);
    }
}
