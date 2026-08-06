package com.cloudbase.repository;

import com.cloudbase.entity.ProjectEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ProjectRepository extends JpaRepository<ProjectEntity, String> {
    List<ProjectEntity> findByOwnerId(String ownerId);
}
