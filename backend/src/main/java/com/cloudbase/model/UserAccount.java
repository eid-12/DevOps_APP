package com.cloudbase.model;

public record UserAccount(
        String id,
        String name,
        String email,
        UserRole role,
        boolean deploymentEnabled
) {

    public UserAccount withDeploymentEnabled(boolean enabled) {
        return new UserAccount(id, name, email, role, enabled);
    }
}
