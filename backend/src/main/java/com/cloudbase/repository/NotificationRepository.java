package com.cloudbase.repository;

import com.cloudbase.entity.NotificationEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface NotificationRepository extends JpaRepository<NotificationEntity, String> {

    List<NotificationEntity> findTop50ByUserIdOrderByCreatedAtDesc(String userId);

    long countByUserIdAndReadFalse(String userId);

    @Modifying
    @Query("update NotificationEntity n set n.read = true where n.userId = :userId and n.read = false")
    int markAllRead(@Param("userId") String userId);
}
