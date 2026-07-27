package com.cloudbase.service;

import com.cloudbase.dto.AdminDtos.InfrastructureOverview;
import com.cloudbase.model.UserAccount;

import java.util.List;

public interface AdminService {
    List<UserAccount> listUsers();

    UserAccount updateDeploymentAccess(String userId, boolean enabled);

    InfrastructureOverview infrastructureOverview();
}
