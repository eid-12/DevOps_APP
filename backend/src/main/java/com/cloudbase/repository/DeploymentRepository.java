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

    List<DeploymentEntity> findByServiceIdOrderByStartedAtDesc(String serviceId, org.springframework.data.domain.Pageable page);

    long countByProjectIdInAndStartedAtGreaterThanEqual(Collection<String> projectIds, Instant since);

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

    List<DeploymentEntity> findByServiceIdAndCommitShaAndStatusIn(
            String serviceId,
            String commitSha,
            Collection<DeploymentStatus> statuses
    );

    /**
     * Row lock for read-modify-write of one deployment. Stage updates and the final outcome run on different
     * threads; without it a late stage write could overwrite FAILED/SUCCESS and leave the deploy "running".
     */
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("select d from DeploymentEntity d where d.id = :id")
    java.util.Optional<DeploymentEntity> findByIdForUpdate(@Param("id") String id);

    void deleteByServiceId(String serviceId);

    void deleteByProjectId(String projectId);
}
