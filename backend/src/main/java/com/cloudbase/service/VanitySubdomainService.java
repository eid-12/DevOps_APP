package com.cloudbase.service;

import com.cloudbase.dto.ProjectDtos.DomainCheckResponse;
import com.cloudbase.dto.ProjectDtos.VanityStatusResponse;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.model.UserRole;
import com.cloudbase.repository.ServiceRepository;
import com.cloudbase.repository.UserRepository;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Enforces: one vanity platform subdomain per user account.
 * Format: {slug}.{baseDomain}. Everything else stays opaque random (cloudbase####).
 */
@Service
public class VanitySubdomainService {

    private static final int MIN_LEN = 3;
    private static final int MAX_LEN = 30;
    private static final Pattern SLUG = Pattern.compile("^[a-z][a-z0-9-]{1,28}[a-z0-9]$");

    /** Platform / infra / abuse-prone labels — never claimable. */
    private static final Set<String> RESERVED = Set.of(
            "admin", "administrator", "api", "app", "apps", "asset", "assets", "auth", "billing",
            "cdn", "ci", "cloud", "cloudbase", "console", "dashboard", "demo", "dev", "dns",
            "docs", "email", "ftp", "git", "github", "grafana", "health", "help", "hook", "hooks",
            "imap", "internal", "login", "mail", "manage", "metrics", "mx", "npm", "ns", "ns1", "ns2",
            "oauth", "pop", "portainer", "prod", "production", "proxy", "register", "root", "signup",
            "smtp", "ssl", "staging", "static", "status", "support", "test", "txt", "webhook", "www",
            "ws", "wss", "null", "undefined", "localhost", "base", "system", "owner", "staff",
            "panel", "portal", "edge", "mawrid"
    );

    private final UserRepository userRepository;
    private final ServiceRepository serviceRepository;
    private final PlatformSettingsService platformSettings;
    private final DeploymentOrchestrator orchestrator;

    public VanitySubdomainService(
            UserRepository userRepository,
            ServiceRepository serviceRepository,
            PlatformSettingsService platformSettings,
            @Lazy DeploymentOrchestrator orchestrator
    ) {
        this.userRepository = userRepository;
        this.serviceRepository = serviceRepository;
        this.platformSettings = platformSettings;
        this.orchestrator = orchestrator;
    }

    public String baseDomain() {
        String d = platformSettings.get(PlatformSettingsService.BASE_DOMAIN);
        return (d == null || d.isBlank()) ? "cloudbase.website" : d.trim().toLowerCase(Locale.ROOT);
    }

    public String toFqdn(String slug) {
        return normalizeSlug(slug) + "." + baseDomain();
    }

    public boolean isVanityFqdn(String host) {
        if (host == null || host.isBlank()) {
            return false;
        }
        String h = host.trim().toLowerCase(Locale.ROOT);
        String suffix = "." + baseDomain();
        if (!h.endsWith(suffix)) {
            return false;
        }
        String slug = h.substring(0, h.length() - suffix.length());
        return validateSlugOrNull(slug) == null && !orchestrator.isOpaquePlatformDomain(h);
    }

    /** Keep this service's platform host if it is the account's claimed vanity. */
    public boolean isClaimedVanityForService(ServiceEntity service) {
        if (service == null || service.getProject() == null) {
            return false;
        }
        String ownerId = service.getProject().getOwnerId();
        if (ownerId == null) {
            return false;
        }
        UserEntity owner = userRepository.findById(ownerId).orElse(null);
        if (owner == null || owner.getVanitySlug() == null || owner.getVanitySlug().isBlank()) {
            return false;
        }
        if (owner.getVanityServiceId() == null || !owner.getVanityServiceId().equals(service.getId())) {
            return false;
        }
        String expected = toFqdn(owner.getVanitySlug());
        String current = service.getSubdomain() == null ? "" : service.getSubdomain().trim().toLowerCase(Locale.ROOT);
        return expected.equalsIgnoreCase(current);
    }

    public VanityStatusResponse status(UserEntity actor, String serviceId) {
        ServiceEntity service = requireRoutableService(serviceId, actor);
        UserEntity owner = ownerOf(service);
        String slug = owner.getVanitySlug();
        String fqdn = (slug == null || slug.isBlank()) ? null : toFqdn(slug);
        boolean holds = service.getId().equals(owner.getVanityServiceId())
                && fqdn != null
                && fqdn.equalsIgnoreCase(nullToEmpty(service.getSubdomain()));
        return new VanityStatusResponse(
                baseDomain(),
                1,
                slug,
                fqdn,
                owner.getVanityServiceId(),
                holds
        );
    }

    public DomainCheckResponse check(UserEntity actor, String serviceId, String rawSlug) {
        ServiceEntity service = requireRoutableService(serviceId, actor);
        UserEntity owner = ownerOf(service);
        String slug = normalizeSlug(rawSlug);
        if (slug.isBlank()) {
            return new DomainCheckResponse("", false, "Enter a subdomain slug (3–30 characters)");
        }
        String invalid = validateSlugOrNull(slug);
        if (invalid != null) {
            return new DomainCheckResponse(slug, false, invalid);
        }

        String fqdn = toFqdn(slug);

        if (slug.equalsIgnoreCase(nullToEmpty(owner.getVanitySlug()))
                && serviceId.equals(owner.getVanityServiceId())) {
            return new DomainCheckResponse(fqdn, true, "Already claimed on this service");
        }

        // Another account owns this slug
        var otherUser = userRepository.findByVanitySlugIgnoreCase(slug)
                .filter(u -> !u.getId().equals(owner.getId()));
        if (otherUser.isPresent()) {
            return new DomainCheckResponse(fqdn, false, "Subdomain already taken");
        }

        // Hostname already used as platform or custom domain on any service
        if (hostnameTaken(fqdn, serviceId)) {
            return new DomainCheckResponse(fqdn, false, "Subdomain already in use");
        }

        // Account already used its one vanity on a different service with a different slug
        if (owner.getVanitySlug() != null && !owner.getVanitySlug().isBlank()
                && owner.getVanityServiceId() != null
                && !owner.getVanityServiceId().equals(serviceId)
                && !slug.equalsIgnoreCase(owner.getVanitySlug())) {
            return new DomainCheckResponse(
                    fqdn,
                    false,
                    "This account already claimed `" + owner.getVanitySlug() + "." + baseDomain()
                            + "` on another service. Release it first, or move that same slug here."
            );
        }

        if (owner.getVanitySlug() != null && !owner.getVanitySlug().isBlank()
                && !slug.equalsIgnoreCase(owner.getVanitySlug())
                && owner.getVanityServiceId() != null
                && owner.getVanityServiceId().equals(serviceId)) {
            return new DomainCheckResponse(fqdn, true, "Available (will replace your current vanity)");
        }

        if (owner.getVanitySlug() != null && !owner.getVanitySlug().isBlank()
                && slug.equalsIgnoreCase(owner.getVanitySlug())
                && owner.getVanityServiceId() != null
                && !owner.getVanityServiceId().equals(serviceId)) {
            return new DomainCheckResponse(fqdn, true, "Available — will move your vanity to this service");
        }

        return new DomainCheckResponse(fqdn, true, "Available");
    }

    @Transactional
    public ServiceEntity claim(UserEntity actor, String serviceId, String rawSlug) {
        DomainCheckResponse check = check(actor, serviceId, rawSlug);
        if (!check.available()) {
            throw new ResponseStatusException(
                    check.reason() != null && check.reason().toLowerCase(Locale.ROOT).contains("taken")
                            ? HttpStatus.CONFLICT
                            : HttpStatus.BAD_REQUEST,
                    check.reason()
            );
        }

        ServiceEntity service = requireRoutableService(serviceId, actor);
        UserEntity owner = ownerOf(service);
        String slug = normalizeSlug(rawSlug);
        String fqdn = toFqdn(slug);

        // Move away from previous service if needed
        if (owner.getVanityServiceId() != null && !owner.getVanityServiceId().equals(serviceId)) {
            serviceRepository.findById(owner.getVanityServiceId()).ifPresent(prev -> {
                if (!orchestrator.isOpaquePlatformDomain(prev.getSubdomain())) {
                    prev.setSubdomain(orchestrator.allocateOpaqueFqdn(prev.getId()));
                    serviceRepository.save(prev);
                    orchestrator.ensureProxyHost(prev);
                }
            });
        }

        owner.setVanitySlug(slug);
        owner.setVanityServiceId(service.getId());
        userRepository.save(owner);

        service.setSubdomain(fqdn);
        if (service.getContainerName() == null) {
            service.setContainerName("cb-" + service.getId());
        }
        ServiceEntity saved = serviceRepository.save(service);
        orchestrator.ensureProxyHost(saved);
        return saved;
    }

    @Transactional
    public ServiceEntity release(UserEntity actor, String serviceId) {
        ServiceEntity service = requireRoutableService(serviceId, actor);
        UserEntity owner = ownerOf(service);

        if (owner.getVanityServiceId() == null || !owner.getVanityServiceId().equals(serviceId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "This service does not hold your vanity subdomain");
        }

        owner.setVanitySlug(null);
        owner.setVanityServiceId(null);
        userRepository.save(owner);

        service.setSubdomain(orchestrator.allocateOpaqueFqdn(service.getId()));
        ServiceEntity saved = serviceRepository.save(service);
        orchestrator.ensureProxyHost(saved);
        return saved;
    }

    /** Clear account vanity pointer when the holding service is deleted. */
    @Transactional
    public void clearIfServiceDeleted(String serviceId, String ownerId) {
        if (serviceId == null || ownerId == null) {
            return;
        }
        userRepository.findById(ownerId).ifPresent(owner -> {
            if (serviceId.equals(owner.getVanityServiceId())) {
                owner.setVanitySlug(null);
                owner.setVanityServiceId(null);
                userRepository.save(owner);
            }
        });
    }

    private ServiceEntity requireRoutableService(String serviceId, UserEntity actor) {
        ServiceEntity service = serviceRepository.findById(serviceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service not found"));
        String ownerId = service.getProject().getOwnerId();
        boolean admin = actor.getRole() == UserRole.ADMIN;
        if (!admin && (ownerId == null || !ownerId.equals(actor.getId()))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Not allowed");
        }
        if (service.getSourceType() == ServiceSourceType.DATABASE) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Databases are not publicly routed");
        }
        return service;
    }

    private UserEntity ownerOf(ServiceEntity service) {
        String ownerId = service.getProject().getOwnerId();
        if (ownerId == null || ownerId.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Project has no owner");
        }
        return userRepository.findById(ownerId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Project owner not found"));
    }

    private boolean hostnameTaken(String fqdn, String excludeServiceId) {
        boolean asSub = serviceRepository.findBySubdomainIgnoreCase(fqdn)
                .filter(s -> excludeServiceId == null || !s.getId().equals(excludeServiceId))
                .isPresent();
        if (asSub) {
            return true;
        }
        return serviceRepository.findByCustomDomainIgnoreCase(fqdn)
                .filter(s -> excludeServiceId == null || !s.getId().equals(excludeServiceId))
                .isPresent();
    }

    static String normalizeSlug(String raw) {
        if (raw == null) {
            return "";
        }
        String s = raw.trim().toLowerCase(Locale.ROOT);
        s = s.replaceFirst("^https?://", "");
        // allow pasting full fqdn — take left-most label only
        if (s.contains(".")) {
            s = s.substring(0, s.indexOf('.'));
        }
        s = s.replaceAll("[^a-z0-9-]", "");
        return s;
    }

    /** @return error message or null if valid */
    String validateSlugOrNull(String slug) {
        if (slug == null || slug.isBlank()) {
            return "Enter a subdomain slug (3–30 characters)";
        }
        if (slug.length() < MIN_LEN || slug.length() > MAX_LEN) {
            return "Slug must be " + MIN_LEN + "–" + MAX_LEN + " characters";
        }
        if (!SLUG.matcher(slug).matches()) {
            return "Use lowercase letters, numbers, hyphens; start with a letter; end with letter/number";
        }
        if (slug.contains("--")) {
            return "Consecutive hyphens are not allowed";
        }
        if (RESERVED.contains(slug)) {
            return "This subdomain is reserved";
        }
        if (slug.matches("cloudbase\\d{4}")) {
            return "This format is reserved for automatic random URLs";
        }
        if (slug.startsWith("cloudbase") && slug.length() > 9 && slug.substring(9).chars().allMatch(Character::isDigit)) {
            return "Slugs starting with cloudbase+digits are reserved";
        }
        return null;
    }

    private static String nullToEmpty(String v) {
        return v == null ? "" : v;
    }
}
