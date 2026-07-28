import { Injectable } from '@angular/core';
import {
  AuditLogEntry,
  InfrastructureOverview,
  ProjectRecord,
  ProjectStatus,
  UserAccount
} from './models';

@Injectable({ providedIn: 'root' })
export class MockStore {
  private readonly passwords = new Map<string, string>([
    ['admin@cloudbase.dev', 'Admin@2026'],
    ['dev@cloudbase.dev', 'Dev@2026']
  ]);

  users: UserAccount[] = [
    {
      id: 'u-admin',
      name: 'CloudBase Admin',
      email: 'admin@cloudbase.dev',
      role: 'ADMIN',
      deploymentEnabled: true
    },
    {
      id: 'u-dev',
      name: 'Developer One',
      email: 'dev@cloudbase.dev',
      role: 'USER',
      deploymentEnabled: true
    }
  ];

  auditLogs: AuditLogEntry[] = [
    {
      id: 'log-1001',
      timestamp: '2026-07-27T08:12:00.000Z',
      actorName: 'CloudBase Admin',
      actorEmail: 'admin@cloudbase.dev',
      action: 'PROJECT_APPROVED',
      target: 'api-gateway-service',
      details: 'Approved with 1.0 vCPU and 1 GB RAM'
    },
    {
      id: 'log-1002',
      timestamp: '2026-07-26T19:40:00.000Z',
      actorName: 'CloudBase Admin',
      actorEmail: 'admin@cloudbase.dev',
      action: 'DEPLOY_ACCESS_ENABLED',
      target: 'Developer One',
      details: 'Deployment access enabled for dev@cloudbase.dev'
    }
  ];

  projects: ProjectRecord[] = [
    {
      id: 'p-1001',
      ownerId: 'u-dev',
      ownerName: 'Developer One',
      name: 'portfolio-website',
      repository: 'github.com/dev/portfolio-website',
      framework: 'angular',
      branch: 'main',
      subdomain: 'portfolio.cloudbase.website',
      status: 'PENDING_APPROVAL',
      quota: { memory: '512 MB', cpu: '0.5' },
      cpuUsage: 0,
      ramUsageMb: 0
    },
    {
      id: 'p-1002',
      ownerId: 'u-dev',
      ownerName: 'Developer One',
      name: 'api-gateway-service',
      repository: 'github.com/dev/api-gateway-service',
      framework: 'node',
      branch: 'main',
      subdomain: 'gateway.cloudbase.website',
      status: 'RUNNING',
      quota: { memory: '1 GB', cpu: '1.0' },
      cpuUsage: 23.2,
      ramUsageMb: 412
    },
    {
      id: 'p-1003',
      ownerId: 'u-dev',
      ownerName: 'Developer One',
      name: 'docs-site',
      repository: 'github.com/dev/docs-site',
      framework: 'vue',
      branch: 'main',
      subdomain: 'docs.cloudbase.website',
      status: 'STOPPED',
      quota: { memory: '256 MB', cpu: '0.25' },
      cpuUsage: 0,
      ramUsageMb: 0
    }
  ];

  findUserByEmail(email: string): UserAccount | undefined {
    return this.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
  }

  getPassword(email: string): string | undefined {
    return this.passwords.get(email);
  }

  addUser(name: string, email: string, password: string): UserAccount {
    const user: UserAccount = {
      id: `u-${Date.now()}`,
      name,
      email,
      role: 'USER',
      deploymentEnabled: true
    };
    this.users = [...this.users, user];
    this.passwords.set(email, password);
    return user;
  }

  updateUser(user: UserAccount, actor?: UserAccount): UserAccount {
    const previous = this.findUserById(user.id);
    this.users = this.users.map((item) => (item.id === user.id ? user : item));

    if (actor && previous && previous.deploymentEnabled !== user.deploymentEnabled) {
      this.addAuditLog({
        actorName: actor.name,
        actorEmail: actor.email,
        action: user.deploymentEnabled ? 'DEPLOY_ACCESS_ENABLED' : 'DEPLOY_ACCESS_DISABLED',
        target: user.name,
        details: `Deployment access ${user.deploymentEnabled ? 'enabled' : 'disabled'} for ${user.email}`
      });
    }

    return user;
  }

  findUserById(userId: string): UserAccount | undefined {
    return this.users.find((user) => user.id === userId);
  }

  listProjectsFor(user: UserAccount): ProjectRecord[] {
    if (user.role === 'ADMIN') {
      return [...this.projects];
    }
    return this.projects.filter((project) => project.ownerId === user.id);
  }

  createProject(
    user: UserAccount,
    payload: {
      name: string;
      repository: string;
      framework: string;
      branch: string;
      subdomain: string;
    }
  ): ProjectRecord {
    const project: ProjectRecord = {
      id: `p-${Date.now()}`,
      ownerId: user.id,
      ownerName: user.name,
      name: payload.name,
      repository: payload.repository,
      framework: payload.framework,
      branch: payload.branch,
      subdomain: payload.subdomain,
      status: 'PENDING_APPROVAL',
      quota: { memory: '512 MB', cpu: '0.5' },
      cpuUsage: 0,
      ramUsageMb: 0
    };
    this.projects = [project, ...this.projects];
    return project;
  }

  setProjectStatus(projectId: string, status: ProjectStatus): ProjectRecord {
    const project = this.requireProject(projectId);
    const next = { ...project, status };
    this.projects = this.projects.map((item) => (item.id === projectId ? next : item));
    return next;
  }

  approveProject(projectId: string, memory: string, cpu: string, actor?: UserAccount): ProjectRecord {
    const project = this.requireProject(projectId);
    const next: ProjectRecord = {
      ...project,
      status: 'RUNNING',
      quota: { memory, cpu },
      cpuUsage: 12.4,
      ramUsageMb: 180
    };
    this.projects = this.projects.map((item) => (item.id === projectId ? next : item));

    if (actor) {
      this.addAuditLog({
        actorName: actor.name,
        actorEmail: actor.email,
        action: 'PROJECT_APPROVED',
        target: project.name,
        details: `Approved with ${cpu} vCPU and ${memory} RAM`
      });
    }

    return next;
  }

  pendingProjects(): ProjectRecord[] {
    return this.projects.filter((project) => project.status === 'PENDING_APPROVAL');
  }

  infrastructure(): InfrastructureOverview {
    const activeContainers = this.projects.filter((project) => project.status === 'RUNNING').length;
    return {
      portainerStatus: 'connected',
      nginxProxyManagerStatus: 'connected',
      cloudflareTunnelStatus: 'active',
      activeContainers,
      hostCpuUsage: '31%',
      hostRamUsage: '6.8 GB / 16 GB'
    };
  }

  listAuditLogs(): AuditLogEntry[] {
    return [...this.auditLogs].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  private addAuditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp'> & { timestamp?: string }) {
    const log: AuditLogEntry = {
      id: `log-${Date.now()}`,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      actorName: entry.actorName,
      actorEmail: entry.actorEmail,
      action: entry.action,
      target: entry.target,
      details: entry.details
    };
    this.auditLogs = [log, ...this.auditLogs];
  }

  private requireProject(projectId: string): ProjectRecord {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    return project;
  }
}
