package com.cloudbase.entity;

import com.cloudbase.model.ProjectStatus;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Entity
@Table(name = "projects")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class ProjectEntity {

    @Id
    @Column(length = 36)
    private String id;

    @Column(nullable = false)
    private String ownerId;

    @Column(nullable = false)
    private String ownerName;

    @Column(nullable = false)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ProjectStatus status;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "shared_variables", columnDefinition = "jsonb")
    @Builder.Default
    private List<Map<String, Object>> sharedVariables = new ArrayList<>();

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @OneToMany(mappedBy = "project", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @Builder.Default
    private List<ServiceEntity> services = new ArrayList<>();
}
