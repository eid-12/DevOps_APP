package com.cloudbase.repository;

import com.cloudbase.entity.DeploymentEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DeploymentRepository extends JpaRepository<DeploymentEntity, String> {
    List<DeploymentEntity> findByServiceIdOrderByStartedAtDesc(String serviceId);
    List<DeploymentEntity> findByProjectIdOrderByStartedAtDesc(String projectId);

    void deleteByServiceId(String serviceId);

    void deleteByProjectId(String projectId);
}
