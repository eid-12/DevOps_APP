package com.cloudbase.email;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "resend")
public record ResendProperties(
        String apiKey,
        boolean enabled,
        String from,
        String domain,
        String adminNotify,
        String appBaseUrl,
        boolean ensureDomain
) {
    public ResendProperties {
        if (apiKey == null) apiKey = "";
        if (from == null || from.isBlank()) {
            from = "CloudBase <noreply@mawrid.cloudbase.website>";
        }
        if (domain == null || domain.isBlank()) {
            domain = "mawrid.cloudbase.website";
        }
        if (adminNotify == null) adminNotify = "";
        if (appBaseUrl == null || appBaseUrl.isBlank()) {
            appBaseUrl = "http://localhost:4200";
        }
    }

    public boolean isReady() {
        return enabled && apiKey != null && !apiKey.isBlank();
    }
}
