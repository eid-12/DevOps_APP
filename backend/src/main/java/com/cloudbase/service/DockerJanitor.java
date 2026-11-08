package com.cloudbase.service;

import com.cloudbase.model.DeploymentStatus;
import com.cloudbase.portainer.PortainerClient;
import com.cloudbase.repository.DeploymentRepository;
import com.cloudbase.repository.ServiceRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Keeps the Docker host from filling up with what CloudBase leaves behind:
 * <ul>
 *   <li>containers and stacks of services that no longer exist (e.g. deleted while Portainer was half-down);</li>
 *   <li>exited helper containers (volume wipes, isolation probes) whose removal failed;</li>
 *   <li>images CloudBase pulled that no container uses any more: database engines, GitHub-built app images,
 *       tenant Docker images, older Watchtower versions, and untagged images left by re-pulling a moving tag;</li>
 *   <li>anonymous volumes no container uses (named volumes are never touched).</li>
 * </ul>
 * Safety rules: images are removed without force, so Docker refuses while any container (running or stopped) uses
 * one; the image pass is skipped while a deploy is in flight (a just-pulled image is briefly unused); the platform's
 * own images (cloudbase-backend/frontend, kept for rollback) are never candidates; and a container or stack counts
 * as orphaned only when its service id is gone from the database and it is older than {@link #ORPHAN_MIN_AGE}.
 */
@Component
public class DockerJanitor {

    private static final Logger log = LoggerFactory.getLogger(DockerJanitor.class);

    static final Duration FULL_PASS_EVERY = Duration.ofHours(6);
    static final Duration ORPHAN_MIN_AGE = Duration.ofMinutes(30);
    static final Duration HELPER_MIN_AGE = Duration.ofMinutes(10);
    private static final List<DeploymentStatus> IN_FLIGHT =
            List.of(DeploymentStatus.QUEUED, DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING);

    /** cb-svc-xxxx (app) and cb-wt-svc-xxxx (Watchtower) → svc-xxxx. */
    static final Pattern SERVICE_CONTAINER = Pattern.compile("^/?cb-(?:wt-)?(svc-[a-z0-9]+)$");
    /** cb-proj-xxxx-svc-yyyy → svc-yyyy (see DeploymentOrchestrator.stackName). */
    static final Pattern SERVICE_STACK = Pattern.compile("^cb-proj-[a-z0-9]+-(svc-[a-z0-9]+)$");
    /** Images CloudBase itself pulls for database services. */
    static final Set<String> DATABASE_REPOS = Set.of("postgres", "mysql", "redis", "mongo");

    private final PortainerClient portainer;
    private final ServiceRepository services;
    private final DeploymentRepository deployments;
    private final PlatformSettingsService settings;
    private final Clock clock;
    private final AtomicBoolean requested = new AtomicBoolean(true); // first pass soon after start
    private volatile Instant lastFullPass = Instant.EPOCH;

    @org.springframework.beans.factory.annotation.Autowired
    public DockerJanitor(PortainerClient portainer, ServiceRepository services, DeploymentRepository deployments,
                         PlatformSettingsService settings) {
        this(portainer, services, deployments, settings, Clock.systemUTC());
    }

    DockerJanitor(PortainerClient portainer, ServiceRepository services, DeploymentRepository deployments,
                  PlatformSettingsService settings, Clock clock) {
        this.portainer = portainer;
        this.services = services;
        this.deployments = deployments;
        this.settings = settings;
        this.clock = clock;
    }

    /** Ask for a pass soon (after a deploy replaced an image, or a delete). Cheap; runs on the next tick. */
    public void requestPass() {
        requested.set(true);
    }

    @Scheduled(fixedDelayString = "${cloudbase.janitor.tick-ms:300000}", initialDelayString = "${cloudbase.janitor.initial-ms:600000}")
    public void tick() {
        Instant now = clock.instant();
        if (!requested.getAndSet(false) && Duration.between(lastFullPass, now).compareTo(FULL_PASS_EVERY) < 0) {
            return;
        }
        try {
            runPass();
            lastFullPass = now;
        } catch (Exception e) {
            log.warn("Docker cleanup pass skipped: {}", e.getMessage());
        }
    }

    /** One full pass; each step is independent and best effort. */
    @SuppressWarnings("unchecked")
    void runPass() {
        Object[] containers = portainer.getContainers().block(Duration.ofSeconds(30));
        if (containers == null) return;
        Instant now = clock.instant();
        Set<String> usedImageIds = new HashSet<>();
        int containersRemoved = 0;
        for (Object o : containers) {
            if (!(o instanceof Map<?, ?> c)) continue;
            if (c.get("ImageID") != null) usedImageIds.add(String.valueOf(c.get("ImageID")));
            String id = String.valueOf(c.get("Id"));
            String name = firstName(c);
            Instant created = c.get("Created") instanceof Number n ? Instant.ofEpochSecond(n.longValue()) : now;
            Duration age = Duration.between(created, now);
            String state = String.valueOf(c.get("State")).toLowerCase(Locale.ROOT);

            Matcher svc = SERVICE_CONTAINER.matcher(name);
            if (svc.matches() && age.compareTo(ORPHAN_MIN_AGE) > 0 && !services.existsById(svc.group(1))) {
                portainer.forceRemoveContainer(id).block(Duration.ofSeconds(30));
                containersRemoved++;
                log.info("Removed orphaned container {} (service {} no longer exists)", name, svc.group(1));
                continue;
            }
            if (isLeftoverHelper(c) && !"running".equals(state) && age.compareTo(HELPER_MIN_AGE) > 0) {
                portainer.forceRemoveContainer(id).block(Duration.ofSeconds(30));
                containersRemoved++;
            }
        }

        int stacksRemoved = removeOrphanStacks();

        int imagesRemoved = 0;
        if (deployments.existsByStatusInAndFinishedAtIsNull(IN_FLIGHT)) {
            log.info("Docker cleanup: a deploy is in progress, images are left for the next pass");
        } else {
            imagesRemoved = removeUnusedImages(usedImageIds);
            portainer.pruneDanglingImages().onErrorResume(e -> reactor.core.publisher.Mono.empty()).block(Duration.ofMinutes(2));
        }
        portainer.pruneAnonymousVolumes().onErrorResume(e -> reactor.core.publisher.Mono.empty()).block(Duration.ofMinutes(2));

        if (containersRemoved + stacksRemoved + imagesRemoved > 0) {
            log.info("Docker cleanup: removed {} container(s), {} stack(s), {} image(s)",
                    containersRemoved, stacksRemoved, imagesRemoved);
        }
    }

    private int removeOrphanStacks() {
        List<Map<String, Object>> stacks = portainer.listStacks().block(Duration.ofSeconds(30));
        if (stacks == null) return 0;
        Instant now = clock.instant();
        int removed = 0;
        for (Map<String, Object> st : stacks) {
            Matcher m = SERVICE_STACK.matcher(String.valueOf(st.get("Name")));
            if (!m.matches() || services.existsById(m.group(1))) continue;
            Instant created = st.get("CreationDate") instanceof Number n ? Instant.ofEpochSecond(n.longValue()) : now;
            if (Duration.between(created, now).compareTo(ORPHAN_MIN_AGE) <= 0) continue;
            if (st.get("Id") instanceof Number id) {
                portainer.removeStack(id.intValue()).block(Duration.ofSeconds(60));
                removed++;
                log.info("Removed orphaned stack {} (service {} no longer exists)", st.get("Name"), m.group(1));
            }
        }
        return removed;
    }

    private int removeUnusedImages(Set<String> usedImageIds) {
        List<Map<String, Object>> images = portainer.listImages().block(Duration.ofSeconds(30));
        if (images == null) return 0;
        Set<String> tenantRepos = tenantImageRepos();
        String namespace = namespace();
        int removed = 0;
        for (Map<String, Object> image : images) {
            String id = String.valueOf(image.get("Id"));
            if (usedImageIds.contains(id)) continue;
            // Only images pulled from a registry (they carry a RepoDigest), so anything removed can be pulled again.
            // A locally built image never qualifies, whatever a tenant names its own image.
            if (!(image.get("RepoDigests") instanceof List<?> digests) || digests.isEmpty()) continue;
            if (!isCloudBaseImage(refsOf(image), tenantRepos, namespace)) continue;
            if (Boolean.TRUE.equals(portainer.removeImageIfUnused(id).block(Duration.ofSeconds(60)))) {
                removed++;
            }
        }
        return removed;
    }

    /** True for images CloudBase pulled for tenants; false for anything else on the host, and for its own images. */
    static boolean isCloudBaseImage(List<String> refs, Set<String> tenantRepos, String namespace) {
        if (refs.isEmpty()) return false; // untagged images are handled by the dangling prune
        for (String ref : refs) {
            String repo = repoOf(ref);
            if (repo.contains("cloudbase-backend") || repo.contains("cloudbase-frontend")) return false; // platform, rollback
        }
        for (String ref : refs) {
            String repo = repoOf(ref);
            String bare = repo.startsWith("docker.io/library/") ? repo.substring("docker.io/library/".length()) : repo;
            if (DATABASE_REPOS.contains(bare)) return true;
            if (bare.equals("nickfedor/watchtower")) return true;
            if (bare.startsWith("ghcr.io/")) return true;
            if (namespace != null && !namespace.isBlank() && bare.startsWith(namespace + "/")) return true;
            if (tenantRepos.contains(bare)) return true;
        }
        return false;
    }

    /** Repository part of "repo:tag" or "repo@sha256:…" (a registry port's colon is kept). */
    static String repoOf(String ref) {
        String r = ref.toLowerCase(Locale.ROOT);
        int at = r.indexOf('@');
        if (at >= 0) r = r.substring(0, at);
        int colon = r.lastIndexOf(':');
        if (colon > r.lastIndexOf('/')) r = r.substring(0, colon);
        return r;
    }

    private static List<String> refsOf(Map<String, Object> image) {
        List<String> refs = new java.util.ArrayList<>();
        for (String key : new String[]{"RepoTags", "RepoDigests"}) {
            if (image.get(key) instanceof List<?> list) {
                for (Object v : list) {
                    String s = String.valueOf(v);
                    if (!s.startsWith("<none>")) refs.add(s);
                }
            }
        }
        return refs;
    }

    /** Repositories of the Docker images current services run (tenant images, e.g. nginx or node). */
    private Set<String> tenantImageRepos() {
        Set<String> repos = new HashSet<>();
        services.findAll().forEach(s -> {
            Object name = s.getSourceDetails() == null ? null : s.getSourceDetails().get("imageName");
            if (name != null && !String.valueOf(name).isBlank()) repos.add(repoOf(String.valueOf(name).trim()));
        });
        return repos;
    }

    private String namespace() {
        String ns = settings.get(PlatformSettingsService.DOCKERHUB_NAMESPACE);
        return ns == null ? null : ns.trim().toLowerCase(Locale.ROOT);
    }

    private static boolean isLeftoverHelper(Map<?, ?> c) {
        if (!(c.get("Labels") instanceof Map<?, ?> labels)) return false;
        return "volume-wipe".equals(labels.get("cloudbase.temp")) || "isolation-probe".equals(labels.get("cloudbase.role"));
    }

    private static String firstName(Map<?, ?> c) {
        if (c.get("Names") instanceof List<?> names && !names.isEmpty()) {
            String n = String.valueOf(names.get(0));
            return n.startsWith("/") ? n.substring(1) : n;
        }
        return "";
    }
}
