package com.cloudbase.github;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * GitHub Contents + Hooks APIs used for CloudBase CI bootstrap (B2).
 */
@Component
public class GitHubRepoClient {

    private static final Logger log = LoggerFactory.getLogger(GitHubRepoClient.class);
    private static final ParameterizedTypeReference<Map<String, Object>> MAP =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<List<Map<String, Object>>> LIST_MAP =
            new ParameterizedTypeReference<>() {};

    private final WebClient webClient;

    public GitHubRepoClient(WebClient.Builder webClientBuilder) {
        this.webClient = webClientBuilder.build();
    }

    public record OwnerRepo(String owner, String repo) {}

    public static OwnerRepo parseOwnerRepo(String repositoryUrl) {
        if (!StringUtils.hasText(repositoryUrl)) {
            throw GitHubOAuthException.badRequest("bad_repo", "Repository URL is required");
        }
        String u = repositoryUrl.trim()
                .replace("git@github.com:", "https://github.com/")
                .replace("ssh://git@github.com/", "https://github.com/");
        if (u.endsWith(".git")) {
            u = u.substring(0, u.length() - 4);
        }
        if (u.endsWith("/")) {
            u = u.substring(0, u.length() - 1);
        }
        int idx = u.toLowerCase(Locale.ROOT).indexOf("github.com/");
        if (idx < 0) {
            throw GitHubOAuthException.badRequest("bad_repo", "Only GitHub repositories are supported");
        }
        String path = u.substring(idx + "github.com/".length());
        String[] parts = path.split("/");
        if (parts.length < 2 || !StringUtils.hasText(parts[0]) || !StringUtils.hasText(parts[1])) {
            throw GitHubOAuthException.badRequest("bad_repo", "Could not parse owner/repo from URL");
        }
        return new OwnerRepo(parts[0], parts[1]);
    }

    public Optional<String> getFileSha(String accessToken, String owner, String repo, String path) {
        try {
            Map<String, Object> body = webClient.get()
                    .uri(contentsUri(owner, repo, path))
                    .headers(h -> auth(h, accessToken))
                    .retrieve()
                    .bodyToMono(MAP)
                    .block();
            if (body == null || body.get("sha") == null) {
                return Optional.empty();
            }
            return Optional.of(String.valueOf(body.get("sha")));
        } catch (WebClientResponseException.NotFound e) {
            return Optional.empty();
        } catch (WebClientResponseException e) {
            log.warn("getFileSha {}/{}/{} HTTP {}: {}", owner, repo, path, e.getStatusCode().value(), e.getResponseBodyAsString());
            throw GitHubOAuthException.badGateway("github_contents_error",
                    "Failed to read " + path + " (HTTP " + e.getStatusCode().value() + ")");
        }
    }

    public boolean fileExists(String accessToken, String owner, String repo, String path) {
        return getFileSha(accessToken, owner, repo, path).isPresent();
    }

    /** Read a text file from the default branch (Contents API). Empty if missing. */
    public Optional<String> getTextFile(String accessToken, String owner, String repo, String path) {
        try {
            Map<String, Object> body = webClient.get()
                    .uri(contentsUri(owner, repo, path))
                    .headers(h -> auth(h, accessToken))
                    .retrieve()
                    .bodyToMono(MAP)
                    .block();
            if (body == null || body.get("content") == null) {
                return Optional.empty();
            }
            String encoding = String.valueOf(body.getOrDefault("encoding", "base64"));
            String content = String.valueOf(body.get("content")).replace("\n", "").replace("\r", "");
            if ("base64".equalsIgnoreCase(encoding)) {
                byte[] raw = Base64.getDecoder().decode(content);
                return Optional.of(new String(raw, StandardCharsets.UTF_8));
            }
            return Optional.of(String.valueOf(body.get("content")));
        } catch (WebClientResponseException.NotFound e) {
            return Optional.empty();
        } catch (WebClientResponseException e) {
            log.warn("getTextFile {}/{}/{} HTTP {}: {}", owner, repo, path, e.getStatusCode().value(), e.getResponseBodyAsString());
            return Optional.empty();
        } catch (Exception e) {
            log.warn("getTextFile {}/{}/{} failed: {}", owner, repo, path, e.toString());
            return Optional.empty();
        }
    }

    /**
     * Create or update a text file via Contents API.
     * @return true if a new file was created, false if updated/skipped
     */
    public boolean putTextFile(
            String accessToken,
            String owner,
            String repo,
            String path,
            String content,
            String message,
            String branch,
            boolean overwrite
    ) {
        Optional<String> existingSha = getFileSha(accessToken, owner, repo, path);
        if (existingSha.isPresent() && !overwrite) {
            return false;
        }

        Map<String, Object> body = new HashMap<>();
        body.put("message", message);
        body.put("content", Base64.getEncoder().encodeToString(content.getBytes(StandardCharsets.UTF_8)));
        body.put("branch", branch);
        existingSha.ifPresent(sha -> body.put("sha", sha));

        try {
            webClient.put()
                    .uri(contentsUri(owner, repo, path))
                    .headers(h -> auth(h, accessToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(MAP)
                    .block();
            return existingSha.isEmpty();
        } catch (WebClientResponseException e) {
            log.error("putTextFile {}/{}/{} HTTP {}: {}", owner, repo, path, e.getStatusCode().value(), e.getResponseBodyAsString());
            String hint = "";
            if (e.getStatusCode().value() == 404 && path != null && path.contains(".github/workflows/")) {
                hint = " — reconnect GitHub and allow the workflow scope";
            }
            throw GitHubOAuthException.badGateway("github_contents_write_error",
                    "Failed to write " + path + " (HTTP " + e.getStatusCode().value() + ")" + hint);
        }
    }

    public void ensureWebhook(
            String accessToken,
            String owner,
            String repo,
            String webhookUrl,
            String secret,
            List<String> events
    ) {
        if (!StringUtils.hasText(webhookUrl)) {
            log.warn("Skipping webhook registration - public API URL is empty");
            return;
        }

        List<Map<String, Object>> hooks;
        try {
            hooks = webClient.get()
                    .uri("https://api.github.com/repos/{owner}/{repo}/hooks", owner, repo)
                    .headers(h -> auth(h, accessToken))
                    .retrieve()
                    .bodyToMono(LIST_MAP)
                    .block();
        } catch (WebClientResponseException e) {
            throw GitHubOAuthException.badGateway("github_hooks_list_error",
                    "Failed to list webhooks (HTTP " + e.getStatusCode().value() + ")");
        }

        if (hooks != null) {
            for (Map<String, Object> hook : hooks) {
                Object config = hook.get("config");
                if (config instanceof Map<?, ?> cfg) {
                    Object url = cfg.get("url");
                    if (url != null && webhookUrl.equalsIgnoreCase(String.valueOf(url))) {
                        log.info("Webhook already present on {}/{} → {}", owner, repo, webhookUrl);
                        return;
                    }
                }
            }
        }

        Map<String, Object> config = new HashMap<>();
        config.put("url", webhookUrl);
        config.put("content_type", "json");
        config.put("insecure_ssl", "0");
        if (StringUtils.hasText(secret)) {
            config.put("secret", secret);
        }

        Map<String, Object> body = new HashMap<>();
        body.put("name", "web");
        body.put("active", true);
        body.put("events", events);
        body.put("config", config);

        try {
            webClient.post()
                    .uri("https://api.github.com/repos/{owner}/{repo}/hooks", owner, repo)
                    .headers(h -> auth(h, accessToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(MAP)
                    .block();
            log.info("Registered webhook on {}/{} → {}", owner, repo, webhookUrl);
        } catch (WebClientResponseException e) {
            if (e.getStatusCode().value() == HttpStatus.UNPROCESSABLE_ENTITY.value()) {
                log.warn("Webhook may already exist on {}/{}: {}", owner, repo, e.getResponseBodyAsString());
                return;
            }
            throw GitHubOAuthException.badGateway("github_hooks_create_error",
                    "Failed to create webhook (HTTP " + e.getStatusCode().value() + ")");
        }
    }

    public void putActionsSecret(
            String accessToken,
            String owner,
            String repo,
            String secretName,
            String secretValue,
            GitHubSecretEncryptor encryptor
    ) {
        if (!StringUtils.hasText(secretValue)) {
            return;
        }
        Map<String, Object> keyResp;
        try {
            keyResp = webClient.get()
                    .uri("https://api.github.com/repos/{owner}/{repo}/actions/secrets/public-key", owner, repo)
                    .headers(h -> auth(h, accessToken))
                    .retrieve()
                    .bodyToMono(MAP)
                    .block();
        } catch (WebClientResponseException e) {
            log.warn("Cannot read Actions public key for {}/{}: HTTP {}", owner, repo, e.getStatusCode().value());
            return;
        }
        if (keyResp == null || keyResp.get("key") == null || keyResp.get("key_id") == null) {
            return;
        }

        String encrypted;
        try {
            encrypted = encryptor.encrypt(String.valueOf(keyResp.get("key")), secretValue);
        } catch (Exception e) {
            log.warn("Failed to encrypt Actions secret {}: {}", secretName, e.toString());
            return;
        }

        Map<String, Object> body = Map.of(
                "encrypted_value", encrypted,
                "key_id", String.valueOf(keyResp.get("key_id"))
        );
        try {
            webClient.put()
                    .uri("https://api.github.com/repos/{owner}/{repo}/actions/secrets/{name}", owner, repo, secretName)
                    .headers(h -> auth(h, accessToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .toBodilessEntity()
                    .block();
            log.info("Set Actions secret {} on {}/{}", secretName, owner, repo);
        } catch (WebClientResponseException e) {
            log.warn("Failed to set Actions secret {} on {}/{}: HTTP {} {}",
                    secretName, owner, repo, e.getStatusCode().value(), e.getResponseBodyAsString());
        }
    }

    /**
     * Trigger {@code workflow_dispatch} for a workflow file (e.g. CloudBase deploy).
     * User stays in CloudBase — no need to open the Actions UI.
     */
    public void dispatchWorkflow(
            String accessToken,
            String owner,
            String repo,
            String workflowFile,
            String ref
    ) {
        if (!StringUtils.hasText(accessToken) || !StringUtils.hasText(workflowFile)) {
            throw GitHubOAuthException.badRequest("bad_workflow", "Workflow dispatch requires a token and workflow file");
        }
        String branch = StringUtils.hasText(ref) ? ref : "main";
        Map<String, Object> body = Map.of("ref", branch);
        try {
            webClient.post()
                    .uri("https://api.github.com/repos/{owner}/{repo}/actions/workflows/{file}/dispatches",
                            owner, repo, workflowFile)
                    .headers(h -> auth(h, accessToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .toBodilessEntity()
                    .block();
            log.info("Dispatched workflow {} on {}/{} @{}", workflowFile, owner, repo, branch);
        } catch (WebClientResponseException e) {
            log.warn("workflow_dispatch {}/{}/{} HTTP {}: {}",
                    owner, repo, workflowFile, e.getStatusCode().value(), e.getResponseBodyAsString());
            if (e.getStatusCode() == HttpStatus.NOT_FOUND) {
                throw GitHubOAuthException.badGateway("workflow_not_found",
                        "Deploy workflow not found yet. Wait a few seconds and Redeploy.");
            }
            if (e.getStatusCode() == HttpStatus.UNAUTHORIZED || e.getStatusCode() == HttpStatus.FORBIDDEN) {
                throw GitHubOAuthException.unauthorized("workflow_forbidden",
                        "GitHub permission missing. Connect GitHub once on Account, then Redeploy.");
            }
            throw GitHubOAuthException.badGateway("workflow_dispatch_error",
                    "Could not start the build (HTTP " + e.getStatusCode().value() + ")");
        }
    }

    private static void auth(HttpHeaders h, String accessToken) {
        h.set(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken);
        h.set(HttpHeaders.ACCEPT, "application/vnd.github+json");
        h.set("X-GitHub-Api-Version", "2022-11-28");
        h.set(HttpHeaders.USER_AGENT, "CloudBase-CI");
    }

    /** Build Contents API URI without encoding {@code /} as {@code %2F} (GitHub 404s that). */
    private static URI contentsUri(String owner, String repo, String path) {
        StringBuilder sb = new StringBuilder("https://api.github.com/repos/");
        sb.append(enc(owner)).append('/').append(enc(repo)).append("/contents/");
        String[] parts = path == null ? new String[0] : path.split("/");
        boolean first = true;
        for (String part : parts) {
            if (part == null || part.isBlank()) {
                continue;
            }
            if (!first) {
                sb.append('/');
            }
            first = false;
            sb.append(enc(part));
        }
        return URI.create(sb.toString());
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
