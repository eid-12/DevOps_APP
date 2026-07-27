import { Injectable } from '@angular/core';
import {
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

  updateUser(user: UserAccount): UserAccount {
    this.users = this.users.map((item) => (item.id === user.id ? user : item));
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

  approveProject(projectId: string, memory: string, cpu: string): ProjectRecord {
    const project = this.requireProject(projectId);
    const next: ProjectRecord = {
      ...project,
      status: 'RUNNING',
      quota: { memory, cpu },
      cpuUsage: 12.4,
      ramUsageMb: 180
    };
    this.projects = this.projects.map((item) => (item.id === projectId ? next : item));
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

  private requireProject(projectId: string): ProjectRecord {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    return project;
  }
}
