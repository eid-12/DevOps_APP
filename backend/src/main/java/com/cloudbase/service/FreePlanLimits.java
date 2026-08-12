package com.cloudbase.service;

/**
 * Free-plan ceilings.
 * Projects, services, and monthly deploys are open (no hard cap).
 * Hard limits apply only to the resource pool (RAM / CPU / storage).
 */
public final class FreePlanLimits {

    public static final String PLAN_NAME = "Free";
    public static final String PRICE_LABEL = "$0 / month";

    /** Soft / marketing only - not enforced. */
    public static final int PROJECTS_SOFT = 2;
    /** Soft / marketing only - not enforced. */
    public static final int SERVICES_SOFT = 3;
    /** Soft / marketing only - not enforced. */
    public static final int DEPLOYMENTS_SOFT = 100;

    public static final int MEMORY_MB = 4096;
    public static final int CPU_MILLI = 2000;
    public static final int STORAGE_GB = 5;

    private FreePlanLimits() {}
}
