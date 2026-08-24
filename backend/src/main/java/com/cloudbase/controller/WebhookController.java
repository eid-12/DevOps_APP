package com.cloudbase.controller;

import com.cloudbase.dto.ProjectDtos.DeployServiceRequest;
import com.cloudbase.entity.DeploymentEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.repository.ServiceRepository;
import com.cloudbase.service.DeploymentOrchestrator;
import com.cloudbase.service.PlatformSettingsService;
import com.cloudbase.service.ProjectService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StreamUtils;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * GitHub webhook receiver (B2).
 * Prefers {@code workflow_run} completed (image already on Docker Hub),
 * ignores bare {@code push} to avoid racing the Actions build.
 */
@RestController
@RequestMapping("/api/webhooks")
public class WebhookController {

    private static final Logger log = LoggerFactory.getLogger(WebhookController.class);
    private static final String WORKFLOW_NAME = "CloudBase Deploy";

    private final ServiceRepository serviceRepository;
    private final ProjectService projectService;
    private final DeploymentOrchestrator orchestrator;
    private final ObjectMapper objectMapper;
    private final PlatformSettingsService platformSettings;

    public WebhookController(
            ServiceRepository serviceRepository,
            ProjectService projectService,
            DeploymentOrchestrator orchestrator,
            ObjectMapper objectMapper,
            PlatformSettingsService platformSettings
    ) {
        this.serviceRepository = serviceRepository;
        this.projectService = projectService;
        this.orchestrator = orchestrator;
        this.objectMapper = objectMapper;
        this.platformSettings = platformSettings;
    }

    private String webhookSecret() {
        return platformSettings.get(PlatformSettingsService.GITHUB_WEBHOOK_SECRET);
    }

    @PostMapping("/github")
    public ResponseEntity<Map<String, Object>> onGitHubEvent(
            @RequestHeader(value = "X-Hub-Signature-256", required = false) String signature,
            @RequestHeader(value = "X-GitHub-Event", required = false) String event,
            HttpServletRequest request
    ) throws Exception {
        byte[] rawBytes = StreamUtils.copyToByteArray(request.getInputStream());
        String rawBody = new String(rawBytes, StandardCharsets.UTF_8);
        verifySignature(rawBody, signature);

        Map<String, Object> payload = objectMapper.readValue(rawBytes, new TypeReference<>() {});

        if ("workflow_run".equalsIgnoreCase(event)) {
            return handleWorkflowRun(payload);
        }
        if ("push".equalsIgnoreCase(event)) {
            // Build happens in Actions; deploy waits for workflow_run success.
            return ResponseEntity.ok(Map.of(
                    "ignored", true,
                    "reason", "push_wait_for_workflow_run"
            ));
        }
        return ResponseEntity.ok(Map.of("ignored", true, "reason", "event=" + event));
    }

    private ResponseEntity<Map<String, Object>> handleWorkflowRun(Map<String, Object> payload) {
        String action = String.valueOf(payload.getOrDefault("action", ""));
        Object runObj = payload.get("workflow_run");
        if (!(runObj instanceof Map<?, ?> run)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Missing workflow_run");
        }

        String workflowName = String.valueOf(run.get("name"));
        if (!WORKFLOW_NAME.equalsIgnoreCase(workflowName)) {
            return ResponseEntity.ok(Map.of("ignored", true, "reason", "workflow=" + workflowName));
        }

        String repoUrl = extractRepoUrl(payload);
        String branch = String.valueOf(run.get("head_branch"));
        String commitSha = String.valueOf(run.get("head_sha"));
        String runUrl = run.get("html_url") == null ? "" : String.valueOf(run.get("html_url"));
        String conclusion = String.valueOf(run.get("conclusion"));
        if (!StringUtils.hasText(repoUrl) || !StringUtils.hasText(branch)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Missing repository or branch");
        }

        List<ServiceEntity> matches = serviceRepository.findBySourceType(ServiceSourceType.GITHUB).stream()
                .filter(s -> {
                    Map<String, Object> src = s.getSourceDetails();
                    if (src == null) return false;
                    return normalizeRepo(String.valueOf(src.getOrDefault("repositoryUrl", "")))
                            .equals(normalizeRepo(repoUrl));
                })
                .toList();

        boolean progress = "requested".equalsIgnoreCase(action) || "in_progress".equalsIgnoreCase(action);
        boolean completed = "completed".equalsIgnoreCase(action);
        if (!progress && !completed) {
            return ResponseEntity.ok(Map.of("ignored", true, "reason", "action=" + action));
        }

        int triggered = 0;
        int recorded = 0;
        for (ServiceEntity service : matches) {
            Map<String, Object> src = service.getSourceDetails();
            if (src == null) continue;

            String configuredBranch = String.valueOf(src.getOrDefault("branch", "main"));
            if (!configuredBranch.equalsIgnoreCase(branch)) continue;

            boolean autoDeploy = !(Boolean.FALSE.equals(src.get("autoDeploy")));

            if (progress) {
                if (!autoDeploy) continue;
                orchestrator.onGitHubWorkflowEvent(service, action, conclusion, commitSha, runUrl);
                recorded++;
                continue;
            }

            if (!"success".equalsIgnoreCase(conclusion)) {
                orchestrator.onGitHubWorkflowEvent(service, action, conclusion, commitSha, runUrl);
                recorded++;
                continue;
            }

            if (!autoDeploy) continue;

            String imageTag = commitSha != null && commitSha.length() >= 7
                    ? commitSha.substring(0, 7)
                    : "latest";

            src.put("imageTag", imageTag);
            service.setSourceDetails(src);
            serviceRepository.save(service);

            DeployServiceRequest deployRequest = new DeployServiceRequest(commitSha, imageTag);
            DeploymentEntity deployment = projectService.deployAsSystem(
                    service.getId(),
                    "github-workflow",
                    deployRequest
            );
            triggered++;
            log.info("workflow_run auto-deploy service={} deployment={} branch={} tag={}",
                    service.getId(), deployment.getId(), branch, imageTag);
        }

        return ResponseEntity.accepted().body(Map.of(
                "matched", matches.size(),
                "triggered", triggered,
                "recorded", recorded,
                "action", action,
                "conclusion", conclusion == null ? "" : conclusion,
                "repository", repoUrl,
                "branch", branch,
                "commitSha", commitSha == null ? "" : commitSha
        ));
    }

    private void verifySignature(String rawBody, String signatureHeader) {
        String webhookSecret = webhookSecret();
        if (!StringUtils.hasText(webhookSecret)) {
            throw new ResponseStatusException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "GitHub webhook secret is not configured"
            );
        }
        if (!StringUtils.hasText(signatureHeader) || !signatureHeader.startsWith("sha256=")) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Missing X-Hub-Signature-256");
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(webhookSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] digest = mac.doFinal(rawBody.getBytes(StandardCharsets.UTF_8));
            String expected = "sha256=" + HexFormat.of().formatHex(digest);
            if (!MessageDigest.isEqual(
                    expected.getBytes(StandardCharsets.UTF_8),
                    signatureHeader.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8)
            )) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid webhook signature");
            }
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Webhook signature verification failed");
        }
    }

    private static String extractRepoUrl(Map<String, Object> payload) {
        Object repo = payload.get("repository");
        if (repo instanceof Map<?, ?> map) {
            Object clone = map.get("clone_url");
            if (clone != null) return String.valueOf(clone);
            Object html = map.get("html_url");
            if (html != null) return String.valueOf(html);
        }
        return null;
    }

    static String normalizeRepo(String url) {
        if (url == null) return "";
        String u = url.trim().toLowerCase(Locale.ROOT);
        u = u.replace("git@github.com:", "https://github.com/");
        u = u.replace("ssh://git@github.com/", "https://github.com/");
        if (u.endsWith(".git")) u = u.substring(0, u.length() - 4);
        if (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        return u;
    }
}
