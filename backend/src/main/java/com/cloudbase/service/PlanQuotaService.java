package com.cloudbase.service;

import com.cloudbase.entity.ProjectEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.UserRole;
import com.cloudbase.repository.DeploymentRepository;
import com.cloudbase.repository.ProjectRepository;
import com.cloudbase.repository.ServiceRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class PlanQuotaService {

    private final ProjectRepository projectRepository;
    private final ServiceRepository serviceRepository;
    private final DeploymentRepository deploymentRepository;

    public PlanQuotaService(
            ProjectRepository projectRepository,
            ServiceRepository serviceRepository,
            DeploymentRepository deploymentRepository
    ) {
        this.projectRepository = projectRepository;
        this.serviceRepository = serviceRepository;
        this.deploymentRepository = deploymentRepository;
    }

    public Map<String, Object> planInfo() {
        Map<String, Object> plan = new LinkedHashMap<>();
        plan.put("name", FreePlanLimits.PLAN_NAME);
        plan.put("priceLabel", FreePlanLimits.PRICE_LABEL);
        // Soft guidance only - counts are not hard-enforced
        plan.put("projectsLimit", FreePlanLimits.PROJECTS_SOFT);
        plan.put("servicesLimit", FreePlanLimits.SERVICES_SOFT);
        plan.put("projectsUnlimited", true);
        plan.put("servicesUnlimited", true);
        plan.put("memoryMbLimit", FreePlanLimits.MEMORY_MB);
        plan.put("cpuMilliLimit", FreePlanLimits.CPU_MILLI);
        plan.put("storageGbLimit", FreePlanLimits.STORAGE_GB);
        plan.put("deploymentsLimit", FreePlanLimits.DEPLOYMENTS_SOFT);
        plan.put("deploymentsUnlimited", true);
        plan.put("customDomains", true);
        plan.put("prioritySupport", false);
        return plan;
    }

    public Map<String, Object> usageFor(UserEntity user) {
        UsageSnapshot snap = snapshot(user);
        Map<String, Object> usage = new LinkedHashMap<>();
        usage.put("projects", snap.projects);
        usage.put("services", snap.services);
        usage.put("runningServices", snap.running);
        usage.put("cpuMilliUsed", snap.cpuMilli);
        usage.put("cpuMilliLimit", FreePlanLimits.CPU_MILLI);
        usage.put("memoryMbUsed", snap.memoryMb);
        usage.put("memoryMbLimit", FreePlanLimits.MEMORY_MB);
        usage.put("storageGbUsed", snap.storageGb);
        usage.put("storageGbLimit", FreePlanLimits.STORAGE_GB);
        usage.put("deploymentsThisMonth", snap.deploymentsThisMonth);
        return usage;
    }

    /** Project count is open - no hard cap. */
    public void assertCanCreateProject(UserEntity user) {
        if (isAdmin(user)) return;
        assertNotAlreadyOverResources(user);
    }

    public void assertCanAddService(UserEntity user, int memoryMb, int storageGb, int cpuMilli) {
        if (isAdmin(user)) return;
        UsageSnapshot snap = snapshot(user);
        if (snap.memoryMb + Math.max(0, memoryMb) > FreePlanLimits.MEMORY_MB) {
            deny("RAM (" + FreePlanLimits.MEMORY_MB + " MB)", FreePlanLimits.MEMORY_MB);
        }
        if (snap.storageGb + Math.max(0, storageGb) > FreePlanLimits.STORAGE_GB) {
            deny("storage (" + FreePlanLimits.STORAGE_GB + " GB)", FreePlanLimits.STORAGE_GB);
        }
        if (snap.cpuMilli + Math.max(0, cpuMilli) > FreePlanLimits.CPU_MILLI) {
            deny("CPU (" + FreePlanLimits.CPU_MILLI + "m)", FreePlanLimits.CPU_MILLI);
        }
    }

    /** Monthly deploy count is open - no hard cap. */
    public void assertCanDeploy(UserEntity user) {
        if (isAdmin(user)) return;
        // Resource overage still blocks new deploys elsewhere; count itself is unlimited.
    }

    /** Block create/add while already over resource caps (counts are unlimited). */
    public void assertNotAlreadyOver(UserEntity user) {
        assertNotAlreadyOverResources(user);
    }

    private void assertNotAlreadyOverResources(UserEntity user) {
        if (isAdmin(user)) return;
        UsageSnapshot snap = snapshot(user);
        if (snap.memoryMb > FreePlanLimits.MEMORY_MB
                || snap.storageGb > FreePlanLimits.STORAGE_GB
                || snap.cpuMilli > FreePlanLimits.CPU_MILLI) {
            throw new ResponseStatusException(
                    HttpStatus.PAYMENT_REQUIRED,
                    "Over Free plan resource limits. Downsize RAM/CPU/storage before adding more. See Billing."
            );
        }
    }

    public void assertCanUpdateQuotas(UserEntity user, int memoryDelta, int storageDelta, int cpuDelta) {
        if (isAdmin(user)) return;
        UsageSnapshot snap = snapshot(user);
        if (memoryDelta > 0 && snap.memoryMb + memoryDelta > FreePlanLimits.MEMORY_MB) {
            deny("RAM (" + FreePlanLimits.MEMORY_MB + " MB)", FreePlanLimits.MEMORY_MB);
        }
        if (storageDelta > 0 && snap.storageGb + storageDelta > FreePlanLimits.STORAGE_GB) {
            deny("storage (" + FreePlanLimits.STORAGE_GB + " GB)", FreePlanLimits.STORAGE_GB);
        }
        if (cpuDelta > 0 && snap.cpuMilli + cpuDelta > FreePlanLimits.CPU_MILLI) {
            deny("CPU (" + FreePlanLimits.CPU_MILLI + "m)", FreePlanLimits.CPU_MILLI);
        }
    }

    private UsageSnapshot snapshot(UserEntity user) {
        List<ProjectEntity> projects = projectRepository.findByOwnerId(user.getId());
        int projectCount = projects.size();
        int services = 0;
        int running = 0;
        int memoryMb = 0;
        int cpuMilli = 0;
        int storageGb = 0;
        for (ProjectEntity p : projects) {
            List<ServiceEntity> list = serviceRepository.findByProject_Id(p.getId());
            for (ServiceEntity s : list) {
                services++;
                if (s.getStatus() != null && "RUNNING".equals(s.getStatus().name())) {
                    running++;
                }
                memoryMb += Math.max(0, s.getQuotaMemoryMb());
                cpuMilli += Math.max(0, s.getQuotaCpuMilli());
                if (s.getVolumeSizeGb() != null && s.getVolumeSizeGb() > 0) {
                    storageGb += s.getVolumeSizeGb();
                }
            }
        }
        Instant monthStart = Instant.now().minus(30, ChronoUnit.DAYS);
        int deploys = 0;
        for (ProjectEntity p : projects) {
            for (ServiceEntity s : serviceRepository.findByProject_Id(p.getId())) {
                deploys += (int) deploymentRepository.findByServiceIdOrderByStartedAtDesc(s.getId()).stream()
                        .filter(d -> d.getStartedAt() != null && !d.getStartedAt().isBefore(monthStart))
                        .count();
            }
        }
        return new UsageSnapshot(projectCount, services, running, memoryMb, cpuMilli, storageGb, deploys);
    }

    private static void deny(String what, int limit) {
        throw new ResponseStatusException(
                HttpStatus.PAYMENT_REQUIRED,
                "Free plan limit reached: " + what + " (max " + limit + "). Delete resources or see Billing."
        );
    }

    private static boolean isAdmin(UserEntity user) {
        return user != null && user.getRole() == UserRole.ADMIN;
    }

    private record UsageSnapshot(
            int projects,
            int services,
            int running,
            int memoryMb,
            int cpuMilli,
            int storageGb,
            int deploymentsThisMonth
    ) {}
}
