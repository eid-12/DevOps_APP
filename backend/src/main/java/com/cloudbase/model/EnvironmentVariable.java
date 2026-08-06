package com.cloudbase.model;

public record EnvironmentVariable(String key, String value, boolean isSecret) {
}
