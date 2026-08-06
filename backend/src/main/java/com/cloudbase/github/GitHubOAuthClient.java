package com.cloudbase.github;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;
import reactor.core.publisher.Mono;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Talks to GitHub’s OAuth + REST APIs.
 * Client secret never leaves the server.
 */
@Component
public class GitHubOAuthClient {

    private static final Logger log = LoggerFactory.getLogger(GitHubOAuthClient.class);
    private static final ParameterizedTypeReference<Map<String, Object>> MAP =
            new ParameterizedTypeReference<>() {};

    private final WebClient webClient;
    private final GitHubOAuthProperties props;

    public GitHubOAuthClient(WebClient.Builder webClientBuilder, GitHubOAuthProperties props) {
        this.webClient = webClientBuilder.build();
        this.props = props;
    }

    public boolean isConfigured() {
        return StringUtils.hasText(props.clientId()) && StringUtils.hasText(props.clientSecret());
    }

    public String redirectUri() {
        return props.redirectUri();
    }

    public String scopesConfig() {
        return props.scopes();
    }

    public String buildAuthorizeUrl(String state) {
        requireConfigured();
        return UriComponentsBuilder
                .fromHttpUrl("https://github.com/login/oauth/authorize")
                .queryParam("client_id", props.clientId())
                .queryParam("redirect_uri", props.redirectUri())
                .queryParam("scope", props.scopes())
                .queryParam("state", state)
                .queryParam("allow_signup", "true")
                .build(true)
                .toUriString();
    }

    /**
     * POST https://github.com/login/oauth/access_token
     * Exchanges a one-time authorization code for an access token.
     */
    public TokenResponse exchangeCode(String code) {
        requireConfigured();
        if (!StringUtils.hasText(code)) {
            throw GitHubOAuthException.badRequest("missing_code", "Authorization code is required");
        }

        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("client_id", props.clientId());
        form.add("client_secret", props.clientSecret());
        form.add("code", code.trim());
        form.add("redirect_uri", props.redirectUri());

        Map<String, Object> body;
        try {
            body = webClient.post()
                    .uri("https://github.com/login/oauth/access_token")
                    .header(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(BodyInserters.fromFormData(form))
                    .retrieve()
                    .bodyToMono(MAP)
                    .block();
        } catch (GitHubOAuthException e) {
            throw e;
        } catch (WebClientResponseException e) {
            log.warn("GitHub token endpoint HTTP {}: {}", e.getStatusCode().value(), e.getResponseBodyAsString());
            throw GitHubOAuthException.badGateway(
                    "github_token_http_error",
                    "GitHub token exchange failed (HTTP " + e.getStatusCode().value() + ")"
            );
        } catch (WebClientRequestException e) {
            log.error("Cannot reach GitHub token endpoint", e);
            String detail = rootMessage(e);
            if (detail != null && detail.toLowerCase(Locale.ROOT).contains("pkix")) {
                throw GitHubOAuthException.badGateway(
                        "github_ssl_error",
                        "SSL trust failed talking to GitHub (often antivirus HTTPS scanning). Import the scanner root CA into the JVM truststore."
                );
            }
            throw GitHubOAuthException.badGateway(
                    "github_unreachable",
                    "Could not reach GitHub. Check network connectivity."
            );
        } catch (RuntimeException e) {
            throw unwrapOAuth(e);
        }

        if (body == null) {
            throw GitHubOAuthException.badGateway("empty_token_response", "Empty response from GitHub token endpoint");
        }

        // GitHub returns 200 even on OAuth errors, with { "error": "...", "error_description": "..." }
        if (body.get("error") != null) {
            throw mapTokenError(
                    String.valueOf(body.get("error")),
                    body.get("error_description") != null
                            ? String.valueOf(body.get("error_description"))
                            : String.valueOf(body.get("error"))
            );
        }

        Object tokenObj = body.get("access_token");
        if (tokenObj == null || !StringUtils.hasText(String.valueOf(tokenObj))) {
            throw GitHubOAuthException.badGateway(
                    "missing_access_token",
                    "GitHub did not return an access_token"
            );
        }

        String accessToken = String.valueOf(tokenObj);
        String scope = body.get("scope") != null ? String.valueOf(body.get("scope")) : props.scopes();
        String tokenType = body.get("token_type") != null ? String.valueOf(body.get("token_type")) : "bearer";
        return new TokenResponse(accessToken, scope, tokenType);
    }

    /**
     * GET https://api.github.com/user with Authorization: Bearer &lt;token&gt;
     */
    public GitHubUser fetchUser(String accessToken) {
        if (!StringUtils.hasText(accessToken)) {
            throw GitHubOAuthException.unauthorized("missing_token", "Access token is required");
        }

        Map<String, Object> body;
        try {
            body = webClient.get()
                    .uri("https://api.github.com/user")
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
                    .header(HttpHeaders.ACCEPT, "application/vnd.github+json")
                    .header("X-GitHub-Api-Version", "2022-11-28")
                    .header(HttpHeaders.USER_AGENT, "CloudBase-OAuth")
                    .retrieve()
                    .onStatus(
                            status -> status.value() == HttpStatus.UNAUTHORIZED.value(),
                            resp -> resp.bodyToMono(String.class).defaultIfEmpty("").flatMap(msg ->
                                    Mono.error(GitHubOAuthException.unauthorized(
                                            "invalid_token",
                                            "GitHub rejected the access token"
                                    ))
                            )
                    )
                    .onStatus(
                            status -> status.value() == HttpStatus.FORBIDDEN.value(),
                            resp -> resp.bodyToMono(String.class).defaultIfEmpty("").flatMap(msg ->
                                    Mono.error(GitHubOAuthException.badGateway(
                                            "github_forbidden",
                                            "GitHub API forbidden (rate limit or insufficient scopes)"
                                    ))
                            )
                    )
                    .bodyToMono(MAP)
                    .block();
        } catch (GitHubOAuthException e) {
            throw e;
        } catch (WebClientResponseException e) {
            log.warn("GitHub /user HTTP {}: {}", e.getStatusCode().value(), e.getResponseBodyAsString());
            throw GitHubOAuthException.badGateway(
                    "github_user_http_error",
                    "Failed to load GitHub profile (HTTP " + e.getStatusCode().value() + ")"
            );
        } catch (WebClientRequestException e) {
            log.error("Cannot reach GitHub API", e);
            throw GitHubOAuthException.badGateway(
                    "github_unreachable",
                    "Could not reach GitHub API. Check network connectivity."
            );
        } catch (RuntimeException e) {
            throw unwrapOAuth(e);
        }

        if (body == null || body.get("login") == null) {
            throw GitHubOAuthException.badGateway(
                    "invalid_user_payload",
                    "GitHub returned an incomplete user profile"
            );
        }

        String login = String.valueOf(body.get("login"));
        String avatar = body.get("avatar_url") != null ? String.valueOf(body.get("avatar_url")) : null;
        String name = body.get("name") != null ? String.valueOf(body.get("name")) : null;
        if (name != null && (name.isBlank() || "null".equalsIgnoreCase(name))) {
            name = null;
        }
        return new GitHubUser(login, avatar, name);
    }

    /**
     * GET https://api.github.com/user/repos — repos the token can access.
     */
    public List<GitHubRepo> listRepos(String accessToken) {
        if (!StringUtils.hasText(accessToken)) {
            throw GitHubOAuthException.unauthorized("missing_token", "Access token is required");
        }

        List<Map<String, Object>> body;
        try {
            body = webClient.get()
                    .uri("https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member")
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
                    .header(HttpHeaders.ACCEPT, "application/vnd.github+json")
                    .header("X-GitHub-Api-Version", "2022-11-28")
                    .header(HttpHeaders.USER_AGENT, "CloudBase-OAuth")
                    .retrieve()
                    .onStatus(
                            status -> status.value() == HttpStatus.UNAUTHORIZED.value(),
                            resp -> resp.bodyToMono(String.class).defaultIfEmpty("").flatMap(msg ->
                                    Mono.error(GitHubOAuthException.unauthorized(
                                            "invalid_token",
                                            "GitHub rejected the access token — reconnect GitHub on Account."
                                    ))
                            )
                    )
                    .bodyToMono(new ParameterizedTypeReference<List<Map<String, Object>>>() {})
                    .block();
        } catch (GitHubOAuthException e) {
            throw e;
        } catch (WebClientResponseException e) {
            log.warn("GitHub /user/repos HTTP {}: {}", e.getStatusCode().value(), e.getResponseBodyAsString());
            throw GitHubOAuthException.badGateway(
                    "github_repos_http_error",
                    "Failed to load GitHub repositories (HTTP " + e.getStatusCode().value() + ")"
            );
        } catch (WebClientRequestException e) {
            log.error("Cannot reach GitHub repos API", e);
            throw GitHubOAuthException.badGateway(
                    "github_unreachable",
                    "Could not reach GitHub. Check network connectivity."
            );
        } catch (RuntimeException e) {
            throw unwrapOAuth(e);
        }

        if (body == null) {
            return List.of();
        }

        return body.stream()
                .map(row -> {
                    String fullName = row.get("full_name") != null ? String.valueOf(row.get("full_name")) : "";
                    String htmlUrl = row.get("html_url") != null ? String.valueOf(row.get("html_url")) : "";
                    boolean isPrivate = Boolean.TRUE.equals(row.get("private"));
                    String defaultBranch = row.get("default_branch") != null
                            ? String.valueOf(row.get("default_branch"))
                            : "main";
                    String name = row.get("name") != null ? String.valueOf(row.get("name")) : fullName;
                    return new GitHubRepo(fullName, name, htmlUrl, isPrivate, defaultBranch);
                })
                .filter(r -> StringUtils.hasText(r.fullName()) && StringUtils.hasText(r.htmlUrl()))
                .toList();
    }

    public List<String> parseScopes(String scopeCsv) {
        if (!StringUtils.hasText(scopeCsv)) {
            return List.of();
        }
        String normalized = scopeCsv.replace(',', ' ');
        return Arrays.stream(normalized.split("\\s+"))
                .map(String::trim)
                .filter(StringUtils::hasText)
                .toList();
    }

    private void requireConfigured() {
        if (!isConfigured()) {
            throw GitHubOAuthException.notConfigured();
        }
    }

    private static RuntimeException unwrapOAuth(RuntimeException e) {
        Throwable cur = e;
        while (cur != null) {
            if (cur instanceof GitHubOAuthException goe) {
                return goe;
            }
            cur = cur.getCause();
        }
        return e;
    }

    private static String rootMessage(Throwable e) {
        Throwable cur = e;
        String last = e.getMessage();
        while (cur != null) {
            if (cur.getMessage() != null && !cur.getMessage().isBlank()) {
                last = cur.getMessage();
            }
            cur = cur.getCause();
        }
        return last;
    }

    private static GitHubOAuthException mapTokenError(String error, String description) {
        String code = error == null ? "unknown_error" : error.toLowerCase(Locale.ROOT).trim();
        String message = StringUtils.hasText(description) ? description : error;

        return switch (code) {
            case "bad_verification_code" -> GitHubOAuthException.badRequest(
                    code,
                    "Authorization code is invalid or has already been used. Start Connect with GitHub again."
            );
            case "incorrect_client_credentials" -> GitHubOAuthException.unauthorized(
                    code,
                    "Invalid GitHub OAuth client-id or client-secret on the server."
            );
            case "redirect_uri_mismatch" -> GitHubOAuthException.badRequest(
                    code,
                    "redirect_uri does not match the GitHub OAuth App callback URL."
            );
            case "application_suspended" -> GitHubOAuthException.unauthorized(
                    code,
                    "This GitHub OAuth App is suspended."
            );
            case "access_denied" -> GitHubOAuthException.unauthorized(
                    code,
                    "The user denied access to the GitHub OAuth App."
            );
            default -> GitHubOAuthException.badRequest(
                    code.isBlank() ? "oauth_error" : code,
                    message != null ? message : "GitHub OAuth token exchange failed"
            );
        };
    }

    public record TokenResponse(String accessToken, String scope, String tokenType) {
    }

    public record GitHubUser(String login, String avatarUrl, String name) {
    }

    public record GitHubRepo(
            String fullName,
            String name,
            String htmlUrl,
            boolean isPrivate,
            String defaultBranch
    ) {
    }
}
