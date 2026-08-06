package com.cloudbase.model;

import java.time.Instant;
import java.util.List;

/**
 * Mirrors frontend GitHubConnection (Account / Dashboard banner).
 */
public record GitHubConnection(
        boolean connected,
        String username,
        String displayName,
        String avatarUrl,
        Instant connectedAt,
        List<String> scopes
) {
    public static GitHubConnection disconnected() {
        return new GitHubConnection(false, null, null, null, null, List.of());
    }
}
