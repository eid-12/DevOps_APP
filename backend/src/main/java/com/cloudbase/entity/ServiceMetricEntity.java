package com.cloudbase.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

@Entity
@Table(name = "service_metrics")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class ServiceMetricEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "service_id", nullable = false, length = 36)
    private String serviceId;

    @Column(name = "recorded_at", nullable = false)
    private Instant recordedAt;

    @Column(name = "cpu_percent", nullable = false)
    private double cpuPercent;

    @Column(name = "memory_usage_mb", nullable = false)
    private double memoryUsageMb;

    @Column(name = "memory_limit_mb", nullable = false)
    private double memoryLimitMb;

    @Column(name = "memory_percent", nullable = false)
    private double memoryPercent;
}
