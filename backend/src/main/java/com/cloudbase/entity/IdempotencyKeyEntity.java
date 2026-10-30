package com.cloudbase.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.Instant;

/** A create request already applied for this owner, so a retry returns the same resource. */
@Entity
@Table(name = "idempotency_keys")
@IdClass(IdempotencyKeyEntity.Key.class)
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class IdempotencyKeyEntity {

    @Id
    @Column(name = "owner_id", length = 36)
    private String ownerId;

    @Id
    @Column(name = "request_key", length = 64)
    private String requestKey;

    @Column(name = "request_hash", nullable = false, length = 64)
    private String requestHash;

    @Column(name = "resource_type", nullable = false, length = 16)
    private String resourceType;

    @Column(name = "resource_id", nullable = false, length = 36)
    private String resourceId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode
    public static class Key implements Serializable {
        private String ownerId;
        private String requestKey;
    }
}
