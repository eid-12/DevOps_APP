package com.cloudbase.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.net.URI;
import java.util.Arrays;
import java.util.List;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final List<String> allowedOrigins;

    public WebConfig(@Value("${cloudbase.cors.allowed-origins}") String allowedOrigins) {
        this.allowedOrigins = parseAllowedOrigins(allowedOrigins);
    }

    /** Exact browser origins allowed to call /api and open /ws. Shared with WebSocketConfig. */
    public List<String> allowedOrigins() {
        return allowedOrigins;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(allowedOrigins.toArray(String[]::new))
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .exposedHeaders("Authorization");
    }

    /**
     * Comma-separated list of exact origins (scheme://host[:port]). Wildcards, paths and blanks
     * are refused at startup so a typo cannot silently open the API to every site.
     */
    static List<String> parseAllowedOrigins(String raw) {
        List<String> origins = Arrays.stream(raw == null ? new String[0] : raw.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
        if (origins.isEmpty()) {
            throw new IllegalStateException("cloudbase.cors.allowed-origins must list at least one origin");
        }
        for (String origin : origins) {
            URI uri;
            try {
                uri = URI.create(origin);
            } catch (IllegalArgumentException e) {
                throw new IllegalStateException("Invalid CORS origin: " + origin, e);
            }
            boolean httpScheme = "http".equals(uri.getScheme()) || "https".equals(uri.getScheme());
            boolean bare = uri.getHost() != null
                    && (uri.getRawPath() == null || uri.getRawPath().isEmpty())
                    && uri.getRawQuery() == null
                    && uri.getRawFragment() == null
                    && uri.getRawUserInfo() == null;
            if (origin.contains("*") || !httpScheme || !bare) {
                throw new IllegalStateException(
                        "Invalid CORS origin '" + origin + "': use exact scheme://host[:port], no wildcards or paths");
            }
        }
        return origins;
    }
}
