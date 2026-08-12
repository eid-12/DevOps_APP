package com.cloudbase.model;

public record UserAccount(
        String id,
        String name,
        String email,
        UserRole role,
        AccountStatus accountStatus,
        boolean deploymentEnabled,
        boolean emailVerified,
        GitHubConnection github,
        boolean onboardingDismissed,
        NotificationPrefs notifications
) {

    public UserAccount withDeploymentEnabled(boolean enabled) {
        return new UserAccount(id, name, email, role, accountStatus, enabled, emailVerified, github,
                onboardingDismissed, notifications);
    }

    public UserAccount withAccountStatus(AccountStatus status) {
        return new UserAccount(id, name, email, role, status, deploymentEnabled, emailVerified, github,
                onboardingDismissed, notifications);
    }

    public UserAccount withRole(UserRole newRole) {
        return new UserAccount(id, name, email, newRole, accountStatus, deploymentEnabled, emailVerified, github,
                onboardingDismissed, notifications);
    }

    public UserAccount withGitHub(GitHubConnection connection) {
        return new UserAccount(id, name, email, role, accountStatus, deploymentEnabled, emailVerified, connection,
                onboardingDismissed, notifications);
    }
}
