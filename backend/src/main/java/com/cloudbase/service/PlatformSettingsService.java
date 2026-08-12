package com.cloudbase.service;

import com.cloudbase.dto.AdminDtos.HostingSettingsResponse;
import com.cloudbase.dto.AdminDtos.HostingSettingsUpdateRequest;
import com.cloudbase.entity.PlatformSettingEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.repository.PlatformSettingRepository;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Runtime platform/hosting config: env defaults + DB overrides.
 * Secrets are never returned in clear text; blank update fields keep the current value.
 */
@Service
public class PlatformSettingsService {

    public static final String PORTAINER_URL = "portainer.url";
    public static final String PORTAINER_API_KEY = "portainer.api-key";
    public static final String PORTAINER_ENDPOINT_ID = "portainer.endpoint-id";

    public static final String NPM_ENABLED = "npm.enabled";
    public static final String NPM_URL = "npm.url";
    public static final String NPM_EMAIL = "npm.email";
    public static final String NPM_PASSWORD = "npm.password";
    public static final String NPM_CERTIFICATE_ID = "npm.certificate-id";
    public static final String NPM_SSL_FORCED = "npm.ssl-forced";

    public static final String GITHUB_CLIENT_ID = "github.oauth.client-id";
    public static final String GITHUB_CLIENT_SECRET = "github.oauth.client-secret";
    public static final String GITHUB_REDIRECT_URI = "github.oauth.redirect-uri";
    public static final String GITHUB_SCOPES = "github.oauth.scopes";
    public static final String GITHUB_WEBHOOK_SECRET = "github.webhook-secret";

    public static final String DOCKERHUB_USERNAME = "dockerhub.username";
    public static final String DOCKERHUB_TOKEN = "dockerhub.token";
    public static final String DOCKERHUB_NAMESPACE = "cloudbase.dockerhub.namespace";

    public static final String BASE_DOMAIN = "cloudbase.base-domain";
    public static final String PUBLIC_API_URL = "cloudbase.public-api-url";
    public static final String DOCKER_NETWORK = "cloudbase.docker.network";
    public static final String VOLUME_ROOT = "cloudbase.volume.root";

    private final PlatformSettingRepository repository;
    private final Map<String, String> defaults = new ConcurrentHashMap<>();
    private final Map<String, String> overrides = new ConcurrentHashMap<>();
    private final List<Runnable> listeners = new CopyOnWriteArrayList<>();

    public PlatformSettingsService(
            PlatformSettingRepository repository,
            @Value("${portainer.url:http://localhost:9000}") String portainerUrl,
            @Value("${portainer.api-key:}") String portainerApiKey,
            @Value("${portainer.endpoint-id:1}") String portainerEndpointId,
            @Value("${npm.enabled:false}") String npmEnabled,
            @Value("${npm.url:http://localhost:81}") String npmUrl,
            @Value("${npm.email:}") String npmEmail,
            @Value("${npm.password:}") String npmPassword,
            @Value("${npm.certificate-id:0}") String npmCertificateId,
            @Value("${npm.ssl-forced:false}") String npmSslForced,
            @Value("${github.oauth.client-id:}") String githubClientId,
            @Value("${github.oauth.client-secret:}") String githubClientSecret,
            @Value("${github.oauth.redirect-uri:http://localhost:4200/auth/github/callback}") String githubRedirectUri,
            @Value("${github.oauth.scopes:read:user repo user:email workflow}") String githubScopes,
            @Value("${github.webhook-secret:}") String githubWebhookSecret,
            @Value("${dockerhub.username:}") String dockerHubUsername,
            @Value("${dockerhub.token:}") String dockerHubToken,
            @Value("${cloudbase.dockerhub.namespace:cloudbase}") String dockerHubNamespace,
            @Value("${cloudbase.base-domain:cloudbase.website}") String baseDomain,
            @Value("${cloudbase.public-api-url:}") String publicApiUrl,
            @Value("${cloudbase.docker.network:cloudbase}") String dockerNetwork,
            @Value("${cloudbase.volume.root:/var/lib/cloudbase/users}") String volumeRoot
    ) {
        this.repository = repository;
        putDefault(PORTAINER_URL, portainerUrl);
        putDefault(PORTAINER_API_KEY, portainerApiKey);
        putDefault(PORTAINER_ENDPOINT_ID, portainerEndpointId);
        putDefault(NPM_ENABLED, npmEnabled);
        putDefault(NPM_URL, npmUrl);
        putDefault(NPM_EMAIL, npmEmail);
        putDefault(NPM_PASSWORD, npmPassword);
        putDefault(NPM_CERTIFICATE_ID, npmCertificateId);
        putDefault(NPM_SSL_FORCED, npmSslForced);
        putDefault(GITHUB_CLIENT_ID, githubClientId);
        putDefault(GITHUB_CLIENT_SECRET, githubClientSecret);
        putDefault(GITHUB_REDIRECT_URI, githubRedirectUri);
        putDefault(GITHUB_SCOPES, githubScopes);
        putDefault(GITHUB_WEBHOOK_SECRET, githubWebhookSecret);
        putDefault(DOCKERHUB_USERNAME, dockerHubUsername);
        putDefault(DOCKERHUB_TOKEN, dockerHubToken);
        putDefault(DOCKERHUB_NAMESPACE, dockerHubNamespace);
        putDefault(BASE_DOMAIN, baseDomain);
        putDefault(PUBLIC_API_URL, publicApiUrl);
        putDefault(DOCKER_NETWORK, dockerNetwork);
        putDefault(VOLUME_ROOT, volumeRoot);
    }

    @PostConstruct
    void loadOverrides() {
        for (PlatformSettingEntity row : repository.findAll()) {
            if (row.getKey() != null && row.getValue() != null) {
                overrides.put(row.getKey(), row.getValue());
            }
        }
        notifyListeners();
    }

    public void addChangeListener(Runnable listener) {
        if (listener != null) {
            listeners.add(listener);
        }
    }

    private void notifyListeners() {
        for (Runnable listener : listeners) {
            try {
                listener.run();
            } catch (Exception ignored) {
                // keep applying remaining listeners
            }
        }
    }

    public String get(String key) {
        String override = overrides.get(key);
        if (override != null) {
            return override;
        }
        return defaults.getOrDefault(key, "");
    }

    /** True when a DB override row exists for this key (even if empty). */
    public boolean hasOverride(String key) {
        return overrides.containsKey(key);
    }

    public boolean getBoolean(String key) {
        return Boolean.parseBoolean(get(key));
    }

    public int getInt(String key, int fallback) {
        try {
            return Integer.parseInt(get(key).trim());
        } catch (Exception e) {
            return fallback;
        }
    }

    public HostingSettingsResponse view() {
        return new HostingSettingsResponse(
                get(PORTAINER_URL),
                configured(PORTAINER_API_KEY),
                hint(PORTAINER_API_KEY),
                get(PORTAINER_ENDPOINT_ID),
                getBoolean(NPM_ENABLED),
                get(NPM_URL),
                get(NPM_EMAIL),
                configured(NPM_PASSWORD),
                hint(NPM_PASSWORD),
                get(NPM_CERTIFICATE_ID),
                getBoolean(NPM_SSL_FORCED),
                get(GITHUB_CLIENT_ID),
                configured(GITHUB_CLIENT_SECRET),
                hint(GITHUB_CLIENT_SECRET),
                get(GITHUB_REDIRECT_URI),
                get(GITHUB_SCOPES),
                configured(GITHUB_WEBHOOK_SECRET),
                hint(GITHUB_WEBHOOK_SECRET),
                get(DOCKERHUB_USERNAME),
                configured(DOCKERHUB_TOKEN),
                hint(DOCKERHUB_TOKEN),
                get(DOCKERHUB_NAMESPACE),
                get(BASE_DOMAIN),
                get(PUBLIC_API_URL),
                get(DOCKER_NETWORK),
                get(VOLUME_ROOT)
        );
    }

    @Transactional
    public HostingSettingsResponse update(UserEntity actor, HostingSettingsUpdateRequest req) {
        Map<String, String> next = new LinkedHashMap<>();
        putIfPresent(next, PORTAINER_URL, req.portainerUrl());
        putSecretIfPresent(next, PORTAINER_API_KEY, req.portainerApiKey());
        putIfPresent(next, PORTAINER_ENDPOINT_ID, req.portainerEndpointId());

        if (req.npmEnabled() != null) {
            next.put(NPM_ENABLED, String.valueOf(req.npmEnabled()));
        }
        putIfPresent(next, NPM_URL, req.npmUrl());
        putIfPresent(next, NPM_EMAIL, req.npmEmail());
        putSecretIfPresent(next, NPM_PASSWORD, req.npmPassword());
        putIfPresent(next, NPM_CERTIFICATE_ID, req.npmCertificateId());
        if (req.npmSslForced() != null) {
            next.put(NPM_SSL_FORCED, String.valueOf(req.npmSslForced()));
        }

        putIfPresent(next, GITHUB_CLIENT_ID, req.githubClientId());
        putSecretIfPresent(next, GITHUB_CLIENT_SECRET, req.githubClientSecret());
        putIfPresent(next, GITHUB_REDIRECT_URI, req.githubRedirectUri());
        putIfPresent(next, GITHUB_SCOPES, req.githubScopes());
        putSecretIfPresent(next, GITHUB_WEBHOOK_SECRET, req.githubWebhookSecret());

        putIfPresent(next, DOCKERHUB_USERNAME, req.dockerHubUsername());
        putSecretIfPresent(next, DOCKERHUB_TOKEN, req.dockerHubToken());
        putIfPresent(next, DOCKERHUB_NAMESPACE, req.dockerHubNamespace());

        putIfPresent(next, BASE_DOMAIN, req.baseDomain());
        putIfPresent(next, PUBLIC_API_URL, req.publicApiUrl());
        putIfPresent(next, DOCKER_NETWORK, req.dockerNetwork());
        putIfPresent(next, VOLUME_ROOT, req.volumeRoot());

        String actorLabel = actor != null ? actor.getEmail() : "admin";
        if (next.isEmpty()) {
            return view();
        }
        for (Map.Entry<String, String> e : next.entrySet()) {
            overrides.put(e.getKey(), e.getValue());
            repository.save(PlatformSettingEntity.builder()
                    .key(e.getKey())
                    .value(e.getValue())
                    .updatedBy(actorLabel)
                    .build());
        }

        notifyListeners();
        return view();
    }

    private void putDefault(String key, String value) {
        defaults.put(key, value == null ? "" : value);
    }

    private boolean configured(String key) {
        return StringUtils.hasText(get(key));
    }

    private String hint(String key) {
        String value = get(key);
        if (!StringUtils.hasText(value)) {
            return "";
        }
        String trimmed = value.trim();
        if (trimmed.length() <= 4) {
            return "••••";
        }
        return "…" + trimmed.substring(trimmed.length() - 4);
    }

    private static void putIfPresent(Map<String, String> target, String key, String value) {
        // Blank means "keep current" (same as secrets) — never wipe env/DB defaults by accident.
        if (!StringUtils.hasText(value)) {
            return;
        }
        target.put(key, value.trim());
    }

    private static void putSecretIfPresent(Map<String, String> target, String key, String value) {
        if (!StringUtils.hasText(value)) {
            return;
        }
        target.put(key, value.trim());
    }
}
