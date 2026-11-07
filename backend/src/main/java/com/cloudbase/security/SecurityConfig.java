package com.cloudbase.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.util.matcher.AnyRequestMatcher;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final JwtAuthFilter jwtAuthFilter;

    private final JsonSecurityErrorHandler securityErrorHandler;

    public SecurityConfig(JwtAuthFilter jwtAuthFilter, JsonSecurityErrorHandler securityErrorHandler) {
        this.jwtAuthFilter = jwtAuthFilter;
        this.securityErrorHandler = securityErrorHandler;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            // TLS ends at Cloudflare/NPM, so the API sees plain HTTP and Spring would skip HSTS. The API is only
            // published over HTTPS; browsers ignore the header on plain-HTTP local runs.
            .headers(h -> h.httpStrictTransportSecurity(hsts -> hsts
                .requestMatcher(AnyRequestMatcher.INSTANCE)
                .maxAgeInSeconds(31536000)))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/login", "/api/auth/register").permitAll()
                .requestMatchers("/api/auth/forgot-password", "/api/auth/reset-password").permitAll()
                .requestMatchers("/api/auth/verify-email", "/api/auth/resend-verification").permitAll()
                .requestMatchers("/api/auth/github/callback").permitAll()
                .requestMatchers("/api/webhooks/**").permitAll()
                .requestMatchers("/api/public/**").permitAll()
                .requestMatchers("/ws/**").permitAll()
                .requestMatchers("/actuator/health", "/actuator/info").permitAll()
                .requestMatchers("/actuator/**").hasRole("ADMIN")
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            )
            // Default would be an empty 403 for a missing/expired token; the SPA logs out only on 401.
            .exceptionHandling(e -> e
                .authenticationEntryPoint(securityErrorHandler)
                .accessDeniedHandler(securityErrorHandler)
            )
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    /**
     * BCrypt reads only the first 72 bytes, so a longer password would match any password sharing that prefix
     * (CVE-2025-22228). Such passwords never match and are never stored, whatever the library version does.
     */
    @Bean
    public PasswordEncoder passwordEncoder() {
        BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder();
        return new PasswordEncoder() {
            @Override
            public String encode(CharSequence raw) {
                if (raw == null || PasswordPolicy.exceedsBcryptLimit(raw.toString())) {
                    throw new IllegalArgumentException("password cannot be more than " + PasswordPolicy.MAX_BYTES + " bytes");
                }
                return bcrypt.encode(raw);
            }

            @Override
            public boolean matches(CharSequence raw, String encoded) {
                if (raw == null || PasswordPolicy.exceedsBcryptLimit(raw.toString())) return false;
                return bcrypt.matches(raw, encoded);
            }

            @Override
            public boolean upgradeEncoding(String encoded) {
                return bcrypt.upgradeEncoding(encoded);
            }
        };
    }
}
