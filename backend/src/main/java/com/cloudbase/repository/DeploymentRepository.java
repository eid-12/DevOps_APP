package com.cloudbase.repository;

import com.cloudbase.entity.DeploymentEntity;
import com.cloudbase.model.DeploymentStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

public interface DeploymentRepository extends JpaRepository<DeploymentEntity, String> {
    List<DeploymentEntity> findByServiceIdOrderByStartedAtDesc(String serviceId);
    List<DeploymentEntity> findByProjectIdOrderByStartedAtDesc(String projectId);

    List<DeploymentEntity> findByServiceIdAndStatusInAndFinishedAtIsNull(
            String serviceId,
            Collection<DeploymentStatus> statuses
    );

    @Query("""
            select d from DeploymentEntity d
            where d.finishedAt is null
              and d.status in :statuses
              and d.startedAt < :before
            """)
    List<DeploymentEntity> findStaleInFlight(
            @Param("statuses") Collection<DeploymentStatus> statuses,
            @Param("before") Instant before
    );

    void deleteByServiceId(String serviceId);

    void deleteByProjectId(String projectId);
}
