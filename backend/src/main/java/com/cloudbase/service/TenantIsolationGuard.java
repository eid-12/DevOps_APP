package com.cloudbase.service;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.model.ServiceStatus;
import com.cloudbase.portainer.ComposeGenerator;
import com.cloudbase.portainer.EdgeRouter;
import com.cloudbase.portainer.PortainerClient;
import com.cloudbase.portainer.TenantIsolationVerifier;
import com.cloudbase.repository.ServiceRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Collectors;

/**
 * Keeps running tenants from operating without network isolation.
 *
 * Every check interval each project network that holds deployed services is probed (TenantIsolationVerifier).
 * EXPOSED (host guard missing, rules deleted, Docker restarted without them): every running container of that
 * project is stopped and its services marked quarantined, and the owner is notified. PROTECTED: quarantined
 * services, and services that should be running but are not (tenant containers do not auto-start with the Docker
 * daemon), are started again. UNVERIFIED (probe or Portainer failure): nothing is started; running containers are
 * left alone because there is no evidence of exposure.
 */
@Service
public class TenantIsolationGuard {

    private static final Logger log = LoggerFactory.getLogger(TenantIsolationGuard.class);
    private static final Duration CALL = Duration.ofSeconds(20);

    private final ServiceRepository serviceRepository;
    private final TenantIsolationVerifier verifier;
    private final EdgeRouter edge;
    private final PortainerClient portainer;
    private final ComposeGenerator composeGenerator;
    private final NotificationService notifications;
    private final TransactionTemplate tx;

    public TenantIsolationGuard(ServiceRepository serviceRepository, TenantIsolationVerifier verifier, EdgeRouter edge,
                                PortainerClient portainer, ComposeGenerator composeGenerator,
                                NotificationService notifications, TransactionTemplate tx) {
        this.serviceRepository = serviceRepository;
        this.verifier = verifier;
        this.edge = edge;
        this.portainer = portainer;
        this.composeGenerator = composeGenerator;
        this.notifications = notifications;
        this.tx = tx;
    }

    @Scheduled(fixedDelayString = "${cloudbase.isolation.check-ms:30000}", initialDelayString = "${cloudbase.isolation.check-initial-ms:20000}")
    public void check() {
        Map<String, List<ServiceEntity>> byProject = tx.execute(s -> serviceRepository.findAll().stream()
                .filter(svc -> svc.getProject() != null && svc.getPortainerStackId() != null)
                .peek(svc -> svc.getProject().getOwnerId())
                .collect(Collectors.groupingBy(svc -> svc.getProject().getId(), TreeMap::new, Collectors.toList())));
        if (byProject == null || byProject.isEmpty()) {
            return;
        }
        try {
            edge.ensureEdge().block(CALL);
        } catch (RuntimeException e) {
            log.warn("Isolation check: edge not ready: {}", e.getMessage());
        }
        byProject.forEach(this::checkProject);
    }

    void checkProject(String projectId, List<ServiceEntity> services) {
        String network = composeGenerator.projectNetworkName(projectId);
        try {
            portainer.ensureProjectNetwork(network, edge.edgeName(), true).block(CALL);
        } catch (RuntimeException e) {
            log.warn("Isolation check: project network {} not ready: {}", network, e.getMessage());
        }
        TenantIsolationVerifier.Outcome outcome = verifier.verify(network);
        switch (outcome.result()) {
            case EXPOSED -> quarantine(services, outcome.detail());
            case PROTECTED -> resume(services);
            case UNVERIFIED -> log.warn("Isolation of {} unverified ({}); not starting any of its services", network, outcome.detail());
        }
    }

    private void quarantine(List<ServiceEntity> services, String detail) {
        for (ServiceEntity svc : services) {
            String name = composeGenerator.resolveContainerName(svc);
            boolean wasRunning = running(name);
            if (wasRunning) {
                try {
                    portainer.stopContainer(name).block(CALL);
                } catch (RuntimeException e) {
                    log.error("Isolation lost but could not stop {}: {}", name, e.getMessage());
                }
            }
            if (!svc.isQuarantined() && wasRunning) {
                tx.executeWithoutResult(s -> serviceRepository.findById(svc.getId()).ifPresent(fresh -> {
                    fresh.setQuarantined(true);
                    serviceRepository.save(fresh);
                }));
                log.error("Quarantined {}: {}", name, detail);
                notifications.notifyUser(svc.getProject().getOwnerId(), "Service paused for safety",
                        svc.getName() + " was stopped because network isolation could not be confirmed. "
                                + "It restarts automatically once isolation is restored.",
                        "/projects/" + svc.getProject().getId() + "/services/" + svc.getId());
            }
        }
    }

    private void resume(List<ServiceEntity> services) {
        for (ServiceEntity svc : services) {
            String name = composeGenerator.resolveContainerName(svc);
            // Anything the owner did not stop: the runtime sync reports a stopped container as FAILED/CRASHED.
            boolean shouldRun = svc.isQuarantined() || svc.getStatus() == ServiceStatus.RUNNING
                    || svc.getStatus() == ServiceStatus.FAILED || svc.getStatus() == ServiceStatus.CRASHED;
            if (!shouldRun || running(name)) {
                if (svc.isQuarantined()) clearQuarantine(svc);
                continue;
            }
            try {
                portainer.startContainer(name).block(CALL);
                if (running(name)) {
                    clearQuarantine(svc);
                    log.info("Started {} after isolation was confirmed", name);
                }
            } catch (RuntimeException e) {
                log.warn("Could not start {}: {}", name, e.getMessage());
            }
        }
    }

    private void clearQuarantine(ServiceEntity svc) {
        tx.executeWithoutResult(s -> serviceRepository.findById(svc.getId()).ifPresent(fresh -> {
            fresh.setQuarantined(false);
            serviceRepository.save(fresh);
        }));
    }

    private boolean running(String name) {
        try {
            Map<String, Object> c = portainer.findContainer(name).block(CALL);
            return c != null && c.get("State") instanceof Map<?, ?> st && Boolean.TRUE.equals(st.get("Running"));
        } catch (RuntimeException e) {
            return false;
        }
    }
}
