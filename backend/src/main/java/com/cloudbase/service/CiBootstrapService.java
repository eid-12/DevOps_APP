package com.cloudbase.service;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;

import java.util.Map;

/**
 * B2 — bootstrap CI on a GitHub repo: Dockerfile + Actions workflow + webhook.
 */
public interface CiBootstrapService {

    /**
     * Mutates/enriches sourceDetails (imageName, ciBootstrapped, …) and may write to GitHub.
     * Returns details map to persist on the service.
     */
    Map<String, Object> bootstrapGitHubService(UserEntity owner, ServiceEntity service);
}
