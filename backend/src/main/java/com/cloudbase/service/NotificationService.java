package com.cloudbase.service;

import com.cloudbase.entity.NotificationEntity;
import com.cloudbase.entity.UserEntity;

import java.util.List;
import java.util.Map;

public interface NotificationService {

    List<Map<String, Object>> listFor(UserEntity user);

    long unreadCount(UserEntity user);

    void markRead(UserEntity user, String id);

    void markAllRead(UserEntity user);

    void notifyUser(String userId, String title, String body, String href);
}
