package com.cloudbase.dto;

import jakarta.validation.constraints.NotBlank;

public final class ProjectDtos {

    private ProjectDtos() {
    }

    public record CreateProjectRequest(
            @NotBlank String name,
            @NotBlank String repository,
            @NotBlank String framework,
            @NotBlank String branch,
            @NotBlank String subdomain
    ) {
    }

    public record ApprovalRequest(
            @NotBlank String memory,
            @NotBlank String cpu
    ) {
    }
}
