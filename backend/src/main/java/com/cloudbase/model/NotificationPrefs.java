package com.cloudbase.model;

public record NotificationPrefs(
        boolean emailDeployments,
        boolean emailFailures,
        boolean emailWeeklyUsage
) {
    public static NotificationPrefs defaults() {
        return new NotificationPrefs(true, true, false);
    }
}
