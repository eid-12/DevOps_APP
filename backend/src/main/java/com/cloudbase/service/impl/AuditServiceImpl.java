package com.cloudbase.service.impl;

import com.cloudbase.entity.AuditLogEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.AuditAction;
import com.cloudbase.repository.AuditLogRepository;
import com.cloudbase.service.AuditService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class AuditServiceImpl implements AuditService {

    private final AuditLogRepository auditLogRepository;

    public AuditServiceImpl(AuditLogRepository auditLogRepository) {
        this.auditLogRepository = auditLogRepository;
    }

    @Override
    public void record(UserEntity actor, AuditAction action, String target, String details) {
        AuditLogEntity entry = AuditLogEntity.builder()
                .id("aud-" + UUID.randomUUID().toString().substring(0, 8))
                .actorName(actor != null && actor.getName() != null ? actor.getName() : "System")
                .actorEmail(actor != null && actor.getEmail() != null ? actor.getEmail() : "system@cloudbase.dev")
                .action(action)
                .target(target != null ? target : "")
                .details(details != null ? details : "")
                .build();
        auditLogRepository.save(entry);
    }

    @Override
    @Transactional(readOnly = true)
    public List<AuditLogEntity> listRecent() {
        return auditLogRepository.findAllByOrderByTimestampDesc();
    }
}
