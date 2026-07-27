package com.cloudbase.model;

public record ProjectRecord(
        String id,
        String ownerId,
        String ownerName,
        String name,
        String repository,
        String framework,
        String branch,
        String subdomain,
        ProjectStatus status,
        ResourceQuota quota,
        double cpuUsage,
        int ramUsageMb
) {

    public ProjectRecord withStatus(ProjectStatus nextStatus) {
        return new ProjectRecord(
                id,
                ownerId,
                ownerName,
                name,
                repository,
                framework,
                branch,
                subdomain,
                nextStatus,
                quota,
                cpuUsage,
                ramUsageMb
        );
    }

    public ProjectRecord withQuota(ResourceQuota nextQuota) {
        return new ProjectRecord(
                id,
                ownerId,
                ownerName,
                name,
                repository,
                framework,
                branch,
                subdomain,
                status,
                nextQuota,
                cpuUsage,
                ramUsageMb
        );
    }
}
