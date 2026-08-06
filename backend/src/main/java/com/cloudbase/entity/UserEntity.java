package com.cloudbase.entity;

import com.cloudbase.model.AccountStatus;
import com.cloudbase.model.UserRole;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;

@Entity
@Table(name = "users")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class UserEntity {

    @Id
    @Column(length = 36)
    private String id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(nullable = false)
    private String passwordHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private UserRole role;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private AccountStatus accountStatus;

    @Column(nullable = false)
    private boolean deploymentEnabled;

    @Column(nullable = false)
    @Builder.Default
    private boolean emailVerified = false;

    /** 6-digit signup code (cleared after verify). */
    @Column(length = 20)
    private String emailVerificationCode;

    private Instant emailVerificationExpiresAt;

    /** Step 1 GitHub link — OAuth token arrives in Step 2 */
    private String githubUsername;
    private String githubAvatarUrl;
    private String githubDisplayName;
    private Instant githubConnectedAt;
    /** Comma-separated scopes, e.g. read:user,repo */
    private String githubScopes;
    @Column(length = 2048)
    private String githubAccessToken;

    @CreationTimestamp
    private Instant createdAt;

    @UpdateTimestamp
    private Instant updatedAt;
}
