package com.cloudbase.service.impl;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.github.GitHubOAuthException;
import com.cloudbase.github.GitHubRepoClient;
import com.cloudbase.github.GitHubRepoClient.OwnerRepo;
import com.cloudbase.github.GitHubSecretEncryptor;
import com.cloudbase.service.CiBootstrapService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
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
    private final GitHubSecretEncryptor secretEncryptor;
    private final String dockerHubNamespace;
    private final String dockerHubUsername;
    private final String dockerHubToken;
    private final String publicApiUrl;
    private final String webhookSecret;

    public CiBootstrapServiceImpl(
            GitHubRepoClient repoClient,
            GitHubSecretEncryptor secretEncryptor,
            @Value("${cloudbase.dockerhub.namespace:minipcer}") String dockerHubNamespace,
            @Value("${dockerhub.username:}") String dockerHubUsername,
            @Value("${dockerhub.token:}") String dockerHubToken,
            @Value("${cloudbase.public-api-url:}") String publicApiUrl,
            @Value("${github.webhook-secret:}") String webhookSecret
    ) {
        this.repoClient = repoClient;
        this.secretEncryptor = secretEncryptor;
        this.dockerHubNamespace = dockerHubNamespace;
        this.dockerHubUsername = StringUtils.hasText(dockerHubUsername) ? dockerHubUsername : dockerHubNamespace;
        this.dockerHubToken = dockerHubToken == null ? "" : dockerHubToken;
        this.publicApiUrl = publicApiUrl == null ? "" : publicApiUrl.trim().replaceAll("/$", "");
        this.webhookSecret = webhookSecret;
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

        String imageName = dockerHubNamespace + "/" + sanitize(service.getName());
        src.put("imageName", imageName);
        src.put("runtime", runtime);

        String token = owner.getGithubAccessToken();
        if (!StringUtils.hasText(token)) {
            src.put("ciBootstrapped", false);
            src.put("ciMessage", "Connect GitHub on Account before CI bootstrap.");
            return src;
        }

        OwnerRepo or;
        try {
            or = GitHubRepoClient.parseOwnerRepo(repoUrl);
        } catch (GitHubOAuthException e) {
            src.put("ciBootstrapped", false);
            src.put("ciMessage", e.getMessage());
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
                        dockerfileFor(runtime),
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

            boolean secretsOk = false;
            if (StringUtils.hasText(dockerHubToken)) {
                repoClient.putActionsSecret(
                        token, or.owner(), or.repo(),
                        "DOCKERHUB_USERNAME", dockerHubUsername, secretEncryptor
                );
                repoClient.putActionsSecret(
                        token, or.owner(), or.repo(),
                        "DOCKERHUB_TOKEN", dockerHubToken, secretEncryptor
                );
                secretsOk = true;
            }

            if (StringUtils.hasText(publicApiUrl)) {
                String hookUrl = publicApiUrl + "/api/webhooks/github";
                repoClient.ensureWebhook(
                        token, or.owner(), or.repo(), hookUrl, webhookSecret,
                        List.of("workflow_run")
                );
                webhookOk = true;
                message = secretsOk
                        ? "CI ready. Push to the repo to build & deploy via CloudBase."
                        : "CI ready (workflow injected). Add DOCKERHUB_USERNAME/TOKEN secrets, then push.";
            } else {
                message = secretsOk
                        ? "Dockerfile/workflow + Docker Hub secrets injected. Set cloudbase.public-api-url for auto webhook."
                        : "Dockerfile/workflow injected. Set Docker Hub secrets and cloudbase.public-api-url.";
            }

            src.put("ciBootstrapped", true);
            src.put("ciDockerfileCreated", dockerfileCreated);
            src.put("ciWorkflowCreated", workflowCreated);
            src.put("ciWebhookRegistered", webhookOk);
            src.put("ciSecretsConfigured", secretsOk);
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
            src.put("ciBootstrapped", false);
            src.put("ciMessage", "CI bootstrap failed: " + e.getMessage());
        }

        return src;
    }

    private static String sanitize(String name) {
        return name.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9-]", "-").replaceAll("^-+|-+$", "");
    }

    static String dockerfileFor(String runtime) {
        String r = runtime == null ? "node" : runtime.toLowerCase(Locale.ROOT);
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
                    ENTRYPOINT ["java","-jar","/app/app.jar"]
                    """;
            case "python" -> """
                    FROM python:3.12-slim
                    WORKDIR /app
                    COPY requirements.txt .
                    RUN pip install --no-cache-dir -r requirements.txt
                    COPY . .
                    EXPOSE 8000
                    CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
                    """;
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
                    ENTRYPOINT ["/app/app"]
                    """;
            case "php" -> """
                    FROM php:8.3-apache
                    COPY . /var/www/html/
                    EXPOSE 80
                    """;
            case "dotnet" -> """
                    FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
                    WORKDIR /src
                    COPY . .
                    RUN dotnet publish -c Release -o /app

                    FROM mcr.microsoft.com/dotnet/aspnet:8.0
                    WORKDIR /app
                    COPY --from=build /app .
                    EXPOSE 8080
                    ENTRYPOINT ["dotnet", "App.dll"]
                    """;
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
                    CMD ["nginx", "-g", "daemon off;"]
                    """;
        };
    }

    static String workflowYaml(String imageName) {
        return """
                # Generated by CloudBase — build & push on every push to the default branch
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
                        uses: actions/checkout@v4

                      - name: Set image tag
                        id: meta
                        run: |
                          SHA_SHORT=$(echo "${GITHUB_SHA}" | cut -c1-7)
                          echo "tag=${SHA_SHORT}" >> "$GITHUB_OUTPUT"
                          echo "Image will be ${IMAGE_NAME}:${SHA_SHORT}"

                      - name: Login to Docker Hub
                        uses: docker/login-action@v3
                        with:
                          username: ${{ secrets.DOCKERHUB_USERNAME }}
                          password: ${{ secrets.DOCKERHUB_TOKEN }}

                      - name: Build and push
                        uses: docker/build-push-action@v6
                        with:
                          context: .
                          push: true
                          tags: |
                            ${{ env.IMAGE_NAME }}:${{ steps.meta.outputs.tag }}
                            ${{ env.IMAGE_NAME }}:latest
                """.formatted(imageName);
    }
}
