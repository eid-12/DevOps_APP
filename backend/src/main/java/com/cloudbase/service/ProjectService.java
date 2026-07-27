package com.cloudbase.service;

import com.cloudbase.dto.ProjectDtos.ApprovalRequest;
import com.cloudbase.dto.ProjectDtos.CreateProjectRequest;
import com.cloudbase.model.ProjectRecord;
import com.cloudbase.model.UserAccount;

import java.util.List;

public interface ProjectService {
    List<ProjectRecord> listForUser(UserAccount user);

    ProjectRecord create(UserAccount user, CreateProjectRequest request);

    List<ProjectRecord> pendingApprovals();

    ProjectRecord approve(String projectId, ApprovalRequest request);

    ProjectRecord start(String projectId, UserAccount user);

    ProjectRecord stop(String projectId, UserAccount user);
}
