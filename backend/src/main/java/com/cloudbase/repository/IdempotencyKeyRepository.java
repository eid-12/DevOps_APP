package com.cloudbase.repository;

import com.cloudbase.entity.IdempotencyKeyEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;

public interface IdempotencyKeyRepository extends JpaRepository<IdempotencyKeyEntity, IdempotencyKeyEntity.Key> {
    void deleteByCreatedAtBefore(Instant before);
}
