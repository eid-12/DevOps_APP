package com.cloudbase.repository;

import com.cloudbase.entity.ServiceMetricEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

public interface ServiceMetricRepository extends JpaRepository<ServiceMetricEntity, Long> {

    List<ServiceMetricEntity> findByServiceIdAndRecordedAtGreaterThanEqualOrderByRecordedAtAsc(
            String serviceId,
            Instant since
    );

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("delete from ServiceMetricEntity m where m.recordedAt < :cutoff")
    int deleteOlderThan(@Param("cutoff") Instant cutoff);
}
