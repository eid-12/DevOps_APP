package com.cloudbase.service;

import com.cloudbase.dto.ProjectDtos.CreateProjectRequest;
import com.cloudbase.dto.ProjectDtos.CreateServiceRequest;
import com.cloudbase.dto.ProjectDtos.DeployServiceRequest;
import com.cloudbase.dto.ProjectDtos.ExecRequest;
import com.cloudbase.dto.ProjectDtos.DomainCheckResponse;
import com.cloudbase.dto.ProjectDtos.SetCustomDomainRequest;
import com.cloudbase.dto.ProjectDtos.SetSubdomainRequest;
import com.cloudbase.dto.ProjectDtos.UpdateEnvVarsRequest;
import com.cloudbase.dto.ProjectDtos.UpdateProjectRequest;
import com.cloudbase.dto.ProjectDtos.UpdateServiceRequest;
import com.cloudbase.dto.ProjectDtos.UpsertSharedVariableRequest;
import com.cloudbase.entity.DeploymentEntity;
import com.cloudbase.entity.ProjectEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;

import java.util.List;
import java.util.Map;

public interface ProjectService {
    List<ProjectEntity> listForUser(UserEntity user);
    ProjectEntity getProject(String projectId, UserEntity user);
    ProjectEntity createProject(UserEntity user, CreateProjectRequest request);
    void deleteProject(String projectId, UserEntity user);

    ServiceEntity addService(String projectId, UserEntity user, CreateServiceRequest request);
    ServiceEntity getService(String serviceId, UserEntity user);
    void deleteService(String serviceId, UserEntity user);
    ServiceEntity stopService(String serviceId, UserEntity user);
    ServiceEntity restartService(String serviceId, UserEntity user);

    DeploymentEntity deploy(String serviceId, UserEntity user, DeployServiceRequest request);
    DeploymentEntity rollback(String serviceId, String deploymentId, UserEntity user);
    List<DeploymentEntity> getDeployments(String serviceId, UserEntity user);

    ServiceEntity updateEnvVars(String serviceId, UserEntity user, UpdateEnvVarsRequest request);
    /** @deprecated Platform subdomains are opaque; use {@link #setCustomDomain}. */
    ServiceEntity setSubdomain(String serviceId, UserEntity user, SetSubdomainRequest request);
    ServiceEntity setCustomDomain(String serviceId, UserEntity user, SetCustomDomainRequest request);
    DomainCheckResponse checkCustomDomain(String serviceId, UserEntity user, String domain);

    com.cloudbase.dto.ProjectDtos.VanityStatusResponse vanityStatus(String serviceId, UserEntity user);
    DomainCheckResponse checkVanitySubdomain(String serviceId, UserEntity user, String slug);
    ServiceEntity setVanitySubdomain(String serviceId, UserEntity user, String slug);
    ServiceEntity clearVanitySubdomain(String serviceId, UserEntity user);

    List<Map<String, Object>> getServiceLogs(String serviceId, UserEntity user, int tail);
    List<String> execInService(String serviceId, UserEntity user, ExecRequest request);
    Map<String, Object> getServiceMetrics(String serviceId, UserEntity user);
    Map<String, String> getDbConnection(String serviceId, UserEntity user);

    List<Map<String, Object>> listSharedVariables(String projectId, UserEntity user);
    Map<String, Object> upsertSharedVariable(String projectId, UserEntity user, UpsertSharedVariableRequest request);
    void deleteSharedVariable(String projectId, String variableId, UserEntity user);

    ProjectEntity updateProject(String projectId, UserEntity user, UpdateProjectRequest request);
    ServiceEntity updateService(String serviceId, UserEntity user, UpdateServiceRequest request);
    DeploymentEntity cancelDeployment(String serviceId, String deploymentId, UserEntity user);

    /** System/webhook path - no interactive user JWT. */
    DeploymentEntity deployAsSystem(String serviceId, String triggeredBy, DeployServiceRequest request);
}
