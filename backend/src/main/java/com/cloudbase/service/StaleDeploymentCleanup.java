package com.cloudbase.service;

import com.cloudbase.entity.DeploymentEntity;
import com.cloudbase.model.DeploymentStatus;
import com.cloudbase.model.ServiceStatus;
import com.cloudbase.repository.DeploymentRepository;
import com.cloudbase.repository.ServiceRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;

/**
 * Orphan QUEUED/BUILDING/DEPLOYING rows (e.g. after process kill / network drop)
 * otherwise block the UI forever ("Starting container…").
 */
@Service
public class StaleDeploymentCleanup {

    private static final Logger log = LoggerFactory.getLogger(StaleDeploymentCleanup.class);
    private static final Duration STALE_AFTER = Duration.ofMinutes(20);

    private final DeploymentRepository deploymentRepository;
    private final ServiceRepository serviceRepository;
    private final DeploymentEventPublisher eventPublisher;

    public StaleDeploymentCleanup(
            DeploymentRepository deploymentRepository,
            ServiceRepository serviceRepository,
            DeploymentEventPublisher eventPublisher
    ) {
        this.deploymentRepository = deploymentRepository;
        this.serviceRepository = serviceRepository;
        this.eventPublisher = eventPublisher;
    }

    @Scheduled(fixedDelayString = "${cloudbase.deploy.stale-cleanup-ms:120000}", initialDelayString = "30000")
    @Transactional
    public void failStaleInFlightDeployments() {
        Instant cutoff = Instant.now().minus(STALE_AFTER);
        List<DeploymentEntity> stale = deploymentRepository.findStaleInFlight(
                EnumSet.of(DeploymentStatus.QUEUED, DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING),
                cutoff
        );
        if (stale.isEmpty()) {
            return;
        }
        Instant now = Instant.now();
        for (DeploymentEntity dep : stale) {
            String previous = String.valueOf(dep.getStatus());
            String msg = "Timed out — deploy stuck in " + previous + " longer than "
                    + STALE_AFTER.toMinutes() + " minutes";
            dep.setStatus(DeploymentStatus.FAILED);
            dep.setFinishedAt(now);
            dep.setErrorMessage(msg);
            dep.setLogs((dep.getLogs() == null ? "" : dep.getLogs() + "\n") + msg);
            deploymentRepository.save(dep);
            eventPublisher.publishDeploymentUpdate(dep);

            serviceRepository.findById(dep.getServiceId()).ifPresent(service -> {
                if (dep.getId().equals(service.getLatestDeploymentId())
                        && (service.getStatus() == ServiceStatus.DEPLOYING
                        || service.getStatus() == ServiceStatus.BUILDING
                        || service.getStatus() == ServiceStatus.PENDING)) {
                    service.setStatus(ServiceStatus.FAILED);
                    serviceRepository.save(service);
                    eventPublisher.publishServiceStatusUpdate(service);
                }
            });
            log.warn("Marked stale deployment {} for service {} as FAILED", dep.getId(), dep.getServiceId());
        }
    }
}
