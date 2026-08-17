package com.cloudbase.repository;

import com.cloudbase.entity.DeploymentEntity;
import com.cloudbase.model.DeploymentStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface DeploymentRepository extends JpaRepository<DeploymentEntity, String> {
    List<DeploymentEntity> findByServiceIdOrderByStartedAtDesc(String serviceId);
    List<DeploymentEntity> findByProjectIdOrderByStartedAtDesc(String projectId);

    List<DeploymentEntity> findByServiceIdAndStatusInAndFinishedAtIsNull(
            String serviceId,
            Collection<DeploymentStatus> statuses
    );

    void deleteByServiceId(String serviceId);

    void deleteByProjectId(String projectId);
}
