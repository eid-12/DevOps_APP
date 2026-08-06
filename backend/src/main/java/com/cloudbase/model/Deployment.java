package com.cloudbase.model;

import java.time.Instant;

public record Deployment(
        String id,
        String serviceId,
        String projectId,
        DeploymentStatus status,
        String triggeredBy,
        String commitSha,
        String imageTag,
        Instant startedAt,
        Instant finishedAt
) {

    public Deployment withStatus(DeploymentStatus nextStatus) {
        return new Deployment(id, serviceId, projectId, nextStatus, triggeredBy,
                commitSha, imageTag, startedAt, nextStatus == DeploymentStatus.SUCCESS
                        || nextStatus == DeploymentStatus.FAILED
                        || nextStatus == DeploymentStatus.CANCELLED ? Instant.now() : finishedAt);
    }
}
