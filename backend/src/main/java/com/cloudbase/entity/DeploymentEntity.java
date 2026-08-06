package com.cloudbase.entity;

import com.cloudbase.model.DeploymentStatus;
import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

@Entity
@Table(name = "deployments")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class DeploymentEntity {

    @Id
    @Column(length = 36)
    private String id;

    @Column(nullable = false)
    private String serviceId;

    @Column(nullable = false)
    private String projectId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private DeploymentStatus status;

    private String triggeredBy;
    private String commitSha;
    private String imageTag;
    private String rollbackOf;
    private Integer portainerStackId;

    @Column(columnDefinition = "TEXT")
    private String composeSnapshot;

    private Instant startedAt;
    private Instant finishedAt;

    @Column(columnDefinition = "TEXT")
    private String logs;
}
