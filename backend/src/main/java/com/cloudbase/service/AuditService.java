package com.cloudbase.service;

import com.cloudbase.entity.AuditLogEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.AuditAction;

import java.util.List;

public interface AuditService {
    void record(UserEntity actor, AuditAction action, String target, String details);

    List<AuditLogEntity> listRecent();
}
