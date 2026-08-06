package com.cloudbase.model;

public record UserAccount(
        String id,
        String name,
        String email,
        UserRole role,
        AccountStatus accountStatus,
        boolean deploymentEnabled,
        boolean emailVerified,
        GitHubConnection github
) {

    public UserAccount withDeploymentEnabled(boolean enabled) {
        return new UserAccount(id, name, email, role, accountStatus, enabled, emailVerified, github);
    }

    public UserAccount withAccountStatus(AccountStatus status) {
        return new UserAccount(id, name, email, role, status, deploymentEnabled, emailVerified, github);
    }

    public UserAccount withRole(UserRole newRole) {
        return new UserAccount(id, name, email, newRole, accountStatus, deploymentEnabled, emailVerified, github);
    }

    public UserAccount withGitHub(GitHubConnection connection) {
        return new UserAccount(id, name, email, role, accountStatus, deploymentEnabled, emailVerified, connection);
    }
}
