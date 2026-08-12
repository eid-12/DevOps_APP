package com.cloudbase.service.impl;

import com.cloudbase.entity.NotificationEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.repository.NotificationRepository;
import com.cloudbase.service.NotificationService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@Transactional
public class NotificationServiceImpl implements NotificationService {

    private final NotificationRepository notificationRepository;

    public NotificationServiceImpl(NotificationRepository notificationRepository) {
        this.notificationRepository = notificationRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public List<Map<String, Object>> listFor(UserEntity user) {
        return notificationRepository.findTop50ByUserIdOrderByCreatedAtDesc(user.getId()).stream()
                .map(this::toMap)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public long unreadCount(UserEntity user) {
        return notificationRepository.countByUserIdAndReadFalse(user.getId());
    }

    @Override
    public void markRead(UserEntity user, String id) {
        NotificationEntity n = notificationRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Notification not found"));
        if (!user.getId().equals(n.getUserId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Not your notification");
        }
        n.setRead(true);
        notificationRepository.save(n);
    }

    @Override
    public void markAllRead(UserEntity user) {
        notificationRepository.markAllRead(user.getId());
    }

    @Override
    public void notifyUser(String userId, String title, String body, String href) {
        if (userId == null || userId.isBlank()) return;
        NotificationEntity n = NotificationEntity.builder()
                .id("n-" + UUID.randomUUID().toString().substring(0, 10))
                .userId(userId)
                .title(title == null ? "CloudBase" : truncate(title, 200))
                .body(body == null ? "" : truncate(body, 1000))
                .href(href == null || href.isBlank() ? null : truncate(href, 500))
                .read(false)
                .build();
        notificationRepository.save(n);
    }

    private Map<String, Object> toMap(NotificationEntity n) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", n.getId());
        m.put("title", n.getTitle());
        m.put("body", n.getBody());
        m.put("href", n.getHref());
        m.put("read", n.isRead());
        m.put("createdAt", n.getCreatedAt() != null ? n.getCreatedAt().toString() : null);
        return m;
    }

    private static String truncate(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max);
    }
}
