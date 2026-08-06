package com.cloudbase.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.model.ServiceStatus;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;

@Entity
@Table(name = "services")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class ServiceEntity {

    @Id
    @Column(length = 36)
    private String id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "project_id", nullable = false)
    private ProjectEntity project;

    @Column(nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ServiceSourceType sourceType;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> sourceDetails;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ServiceStatus status;

    private String subdomain;

    /** Optional user-owned hostname (e.g. app.example.com). Platform *.baseDomain stays opaque. */
    private String customDomain;

    private Integer portainerStackId;
    private Integer npmProxyHostId;
    private String containerName;
    private Integer containerPort;

    @Builder.Default
    private boolean envPendingDeploy = false;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> envVars;

    private String volumeMountPath;
    private Integer volumeSizeGb;

    private int quotaMemoryMb;
    private int quotaCpuMilli;
    private int quotaStorageGb;

    private String latestDeploymentId;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @JsonProperty("projectId")
    public String getProjectId() {
        return project != null ? project.getId() : null;
    }
}
