package com.cloudbase.repository;

import com.cloudbase.entity.PlatformSettingEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PlatformSettingRepository extends JpaRepository<PlatformSettingEntity, String> {
}
