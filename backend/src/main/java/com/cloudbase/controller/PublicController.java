package com.cloudbase.controller;

import com.cloudbase.dto.PublicDtos.PlatformStatusResponse;
import com.cloudbase.service.AdminService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Unauthenticated endpoints for the marketing landing page (live Mini PC metrics).
 */
@RestController
@RequestMapping("/api/public")
public class PublicController {

    private final AdminService adminService;

    public PublicController(AdminService adminService) {
        this.adminService = adminService;
    }

    @GetMapping("/platform-status")
    public PlatformStatusResponse platformStatus() {
        return adminService.platformStatus();
    }
}
