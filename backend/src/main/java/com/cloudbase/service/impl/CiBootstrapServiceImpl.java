package com.cloudbase.service.impl;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.github.GitHubOAuthException;
import com.cloudbase.github.GitHubRepoClient;
import com.cloudbase.github.GitHubRepoClient.OwnerRepo;
import com.cloudbase.service.CiBootstrapService;
import com.cloudbase.service.ComposeInputValidator;
import com.cloudbase.service.PlatformSettingsService;
import com.cloudbase.service.StartCommandValidator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Service
public class CiBootstrapServiceImpl implements CiBootstrapService {

    private static final Logger log = LoggerFactory.getLogger(CiBootstrapServiceImpl.class);
    private static final String WORKFLOW_PATH = ".github/workflows/cloudbase-deploy.yml";

    private final GitHubRepoClient repoClient;
    private final PlatformSettingsService settings;

    public CiBootstrapServiceImpl(
            GitHubRepoClient repoClient,
            PlatformSettingsService settings
    ) {
        this.repoClient = repoClient;
        this.settings = settings;
    }

    private String publicApiUrl() {
        String u = settings.get(PlatformSettingsService.PUBLIC_API_URL);
        return u == null ? "" : u.trim().replaceAll("/$", "");
    }

    private String webhookSecret() {
        return settings.get(PlatformSettingsService.GITHUB_WEBHOOK_SECRET);
    }

    @Override
    public Map<String, Object> bootstrapGitHubService(UserEntity owner, ServiceEntity service) {
        Map<String, Object> src = service.getSourceDetails() != null
                ? new HashMap<>(service.getSourceDetails())
                : new HashMap<>();

        String repoUrl = String.valueOf(src.getOrDefault("repositoryUrl", ""));
        String branch = String.valueOf(src.getOrDefault("branch", "main"));
        if (!StringUtils.hasText(branch) || "null".equals(branch)) {
            branch = "main";
        }
        String runtime = String.valueOf(src.getOrDefault("runtime", "node"));
        if (!StringUtils.hasText(runtime) || "null".equals(runtime)) {
            runtime = "node";
        }
        String startCommand = String.valueOf(src.getOrDefault("startCommand", ""));
        if (!StringUtils.hasText(startCommand) || "null".equals(startCommand)) {
            startCommand = defaultStartCommand(runtime);
        }
        var validated = StartCommandValidator.validateRequired(startCommand);
        startCommand = validated.normalized();
        src.put("startCommand", startCommand);

        OwnerRepo or;
        try {
            or = GitHubRepoClient.parseOwnerRepo(repoUrl);
        } catch (GitHubOAuthException e) {
            src.put("ciBootstrapped", false);
            src.put("ciMessage", e.getMessage());
            return src;
        }
        // The image always lives in the repository's own GitHub Container Registry and is derived from the
        // repository, never taken from user input, so a service cannot point at someone else's package.
        String imageName = ghcrImageName(or.owner(), or.repo());
        src.put("imageName", imageName);
        src.put("runtime", runtime);
        // Default on unless explicitly disabled
        if (!src.containsKey("autoDeploy")) {
            src.put("autoDeploy", true);
        }

        String token = owner.getGithubAccessToken();
        if (!StringUtils.hasText(token)) {
            src.put("ciBootstrapped", false);
            src.put("ciMessage", "Connect GitHub on Account before CI bootstrap.");
            return src;
        }

        boolean dockerfileCreated = false;
        boolean workflowCreated = false;
        boolean webhookOk = false;
        String message;

        try {
            if (!repoClient.fileExists(token, or.owner(), or.repo(), "Dockerfile")) {
                dockerfileCreated = repoClient.putTextFile(
                        token, or.owner(), or.repo(), "Dockerfile",
                        dockerfileFor(runtime, startCommand),
                        "chore(cloudbase): add Dockerfile for CloudBase deploy",
                        branch,
                        false
                );
            }

            workflowCreated = repoClient.putTextFile(
                    token, or.owner(), or.repo(), WORKFLOW_PATH,
                    workflowYaml(imageName),
                    "chore(cloudbase): add CloudBase deploy workflow",
                    branch,
                    true
            );

            // No secrets are written: the workflow publishes to the repository's own GHCR package with the
            // job's scoped GITHUB_TOKEN. CloudBase's registry/Portainer credentials never reach a tenant repo.
            if (StringUtils.hasText(publicApiUrl())) {
                String hookUrl = publicApiUrl() + "/api/webhooks/github";
                repoClient.ensureWebhook(
                        token, or.owner(), or.repo(), hookUrl, webhookSecret(),
                        List.of("workflow_run")
                );
                webhookOk = true;
                message = "CI ready. Push to the repository to build into its GitHub Container Registry and deploy.";
            } else {
                message = "Dockerfile/workflow injected. Set cloudbase.public-api-url so pushes trigger deploys.";
            }

            src.put("ciBootstrapped", true);
            src.put("ciDockerfileCreated", dockerfileCreated);
            src.put("ciWorkflowCreated", workflowCreated);
            src.put("ciWebhookRegistered", webhookOk);
            src.remove("ciSecretsConfigured");
            src.put("ciMessage", message);
            // Default HTTP port for common SPA/nginx Dockerfile
            if (!src.containsKey("containerPort")) {
                src.put("containerPort", switch (runtime.toLowerCase(Locale.ROOT)) {
                    case "java", "go", "dotnet" -> 8080;
                    case "python" -> 8000;
                    default -> 80;
                });
            }
            log.info("CI bootstrap ok service={} repo={}/{} dockerfileNew={} workflow={} webhook={}",
                    service.getId(), or.owner(), or.repo(), dockerfileCreated, workflowCreated, webhookOk);
        } catch (Exception e) {
            log.warn("CI bootstrap failed for {}: {}", service.getId(), e.toString());
            String hint = e.getMessage() != null && e.getMessage().contains("HTTP 404")
                    ? " Reconnect GitHub on Account (needs the workflow scope) then retry."
                    : "";
            src.put("ciBootstrapped", false);
            src.put("ciMessage", "CI bootstrap failed: " + e.getMessage() + hint);
        }

        return src;
    }

    private static String sanitize(String name) {
        return name.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9-]", "-").replaceAll("^-+|-+$", "");
    }

    static String defaultStartCommand(String runtime) {
        String r = runtime == null ? "node" : runtime.toLowerCase(Locale.ROOT);
        return switch (r) {
            case "java" -> "java -jar /app/app.jar";
            case "python" -> "python -m uvicorn main:app --host 0.0.0.0 --port 8000";
            case "go" -> "/app/app";
            case "dotnet" -> "dotnet App.dll";
            case "php" -> "apache2-foreground";
            case "rust" -> "/app/app";
            case "node" -> "nginx -g \"daemon off;\"";
            default -> "";
        };
    }

    static String dockerfileFor(String runtime) {
        return dockerfileFor(runtime, defaultStartCommand(runtime));
    }

    static String dockerfileFor(String runtime, String startCommand) {
        String r = runtime == null ? "node" : runtime.toLowerCase(Locale.ROOT);
        String cmd = (startCommand == null || startCommand.isBlank())
                ? defaultStartCommand(r)
                : startCommand.trim();
        String cmdJson = toJsonExecArray(cmd);
        return switch (r) {
            case "java" -> """
                    FROM maven:3.9-eclipse-temurin-17 AS build
                    WORKDIR /app
                    COPY pom.xml .
                    COPY src ./src
                    RUN mvn -q -DskipTests package

                    FROM eclipse-temurin:17-jre-alpine
                    WORKDIR /app
                    COPY --from=build /app/target/*.jar app.jar
                    EXPOSE 8080
                    # CMD (not ENTRYPOINT) so CloudBase can override start command in compose
                    CMD %s
                    """.formatted(cmdJson);
            case "python" -> """
                    FROM python:3.12-slim
                    WORKDIR /app
                    COPY requirements.txt .
                    RUN pip install --no-cache-dir -r requirements.txt
                    COPY . .
                    EXPOSE 8000
                    CMD %s
                    """.formatted(cmdJson);
            case "go" -> """
                    FROM golang:1.22-alpine AS build
                    WORKDIR /src
                    COPY go.mod go.sum ./
                    RUN go mod download
                    COPY . .
                    RUN CGO_ENABLED=0 go build -o /out/app .

                    FROM alpine:3.20
                    WORKDIR /app
                    COPY --from=build /out/app /app/app
                    EXPOSE 8080
                    CMD %s
                    """.formatted(cmdJson);
            case "php" -> """
                    FROM php:8.3-apache
                    COPY . /var/www/html/
                    EXPOSE 80
                    CMD %s
                    """.formatted(cmdJson.isBlank() ? "[\"apache2-foreground\"]" : cmdJson);
            case "dotnet" -> """
                    FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
                    WORKDIR /src
                    COPY . .
                    RUN dotnet publish -c Release -o /app

                    FROM mcr.microsoft.com/dotnet/aspnet:8.0
                    WORKDIR /app
                    COPY --from=build /app .
                    EXPOSE 8080
                    CMD %s
                    """.formatted(cmdJson);
            default -> """
                    # CloudBase default Node/SPA Dockerfile (override if needed)
                    FROM node:20-alpine AS build
                    WORKDIR /app
                    COPY package*.json ./
                    RUN npm ci
                    COPY . .
                    RUN npm run build

                    FROM nginx:1.27-alpine
                    COPY --from=build /app/dist /usr/share/nginx/html
                    EXPOSE 80
                    CMD %s
                    """.formatted(cmdJson.isBlank() ? "[\"nginx\", \"-g\", \"daemon off;\"]" : cmdJson);
        };
    }

    /** Validated argv → Docker JSON-array CMD (exec form, never shell). */
    static String toJsonExecArray(String command) {
        if (command == null || command.isBlank()) {
            return "[]";
        }
        var validated = StartCommandValidator.validateRequired(command);
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < validated.argv().size(); i++) {
            if (i > 0) {
                sb.append(", ");
            }
            String arg = validated.argv().get(i)
                    .replace("\\", "\\\\")
                    .replace("\"", "\\\"");
            sb.append('"').append(arg).append('"');
        }
        sb.append(']');
        return sb.toString();
    }

    /** {@code ghcr.io/<owner>/<repo>} in lowercase, as GitHub Container Registry requires. */
    static String ghcrImageName(String owner, String repo) {
        return ComposeInputValidator.requireImage(
                ("ghcr.io/" + owner + "/" + repo).toLowerCase(Locale.ROOT));
    }

    /**
     * Workflow committed to the tenant repository. It publishes to that repository's own GHCR package
     * using the job's GITHUB_TOKEN (scoped to this repository, expires with the job). It references no
     * other secret, so nothing of CloudBase's is ever stored in or readable from the tenant repository.
     * Actions are pinned to commit SHAs.
     */
    static String workflowYaml(String imageName) {
        return """
                # Generated by CloudBase - build and publish to this repository's GitHub Container Registry
                name: CloudBase Deploy

                on:
                  push:
                    branches: ["**"]
                  workflow_dispatch:

                env:
                  IMAGE_NAME: %s

                jobs:
                  build-and-push:
                    runs-on: ubuntu-latest
                    permissions:
                      contents: read
                      packages: write
                    steps:
                      - name: Checkout
                        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
                        with:
                          persist-credentials: false

                      - name: Set image tag
                        id: meta
                        run: |
                          SHA_SHORT=$(echo "${GITHUB_SHA}" | cut -c1-7)
                          echo "tag=${SHA_SHORT}" >> "$GITHUB_OUTPUT"
                          echo "Image will be ${IMAGE_NAME}:${SHA_SHORT}"

                      - name: Log in to GitHub Container Registry
                        uses: docker/login-action@81c6f93d4bc991e510b342a00b419b3bb4efc5c6 # v4.7.0
                        with:
                          registry: ghcr.io
                          username: ${{ github.actor }}
                          password: ${{ secrets.GITHUB_TOKEN }}

                      - name: Build and push
                        uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
                        with:
                          context: .
                          push: true
                          provenance: false
                          tags: |
                            ${{ env.IMAGE_NAME }}:${{ steps.meta.outputs.tag }}
                            ${{ env.IMAGE_NAME }}:latest
                """.formatted(imageName);
    }
}
