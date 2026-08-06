package com.cloudbase.repository;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.model.ServiceSourceType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ServiceRepository extends JpaRepository<ServiceEntity, String> {
    List<ServiceEntity> findByProject_Id(String projectId);

    List<ServiceEntity> findBySourceType(ServiceSourceType sourceType);

    @Query("select s from ServiceEntity s where lower(s.subdomain) = lower(:value)")
    Optional<ServiceEntity> findBySubdomainIgnoreCase(@Param("value") String value);

    @Query("select s from ServiceEntity s where lower(s.customDomain) = lower(:value)")
    Optional<ServiceEntity> findByCustomDomainIgnoreCase(@Param("value") String value);

    @Query("""
            select case when count(s) > 0 then true else false end from ServiceEntity s
            where lower(s.subdomain) = lower(:value)
               or lower(s.customDomain) = lower(:value)
            """)
    boolean existsDomainIgnoreCase(@Param("value") String value);
}
