package com.cloudbase.controller;

import com.cloudbase.entity.UserEntity;
import com.cloudbase.service.NotificationService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @GetMapping
    public List<Map<String, Object>> list(@AuthenticationPrincipal UserEntity user) {
        return notificationService.listFor(user);
    }

    @GetMapping("/unread-count")
    public Map<String, Long> unread(@AuthenticationPrincipal UserEntity user) {
        return Map.of("count", notificationService.unreadCount(user));
    }

    @PostMapping("/{id}/read")
    public Map<String, String> markRead(
            @AuthenticationPrincipal UserEntity user,
            @PathVariable String id
    ) {
        notificationService.markRead(user, id);
        return Map.of("status", "ok");
    }

    @PostMapping("/read-all")
    public Map<String, String> markAll(@AuthenticationPrincipal UserEntity user) {
        notificationService.markAllRead(user);
        return Map.of("status", "ok");
    }
}
