package com.cloudbase.model;

public record ResourceQuota(int memoryMb, int cpuMilli, int storageGb) {

    public static ResourceQuota defaultQuota() {
        return new ResourceQuota(512, 500, 2);
    }
}
