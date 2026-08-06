package com.cloudbase.model;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record ServiceRecord(
        String id,
        String projectId,
        String name,
        ServiceSourceType sourceType,
        Map<String, Object> sourceDetails,
        ServiceStatus status,
        String subdomain,
        List<EnvironmentVariable> envVars,
        VolumeMount volume,
        ResourceQuota quota,
        double cpuUsage,
        int ramUsageMb,
        String latestDeploymentId,
        Instant createdAt
) {

    public ServiceRecord withStatus(ServiceStatus nextStatus) {
        return new ServiceRecord(id, projectId, name, sourceType, sourceDetails, nextStatus,
                subdomain, envVars, volume, quota, cpuUsage, ramUsageMb, latestDeploymentId, createdAt);
    }

    public ServiceRecord withLatestDeployment(String deploymentId) {
        return new ServiceRecord(id, projectId, name, sourceType, sourceDetails, status,
                subdomain, envVars, volume, quota, cpuUsage, ramUsageMb, deploymentId, createdAt);
    }
}
