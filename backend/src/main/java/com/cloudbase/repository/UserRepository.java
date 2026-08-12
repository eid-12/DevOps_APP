package com.cloudbase.repository;

import com.cloudbase.entity.UserEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface UserRepository extends JpaRepository<UserEntity, String> {
    Optional<UserEntity> findByEmail(String email);
    boolean existsByEmail(String email);

    @Query("select u from UserEntity u where lower(u.vanitySlug) = lower(:slug)")
    Optional<UserEntity> findByVanitySlugIgnoreCase(@Param("slug") String slug);
}
