package com.cloudbase.model;

import java.time.Instant;
import java.util.List;

public record Project(
        String id,
        String ownerId,
        String ownerName,
        String name,
        String description,
        ProjectStatus status,
        Instant createdAt,
        List<ServiceRecord> services
) {

    public Project withServices(List<ServiceRecord> nextServices) {
        return new Project(id, ownerId, ownerName, name, description, status, createdAt, nextServices);
    }

    public Project withStatus(ProjectStatus nextStatus) {
        return new Project(id, ownerId, ownerName, name, description, nextStatus, createdAt, services);
    }
}
