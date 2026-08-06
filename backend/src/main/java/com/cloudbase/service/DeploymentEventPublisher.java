package com.cloudbase.service;

import com.cloudbase.entity.DeploymentEntity;
import com.cloudbase.entity.ServiceEntity;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * Publishes deployment status events via WebSocket/STOMP.
 * Frontend subscribes to /topic/deployments/{serviceId}
 */
@Service
public class DeploymentEventPublisher {

    private final SimpMessagingTemplate messagingTemplate;

    public DeploymentEventPublisher(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    public void publishDeploymentUpdate(DeploymentEntity deployment) {
        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("deploymentId", deployment.getId());
        payload.put("serviceId", deployment.getServiceId());
        payload.put("projectId", deployment.getProjectId());
        payload.put("status", deployment.getStatus().name());
        payload.put("startedAt", deployment.getStartedAt() != null ? deployment.getStartedAt().toString() : null);
        payload.put("finishedAt", deployment.getFinishedAt() != null ? deployment.getFinishedAt().toString() : null);
        messagingTemplate.convertAndSend("/topic/deployments/" + deployment.getServiceId(), payload);
    }

    public void publishServiceStatusUpdate(ServiceEntity service) {
        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("serviceId", service.getId());
        payload.put("name", service.getName());
        payload.put("status", service.getStatus().name());
        messagingTemplate.convertAndSend("/topic/services/" + service.getProject().getId(), payload);
    }

    public void publishLog(String serviceId, String deploymentId, String logLine) {
        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("deploymentId", deploymentId);
        payload.put("line", logLine);
        payload.put("ts", System.currentTimeMillis());
        messagingTemplate.convertAndSend("/topic/logs/" + serviceId, payload);
    }
}
