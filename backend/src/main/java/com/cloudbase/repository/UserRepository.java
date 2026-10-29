package com.cloudbase.repository;

import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.UserRole;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<UserEntity, String> {
    Optional<UserEntity> findByEmail(String email);
    boolean existsByEmail(String email);

    boolean existsByEmailIgnoreCase(String email);

    List<UserEntity> findAllByEmailIgnoreCase(String email);

    boolean existsByRole(UserRole role);

    @Query("select u from UserEntity u where lower(u.vanitySlug) = lower(:slug)")
    Optional<UserEntity> findByVanitySlugIgnoreCase(@Param("slug") String slug);

    Optional<UserEntity> findByVanityServiceId(String vanityServiceId);

    /** Row lock (SELECT ... FOR UPDATE) that serializes one owner's quota check-and-write. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from UserEntity u where u.id = :id")
    Optional<UserEntity> lockById(@Param("id") String id);
}
