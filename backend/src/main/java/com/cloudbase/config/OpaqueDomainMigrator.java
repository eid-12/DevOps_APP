package com.cloudbase.config;

import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.repository.ServiceRepository;
import com.cloudbase.service.DeploymentOrchestrator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * Ensures DATABASE services have no public hosts and refreshes NPM proxies.
 * Preserves each account's one claimed vanity subdomain; other hosts stay opaque.
 */
@Component
public class OpaqueDomainMigrator implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(OpaqueDomainMigrator.class);

    private final ServiceRepository serviceRepository;
    private final DeploymentOrchestrator orchestrator;

    public OpaqueDomainMigrator(ServiceRepository serviceRepository, DeploymentOrchestrator orchestrator) {
        this.serviceRepository = serviceRepository;
        this.orchestrator = orchestrator;
    }

    @Override
    public void run(ApplicationArguments args) {
        int rewritten = 0;
        for (var service : serviceRepository.findAll()) {
            if (service.getSourceType() == ServiceSourceType.DATABASE) {
                if (service.getSubdomain() != null || service.getCustomDomain() != null) {
                    service.setSubdomain(null);
                    service.setCustomDomain(null);
                    serviceRepository.save(service);
                    rewritten++;
                }
                continue;
            }
            String before = service.getSubdomain();
            orchestrator.ensureOpaquePlatformDomain(service);
            if (before == null || !before.equalsIgnoreCase(service.getSubdomain())) {
                rewritten++;
            }
            try {
                orchestrator.ensureProxyHost(service);
            } catch (Exception e) {
                log.warn("NPM refresh failed for {}: {}", service.getId(), e.getMessage());
            }
        }
        if (rewritten > 0) {
            log.info("Opaque domain migration: rewritten {} platform host(s)", rewritten);
        }
    }
}
