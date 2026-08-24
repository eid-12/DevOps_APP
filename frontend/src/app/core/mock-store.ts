import { Injectable } from '@angular/core';
import {
  AccountStatus,
  ActivityEvent,
  ApiToken,
  AuditAction,
  AuditLogEntry,
  CreateProjectRequest,
  CreateServiceRequest,
  Deployment,
  EnvironmentVariable,
  GitHubConnection,
  InAppNotification,
  InfrastructureOverview,
  LogLevel,
  NotificationPrefs,
  PlanInfo,
  Project,
  ResourceQuota,
  Service,
  ServiceLogLine,
  ServiceStatus,
  SharedVariable,
  UsageSummary,
  UserAccount,
  UserRole,
  VolumeMount
} from './models';

const defaultQuota = (): ResourceQuota => ({ memorymb: 256, cpuMilli: 250, storageGb: 1 });
const defaultNotifications = (): NotificationPrefs => ({
  emailDeployments: true,
  emailFailures: true,
  emailWeeklyUsage: false
});

@Injectable({ providedIn: 'root' })
export class MockStore {
  /** Passwords keyed by user id (stable when email changes). */
  private readonly passwords = new Map<string, string>([
    ['u-admin', 'local-mock'],
    ['u-dev', 'local-mock']
  ]);

  /** One vanity slug per user: userId → { slug, serviceId } */
  private readonly vanityByUser = new Map<string, { slug: string; serviceId: string }>();

  users: UserAccount[] = [
    {
      id: 'u-admin',
      name: 'CloudBase Admin',
      email: 'admin@localhost',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      deploymentEnabled: true,
      github: null,
      notifications: defaultNotifications(),
      createdAt: new Date(Date.now() - 86400000 * 120).toISOString(),
      onboardingDismissed: true,
      planId: 'free'
    },
    {
      id: 'u-dev',
      name: 'Developer One',
      email: 'dev@localhost',
      role: 'USER',
      accountStatus: 'ACTIVE',
      deploymentEnabled: true,
      github: null,
      notifications: defaultNotifications(),
      createdAt: new Date(Date.now() - 86400000 * 40).toISOString(),
      onboardingDismissed: false,
      planId: 'free'
    }
  ];

  inbox: InAppNotification[] = [
    {
      id: 'n-1',
      userId: 'u-dev',
      title: 'maps-api deployed successfully',
      body: 'Latest deployment finished in ~18s.',
      read: false,
      createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
      href: '/projects/proj-1001/services/svc-gh-1?tab=deployments'
    },
    {
      id: 'n-2',
      userId: 'u-dev',
      title: 'Connect GitHub',
      body: 'Link GitHub to unlock private repos and auto-deploy.',
      read: false,
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      href: '/account'
    },
    {
      id: 'n-3',
      userId: 'u-dev',
      title: 'Welcome to CloudBase',
      body: 'Create a project and deploy your first service.',
      read: true,
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      href: '/dashboard'
    }
  ];

  apiTokens: ApiToken[] = [
    {
      id: 'tok-1',
      name: 'CI deploy token',
      prefix: 'cb_live_8f3a',
      createdAt: new Date(Date.now() - 86400000 * 12).toISOString(),
      lastUsedAt: new Date(Date.now() - 3600000 * 8).toISOString()
    }
  ];

  activity: ActivityEvent[] = [
    {
      id: 'act-1',
      userId: 'u-dev',
      type: 'DEPLOY',
      title: 'Deployed maps-api',
      detail: 'Deployment succeeded on Maps Backend',
      timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
      href: '/projects/proj-1001/services/svc-gh-1?tab=deployments'
    },
    {
      id: 'act-2',
      userId: 'u-dev',
      type: 'CREATE_SERVICE',
      title: 'Added maps-postgres',
      detail: 'PostgreSQL service created',
      timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
      href: '/projects/proj-1001/services/svc-db-1'
    },
    {
      id: 'act-3',
      userId: 'u-dev',
      type: 'CREATE_PROJECT',
      title: 'Created Portfolio Site',
      detail: 'Empty canvas ready for services',
      timestamp: new Date(Date.now() - 86400000).toISOString(),
      href: '/projects/proj-1002'
    }
  ];

  projects: Project[] = [
    {
      id: 'proj-1001',
      ownerId: 'u-dev',
      ownerName: 'Developer One',
      name: 'Maps Backend',
      description: 'API and database for the maps product',
      status: 'ACTIVE',
      environment: 'production',
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      sharedVariables: [
        {
          id: 'svar-1',
          key: 'DATABASE_URL',
          value: 'postgresql://maps:s3cret@maps-postgres.internal:5432/maps',
          isSecret: true,
          serviceIds: ['svc-gh-1'],
          updatedAt: new Date(Date.now() - 86400000).toISOString()
        },
        {
          id: 'svar-2',
          key: 'LOG_LEVEL',
          value: 'info',
          isSecret: false,
          serviceIds: ['svc-gh-1', 'svc-db-1'],
          updatedAt: new Date(Date.now() - 3600000).toISOString()
        }
      ],
      services: [
        {
          id: 'svc-gh-1',
          projectId: 'proj-1001',
          name: 'maps-api',
          sourceType: 'GITHUB',
          sourceDetails: {
            repositoryUrl: 'https://github.com/dev/maps-api',
            branch: 'main',
            autoDeploy: true
          },
          runtime: 'java',
          status: 'RUNNING',
          subdomain: 'maps-api.cloudbase.website',
          envVars: [{ key: 'PORT', value: '8080', isSecret: false }],
          quota: { memorymb: 512, cpuMilli: 500, storageGb: 1 },
          cpuUsage: 18.4,
          ramUsageMb: 320,
          latestDeploymentId: 'dep-seed-2',
          createdAt: new Date(Date.now() - 86400000 * 3).toISOString()
        },
        {
          id: 'svc-db-1',
          projectId: 'proj-1001',
          name: 'maps-postgres',
          sourceType: 'DATABASE',
          sourceDetails: { dbType: 'POSTGRESQL', serviceName: 'maps-postgres' },
          runtime: 'other',
          status: 'RUNNING',
          envVars: [
            { key: 'POSTGRES_USER', value: 'maps', isSecret: false },
            { key: 'POSTGRES_PASSWORD', value: 's3cret', isSecret: true }
          ],
          volume: { mountPath: '/var/lib/postgresql/data', sizeGb: 2 },
          quota: { memorymb: 256, cpuMilli: 250, storageGb: 2 },
          cpuUsage: 4.2,
          ramUsageMb: 140,
          latestDeploymentId: 'dep-seed-3',
          createdAt: new Date(Date.now() - 86400000 * 2).toISOString()
        }
      ]
    },
    {
      id: 'proj-1002',
      ownerId: 'u-dev',
      ownerName: 'Developer One',
      name: 'Portfolio Site',
      description: 'Personal portfolio frontend',
      status: 'ARCHIVED',
      environment: 'staging',
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      services: [
        {
          id: 'svc-docker-1',
          projectId: 'proj-1002',
          name: 'portfolio-web',
          sourceType: 'DOCKER',
          sourceDetails: { imageName: 'nginx', imageTag: 'alpine' },
          runtime: 'other',
          status: 'STOPPED',
          subdomain: 'portfolio.cloudbase.website',
          envVars: [],
          quota: defaultQuota(),
          cpuUsage: 0,
          ramUsageMb: 0,
          createdAt: new Date(Date.now() - 86400000).toISOString()
        }
      ]
    }
  ];

  deployments: Deployment[] = [
    {
      id: 'dep-seed-1',
      serviceId: 'svc-gh-1',
      projectId: 'proj-1001',
      status: 'SUCCESS',
      triggeredBy: 'dev@localhost',
      commitSha: 'a3f91c2',
      startedAt: new Date(Date.now() - 3600000 * 26).toISOString(),
      finishedAt: new Date(Date.now() - 3600000 * 25.8).toISOString(),
      logs: 'Build succeeded\nHealth check passed'
    },
    {
      id: 'dep-seed-2',
      serviceId: 'svc-gh-1',
      projectId: 'proj-1001',
      status: 'SUCCESS',
      triggeredBy: 'dev@localhost',
      commitSha: 'b71e044',
      startedAt: new Date(Date.now() - 3600000 * 6).toISOString(),
      finishedAt: new Date(Date.now() - 3600000 * 5.9).toISOString(),
      logs: 'Redeploy complete'
    },
    {
      id: 'dep-seed-3',
      serviceId: 'svc-db-1',
      projectId: 'proj-1001',
      status: 'SUCCESS',
      triggeredBy: 'dev@localhost',
      imageTag: 'postgres:16',
      startedAt: new Date(Date.now() - 3600000 * 48).toISOString(),
      finishedAt: new Date(Date.now() - 3600000 * 47.9).toISOString()
    },
    {
      id: 'dep-seed-4',
      serviceId: 'svc-docker-1',
      projectId: 'proj-1002',
      status: 'FAILED',
      triggeredBy: 'dev@localhost',
      imageTag: 'nginx:alpine',
      startedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
      finishedAt: new Date(Date.now() - 3600000 * 11.95).toISOString(),
      logs: 'Container exited with code 1'
    }
  ];

  auditLogs: AuditLogEntry[] = [
    {
      id: 'aud-1',
      timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
      actorName: 'CloudBase Admin',
      actorEmail: 'admin@localhost',
      action: 'ACCOUNT_ACTIVATED',
      target: 'Developer One',
      details: 'Account activated and allowed to sign in'
    },
    {
      id: 'aud-2',
      timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
      actorName: 'CloudBase Admin',
      actorEmail: 'admin@localhost',
      action: 'DEPLOY_ACCESS_ENABLED',
      target: 'Developer One',
      details: 'Deployment access enabled'
    },
    {
      id: 'aud-3',
      timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
      actorName: 'CloudBase Admin',
      actorEmail: 'admin@localhost',
      action: 'PROJECT_CREATED',
      target: 'Maps Backend',
      details: 'Project canvas created with GitHub + PostgreSQL services'
    }
  ];

  findUserByEmail(email: string): UserAccount | undefined {
    return this.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  }

  findUserById(id: string): UserAccount | undefined {
    return this.users.find(u => u.id === id);
  }

  getPassword(userIdOrEmail: string): string | undefined {
    const byId = this.passwords.get(userIdOrEmail);
    if (byId) return byId;
    const user = this.findUserByEmail(userIdOrEmail);
    return user ? this.passwords.get(user.id) : undefined;
  }

  /** Re-apply session fields after page refresh so profile edits (email, GitHub) stick. */
  hydrateSessionUser(session: UserAccount): void {
    const idx = this.users.findIndex(u => u.id === session.id);
    if (idx < 0) return;
    const current = this.users[idx];
    this.users[idx] = {
      ...current,
      name: session.name || current.name,
      email: session.email || current.email,
      github: session.github ?? current.github ?? null,
      notifications: session.notifications ?? current.notifications,
      onboardingDismissed: session.onboardingDismissed ?? current.onboardingDismissed,
      planId: 'free',
      accountStatus: session.accountStatus ?? current.accountStatus,
      deploymentEnabled: session.deploymentEnabled ?? current.deploymentEnabled
    };
  }

  addUser(name: string, email: string, password: string): UserAccount {
    const user: UserAccount = {
      id: 'u-' + Math.random().toString(36).slice(2, 10),
      name,
      email,
      role: 'USER',
      accountStatus: 'PENDING_ACTIVATION',
      deploymentEnabled: false,
      github: null,
      notifications: defaultNotifications(),
      createdAt: new Date().toISOString(),
      onboardingDismissed: false,
      planId: 'free'
    };
    this.users.push(user);
    this.passwords.set(user.id, password);
    return user;
  }

  updateUser(user: UserAccount): UserAccount {
    const idx = this.users.findIndex(u => u.id === user.id);
    if (idx >= 0) this.users[idx] = user;
    return user;
  }

  listProjectsFor(user: UserAccount): Project[] {
    if (user.role === 'ADMIN') return [...this.projects];
    return this.projects.filter(p => p.ownerId === user.id);
  }

  getProject(projectId: string): Project | undefined {
    return this.projects.find(p => p.id === projectId);
  }

  createProject(user: UserAccount, payload: CreateProjectRequest): Project {
    this.assertWithinPlan(user, { extraProjects: 1 });
    const project: Project = {
      id: 'proj-' + Math.random().toString(36).slice(2, 10),
      ownerId: user.id,
      ownerName: user.name,
      name: payload.name,
      description: payload.description ?? '',
      status: 'ACTIVE',
      environment: payload.environment ?? 'production',
      createdAt: new Date().toISOString(),
      sharedVariables: [],
      services: []
    };
    this.projects.unshift(project);
    this.pushActivity(user.id, 'CREATE_PROJECT', `Created ${project.name}`, 'New project canvas', `/projects/${project.id}`);
    this.pushInbox(user.id, 'Project created', `${project.name} is ready. Add a service to deploy.`, `/projects/${project.id}`);
    return project;
  }

  cloneProject(projectId: string, user: UserAccount): Project {
    const source = this.getProject(projectId);
    if (!source) throw new Error('Project not found');
    this.assertWithinPlan(user, {
      extraProjects: 1,
      extraServices: (source.services ?? []).length,
      extraStorageGb: (source.services ?? []).reduce((sum, s) => sum + (s.volume?.sizeGb ?? s.quota.storageGb), 0)
    });
    const clone: Project = {
      ...structuredClone(source),
      id: 'proj-' + Math.random().toString(36).slice(2, 10),
      ownerId: user.id,
      ownerName: user.name,
      name: `${source.name} Copy`,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      services: (source.services ?? []).map(s => ({
        ...structuredClone(s),
        id: 'svc-' + Math.random().toString(36).slice(2, 10),
        projectId: '',
        status: 'PENDING' as ServiceStatus,
        cpuUsage: 0,
        ramUsageMb: 0,
        latestDeploymentId: undefined,
        createdAt: new Date().toISOString()
      }))
    };
    clone.services.forEach(s => { s.projectId = clone.id; });
    this.projects.unshift(clone);
    this.pushActivity(user.id, 'CREATE_PROJECT', `Cloned ${source.name}`, `Created ${clone.name}`, `/projects/${clone.id}`);
    this.pushInbox(user.id, 'Project cloned', `${clone.name} was created from ${source.name}.`, `/projects/${clone.id}`);
    return clone;
  }

  updateProject(projectId: string, patch: {
    name?: string;
    description?: string;
    status?: Project['status'];
    environment?: Project['environment'];
  }): Project {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error('Project name is required');
      project.name = name;
    }
    if (patch.description !== undefined) project.description = patch.description;
    if (patch.status !== undefined) project.status = patch.status;
    if (patch.environment !== undefined) project.environment = patch.environment;
    return project;
  }

  deleteProject(projectId: string): void {
    const project = this.getProject(projectId);
    if (project) {
      const serviceIds = new Set((project.services ?? []).map(s => s.id));
      for (const [uid, claim] of [...this.vanityByUser.entries()]) {
        if (serviceIds.has(claim.serviceId)) {
          this.vanityByUser.delete(uid);
        }
      }
    }
    this.projects = this.projects.filter(p => p.id !== projectId);
    this.deployments = this.deployments.filter(d => d.projectId !== projectId);
  }

  addService(projectId: string, payload: CreateServiceRequest): Service {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const owner = this.findUserById(project.ownerId);
    if (owner) {
      const storageGb = payload.volume?.sizeGb ?? payload.quota?.storageGb ?? 1;
      this.assertWithinPlan(owner, { extraServices: 1, extraStorageGb: storageGb });
    }

    const service: Service = {
      id: 'svc-' + Math.random().toString(36).slice(2, 10),
      projectId,
      name: payload.name,
      sourceType: payload.sourceType,
      sourceDetails: payload.sourceDetails,
      runtime: payload.runtime ?? (payload.sourceType === 'DATABASE' ? 'other' : 'node'),
      status: 'PENDING',
      envVars: payload.envVars ?? [],
      volume: payload.volume,
      quota: {
        memorymb: payload.quota?.memorymb ?? 256,
        cpuMilli: payload.quota?.cpuMilli ?? 250,
        storageGb: payload.quota?.storageGb ?? 1
      },
      cpuUsage: 0,
      ramUsageMb: 0,
      createdAt: new Date().toISOString()
    };

    project.services = [...(project.services ?? []), service];
    this.pushActivity(
      project.ownerId,
      'CREATE_SERVICE',
      `Added ${service.name}`,
      `${service.sourceType} service created`,
      `/projects/${projectId}/services/${service.id}`
    );
    return service;
  }

  updateServiceStatus(serviceId: string, status: ServiceStatus): Service {
    for (const project of this.projects) {
      const svc = project.services?.find(s => s.id === serviceId);
      if (svc) {
        svc.status = status;
        return svc;
      }
    }
    throw new Error('Service not found');
  }

  deleteService(serviceId: string): void {
    for (const [uid, claim] of [...this.vanityByUser.entries()]) {
      if (claim.serviceId === serviceId) {
        this.vanityByUser.delete(uid);
      }
    }
    for (const project of this.projects) {
      project.services = (project.services ?? []).filter(s => s.id !== serviceId);
    }
    this.deployments = this.deployments.filter(d => d.serviceId !== serviceId);
  }

  updateService(serviceId: string, patch: { name?: string; sourceDetails?: Service['sourceDetails']; runtime?: Service['runtime'] }): Service {
    const service = this.findService(serviceId);
    if (!service) throw new Error('Service not found');
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error('Service name is required');
      service.name = name;
    }
    if (patch.sourceDetails !== undefined) {
      service.sourceDetails = patch.sourceDetails;
    }
    if (patch.runtime !== undefined) {
      service.runtime = patch.runtime;
    }
    return service;
  }

  cancelDeployment(deploymentId: string): Deployment {
    const deployment = this.deployments.find(d => d.id === deploymentId);
    if (!deployment) throw new Error('Deployment not found');
    if (deployment.status === 'SUCCESS' || deployment.status === 'FAILED' || deployment.status === 'CANCELLED') {
      throw new Error('Deployment already finished');
    }
    deployment.status = 'CANCELLED';
    deployment.finishedAt = new Date().toISOString();
    const service = this.findService(deployment.serviceId);
    if (service && (service.status === 'DEPLOYING' || service.status === 'BUILDING')) {
      service.status = 'STOPPED';
    }
    return deployment;
  }

  changePassword(userId: string, currentPassword: string, newPassword: string): void {
    const stored = this.passwords.get(userId);
    if (!stored || stored !== currentPassword) throw new Error('Current password is incorrect');
    if (newPassword.length < 6) throw new Error('New password must be at least 6 characters');
    this.passwords.set(userId, newPassword);
  }

  updateProfile(userId: string, patch: { name?: string; email?: string }): UserAccount {
    const user = this.findUserById(userId);
    if (!user) throw new Error('User not found');
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error('Name is required');
      user.name = name;
    }
    if (patch.email !== undefined) {
      const email = patch.email.trim().toLowerCase();
      if (!email) throw new Error('Email is required');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address');
      if (email !== user.email.toLowerCase()) {
        const taken = this.findUserByEmail(email);
        if (taken && taken.id !== user.id) throw new Error('Email already in use');
        user.email = email;
      }
    }
    return this.updateUser({ ...user });
  }

  connectGitHub(
    userId: string,
    username?: string,
    scopes?: string[],
    profile?: { avatarUrl?: string; displayName?: string }
  ): UserAccount {
    const user = this.findUserById(userId);
    if (!user) throw new Error('User not found');
    const login = (username?.trim() || user.email.split('@')[0] || 'developer').replace(/[^a-zA-Z0-9-]/g, '');
    const github: GitHubConnection = {
      connected: true,
      username: login,
      displayName: profile?.displayName?.trim() || undefined,
      avatarUrl: profile?.avatarUrl || `https://github.com/${login}.png`,
      connectedAt: new Date().toISOString(),
      scopes: scopes?.length ? scopes : ['repo', 'read:user', 'user:email']
    };
    const updated = this.updateUser({ ...user, github });
    this.pushActivity(userId, 'GITHUB', `Connected GitHub @${login}`, 'OAuth integration linked', '/account');
    return updated;
  }

  disconnectGitHub(userId: string): UserAccount {
    const user = this.findUserById(userId);
    if (!user) throw new Error('User not found');
    const updated = this.updateUser({ ...user, github: null });
    this.pushActivity(userId, 'GITHUB', 'Disconnected GitHub', 'GitHub integration removed', '/account');
    return updated;
  }

  updateNotifications(userId: string, prefs: NotificationPrefs): UserAccount {
    const user = this.findUserById(userId);
    if (!user) throw new Error('User not found');
    return this.updateUser({ ...user, notifications: { ...prefs } });
  }

  listApiTokens(userId: string): ApiToken[] {
    if (userId === 'u-admin') return [];
    return [...this.apiTokens];
  }

  createApiToken(userId: string, name: string): { token: ApiToken; secret: string } {
    if (!name.trim()) throw new Error('Token name is required');
    const secret = `cb_live_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 8)}`;
    const token: ApiToken = {
      id: 'tok-' + Math.random().toString(36).slice(2, 8),
      name: name.trim(),
      prefix: secret.slice(0, 12),
      createdAt: new Date().toISOString()
    };
    this.apiTokens.unshift(token);
    this.pushActivity(userId, 'SETTINGS', `Created API token “${token.name}”`, 'Token can deploy via CLI/CI', '/account');
    return { token, secret };
  }

  revokeApiToken(tokenId: string): void {
    this.apiTokens = this.apiTokens.filter(t => t.id !== tokenId);
  }

  listActivity(userId: string): ActivityEvent[] {
    return this.activity
      .filter(a => a.userId === userId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  usageFor(user: UserAccount): UsageSummary {
    const plan = this.getPlan(user);
    const projects = this.listProjectsFor(user).filter(p => p.status === 'ACTIVE');
    const services = projects.flatMap(p => p.services ?? []);
    const running = services.filter(s => s.status === 'RUNNING');
    return {
      projects: projects.length,
      services: services.length,
      runningServices: running.length,
      cpuMilliUsed: services.reduce((sum, s) => sum + (s.quota?.cpuMilli ?? 500), 0),
      cpuMilliLimit: 2000,
      memoryMbUsed: services.reduce((sum, s) => sum + (s.quota?.memorymb ?? 512), 0),
      memoryMbLimit: plan.memoryMbLimit,
      storageGbUsed: services.reduce((sum, s) => sum + (s.volume?.sizeGb ?? 0), 0),
      storageGbLimit: plan.storageGbLimit,
      deploymentsThisMonth: this.deployments.filter(d =>
        services.some(s => s.id === d.serviceId)
        && new Date(d.startedAt).getMonth() === new Date().getMonth()
        && new Date(d.startedAt).getFullYear() === new Date().getFullYear()
      ).length
    };
  }

  pushActivity(
    userId: string,
    type: ActivityEvent['type'],
    title: string,
    detail: string,
    href?: string
  ) {
    this.activity.unshift({
      id: 'act-' + Math.random().toString(36).slice(2, 10),
      userId,
      type,
      title,
      detail,
      timestamp: new Date().toISOString(),
      href
    });
  }

  pushInbox(userId: string, title: string, body: string, href?: string) {
    this.inbox.unshift({
      id: 'n-' + Math.random().toString(36).slice(2, 10),
      userId,
      title,
      body,
      read: false,
      createdAt: new Date().toISOString(),
      href
    });
  }

  listInbox(userId: string): InAppNotification[] {
    return this.inbox
      .filter(n => n.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  unreadCount(userId: string): number {
    return this.inbox.filter(n => n.userId === userId && !n.read).length;
  }

  markNotificationRead(id: string): void {
    const n = this.inbox.find(x => x.id === id);
    if (n) n.read = true;
  }

  markAllNotificationsRead(userId: string): void {
    this.inbox.filter(n => n.userId === userId).forEach(n => { n.read = true; });
  }

  restartService(serviceId: string): Service {
    const service = this.findService(serviceId);
    if (!service) throw new Error('Service not found');
    if (service.status !== 'RUNNING' && service.status !== 'CRASHED') {
      throw new Error('Only running services can be restarted');
    }
    service.status = 'DEPLOYING';
    setTimeout(() => {
      service.status = 'RUNNING';
      service.cpuUsage = 5 + Math.random() * 15;
      service.ramUsageMb = 100 + Math.floor(Math.random() * 250);
    }, 1200);
    const owner = this.projects.find(p => p.id === service.projectId)?.ownerId;
    if (owner) {
      this.pushActivity(owner, 'DEPLOY', `Restarted ${service.name}`, 'Container recycle', `/projects/${service.projectId}/services/${service.id}`);
      this.pushInbox(owner, `${service.name} restarted`, 'Service recycle completed.', `/projects/${service.projectId}/services/${service.id}`);
    }
    return service;
  }

  requestPasswordReset(email: string): string {
    const user = this.findUserByEmail(email);
    if (!user) throw new Error('No account found for that email');
    return `Password reset link sent to ${user.email} (demo — use your current password or ask an admin).`;
  }

  getPlan(_user: UserAccount): PlanInfo {
    return {
      name: 'Free',
      priceLabel: '$0 / month',
      projectsLimit: 2,
      servicesLimit: 3,
      memoryMbLimit: 4096,
      storageGbLimit: 5,
      deploymentsLimit: 100,
      projectsUnlimited: true,
      servicesUnlimited: true,
      deploymentsUnlimited: true,
      customDomains: true,
      prioritySupport: false
    };
  }

  assertWithinPlan(
    user: UserAccount,
    opts: {
      extraProjects?: number;
      extraServices?: number;
      extraStorageGb?: number;
      extraMemoryMb?: number;
      extraDeployments?: number;
    } = {}
  ): void {
    const plan = this.getPlan(user);
    const usage = this.usageFor(user);
    // Project, service, and deploy counts are open — only resource pool is hard-capped
    if (usage.storageGbUsed + (opts.extraStorageGb ?? 0) > plan.storageGbLimit) {
      throw new Error(`Free plan limit: ${plan.storageGbLimit} GB storage. See Billing.`);
    }
    if (usage.memoryMbUsed + (opts.extraMemoryMb ?? 0) > plan.memoryMbLimit) {
      throw new Error(`Free plan limit: ${plan.memoryMbLimit} MB RAM. See Billing.`);
    }
  }

  setPlan(userId: string, _planId: 'free' = 'free'): UserAccount {
    const user = this.findUserById(userId);
    if (!user) throw new Error('User not found');
    return this.updateUser({ ...user, planId: 'free' });
  }

  dismissOnboarding(userId: string): UserAccount {
    const user = this.findUserById(userId);
    if (!user) throw new Error('User not found');
    return this.updateUser({ ...user, onboardingDismissed: true });
  }

  dbConnectionInfo(serviceId: string): Record<string, string> {
    const service = this.findService(serviceId);
    if (!service || service.sourceType !== 'DATABASE') throw new Error('Not a database service');
    const d = service.sourceDetails as { dbType: string };
    const user = service.envVars.find(e => e.key.includes('USER'))?.value || 'cloudbase';
    const pass = service.envVars.find(e => e.key.includes('PASSWORD'))?.value || 'change-me';
    const host = `${service.name}.internal`;
    const port = d.dbType === 'MYSQL' ? '3306' : d.dbType === 'REDIS' ? '6379' : d.dbType === 'MONGODB' ? '27017' : '5432';
    const db = service.name.replace(/-/g, '_');
    if (d.dbType === 'REDIS') {
      return {
        host,
        port,
        url: `redis://:${pass}@${host}:${port}`,
        password: pass
      };
    }
    if (d.dbType === 'MONGODB') {
      return {
        host,
        port,
        url: `mongodb://${user}:${pass}@${host}:${port}/${db}`,
        username: user,
        password: pass,
        database: db
      };
    }
    const scheme = d.dbType === 'MYSQL' ? 'mysql' : 'postgresql';
    return {
      host,
      port,
      database: db,
      username: user,
      password: pass,
      url: `${scheme}://${user}:${pass}@${host}:${port}/${db}`
    };
  }

  deploy(serviceId: string, triggeredBy: string): Deployment {
    const service = this.findService(serviceId);
    if (!service) throw new Error('Service not found');
    const ownerId = this.projects.find(p => p.id === service.projectId)?.ownerId;
    const owner = ownerId ? this.findUserById(ownerId) : undefined;
    if (owner) {
      this.assertWithinPlan(owner, { extraDeployments: 1 });
    }

    const commitSha = service.sourceType === 'GITHUB'
      ? Math.random().toString(16).slice(2, 9)
      : undefined;
    const imageTag = service.sourceType === 'DOCKER'
      ? ((service.sourceDetails as { imageTag?: string }).imageTag || 'latest')
      : service.sourceType === 'DATABASE'
        ? String((service.sourceDetails as { dbType?: string }).dbType || 'DATABASE').toLowerCase()
        : undefined;

    const deployment: Deployment = {
      id: 'dep-' + Math.random().toString(36).slice(2, 10),
      serviceId,
      projectId: service.projectId,
      status: 'QUEUED',
      triggeredBy,
      commitSha,
      imageTag,
      startedAt: new Date().toISOString(),
      logs: 'Queued for deployment'
    };
    this.deployments.unshift(deployment);
    service.status = 'PENDING';
    service.latestDeploymentId = deployment.id;

    if (ownerId) {
      this.pushActivity(
        ownerId,
        'DEPLOY',
        `Deploying ${service.name}`,
        `Triggered by ${triggeredBy}`,
        `/projects/${service.projectId}/services/${service.id}?tab=deployments`
      );
    }

    setTimeout(() => {
      deployment.status = 'BUILDING';
      service.status = 'BUILDING';
      deployment.logs = (deployment.logs ?? '') + '\nBuilding image…';
    }, 450);

    setTimeout(() => {
      deployment.status = 'DEPLOYING';
      service.status = 'DEPLOYING';
      deployment.logs = (deployment.logs ?? '') + '\nPushing container · applying env…';
    }, 1000);

    setTimeout(() => {
      deployment.status = 'SUCCESS';
      deployment.finishedAt = new Date().toISOString();
      deployment.logs = (deployment.logs ?? '') + '\nHealth check passed · live';
      service.status = 'RUNNING';
      service.envPendingDeploy = false;
      service.cpuUsage = 8 + Math.random() * 20;
      service.ramUsageMb = 120 + Math.floor(Math.random() * 300);
      if (!service.subdomain && service.sourceType !== 'DATABASE') {
        const n = String(Math.floor(1000 + Math.random() * 9000));
        service.subdomain = `cloudbase${n}.cloudbase.website`;
      }
      if (ownerId) {
        this.pushInbox(
          ownerId,
          `${service.name} is live`,
          'Deployment finished successfully.',
          `/projects/${service.projectId}/services/${service.id}`
        );
      }
    }, 1800);

    return deployment;
  }

  rollback(serviceId: string, deploymentId: string, triggeredBy: string): Deployment {
    const service = this.findService(serviceId);
    if (!service) throw new Error('Service not found');
    const source = this.deployments.find(d => d.id === deploymentId && d.serviceId === serviceId);
    if (!source) throw new Error('Deployment not found');
    if (source.status !== 'SUCCESS') throw new Error('Only successful deployments can be rolled back');
    if (service.latestDeploymentId === source.id) {
      throw new Error('This deployment is already live');
    }

    const ownerId = this.projects.find(p => p.id === service.projectId)?.ownerId;
    const owner = ownerId ? this.findUserById(ownerId) : undefined;
    if (owner) this.assertWithinPlan(owner, { extraDeployments: 1 });

    const target = source.commitSha
      ? `commit #${source.commitSha}`
      : source.imageTag
        ? `image ${source.imageTag}`
        : source.id;

    const deployment: Deployment = {
      id: 'dep-' + Math.random().toString(36).slice(2, 10),
      serviceId,
      projectId: service.projectId,
      status: 'QUEUED',
      triggeredBy,
      commitSha: source.commitSha,
      imageTag: source.imageTag,
      startedAt: new Date().toISOString(),
      rollbackOf: source.id,
      logs: `Rollback started → ${target}`
    };
    this.deployments.unshift(deployment);
    service.status = 'DEPLOYING';
    service.latestDeploymentId = deployment.id;

    setTimeout(() => {
      deployment.status = 'BUILDING';
      deployment.logs = (deployment.logs ?? '') + `\nRestoring artifact from ${source.id}`;
    }, 400);

    setTimeout(() => {
      deployment.status = 'DEPLOYING';
      deployment.logs = (deployment.logs ?? '') + '\nRecreating container…';
    }, 900);

    setTimeout(() => {
      deployment.status = 'SUCCESS';
      deployment.finishedAt = new Date().toISOString();
      deployment.logs = (deployment.logs ?? '') + '\nRollback complete · health check passed';
      service.status = 'RUNNING';
      service.cpuUsage = 6 + Math.random() * 18;
      service.ramUsageMb = 110 + Math.floor(Math.random() * 280);
      if (ownerId) {
        this.pushInbox(
          ownerId,
          `${service.name} rolled back`,
          `Restored ${target}.`,
          `/projects/${service.projectId}/services/${service.id}?tab=deployments`
        );
      }
    }, 1800);

    return deployment;
  }

  listSharedVariables(projectId: string): SharedVariable[] {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    return [...(project.sharedVariables ?? [])].sort((a, b) => a.key.localeCompare(b.key));
  }

  upsertSharedVariable(
    projectId: string,
    payload: { id?: string; key: string; value: string; isSecret: boolean; serviceIds: string[] }
  ): SharedVariable {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    if (!project.sharedVariables) project.sharedVariables = [];

    const key = payload.key.trim().toUpperCase().replace(/\s+/g, '_');
    if (!key) throw new Error('Variable key is required');
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      throw new Error('Key must be uppercase letters, numbers, and underscores');
    }

    const validServiceIds = new Set((project.services ?? []).map(s => s.id));
    const serviceIds = payload.serviceIds.filter(id => validServiceIds.has(id));

    const existingByKey = project.sharedVariables.find(v => v.key === key && v.id !== payload.id);
    if (existingByKey) throw new Error(`Variable ${key} already exists`);

    if (payload.id) {
      const idx = project.sharedVariables.findIndex(v => v.id === payload.id);
      if (idx < 0) throw new Error('Variable not found');
      const updated: SharedVariable = {
        ...project.sharedVariables[idx],
        key,
        value: payload.value,
        isSecret: payload.isSecret,
        serviceIds,
        updatedAt: new Date().toISOString()
      };
      project.sharedVariables[idx] = updated;
      this.markServicesEnvPending(serviceIds);
      return updated;
    }

    const created: SharedVariable = {
      id: 'svar-' + Math.random().toString(36).slice(2, 10),
      key,
      value: payload.value,
      isSecret: payload.isSecret,
      serviceIds,
      updatedAt: new Date().toISOString()
    };
    project.sharedVariables.unshift(created);
    this.markServicesEnvPending(serviceIds);
    return created;
  }

  private markServicesEnvPending(serviceIds: string[]) {
    for (const id of serviceIds) {
      const svc = this.findService(id);
      if (svc) svc.envPendingDeploy = true;
    }
  }

  deleteSharedVariable(projectId: string, variableId: string): void {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    project.sharedVariables = (project.sharedVariables ?? []).filter(v => v.id !== variableId);
  }

  getDeployments(serviceId: string): Deployment[] {
    return this.deployments.filter(d => d.serviceId === serviceId);
  }

  getServiceLogs(serviceId: string, limit = 80): ServiceLogLine[] {
    const service = this.findService(serviceId);
    if (!service) return [];

    const templates = this.logTemplates(service);
    const now = Date.now();
    const lines: ServiceLogLine[] = [];

    for (let i = limit - 1; i >= 0; i--) {
      const tpl = templates[i % templates.length];
      lines.push({
        id: `log-${serviceId}-${i}`,
        timestamp: new Date(now - i * 14000 - Math.floor(Math.random() * 4000)).toISOString(),
        level: tpl.level,
        message: tpl.message
      });
    }
    return lines;
  }

  nextLiveLog(serviceId: string): ServiceLogLine | null {
    const service = this.findService(serviceId);
    if (!service || service.status !== 'RUNNING') return null;
    const templates = this.logTemplates(service);
    const tpl = templates[Math.floor(Math.random() * templates.length)];
    return {
      id: `log-live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      level: tpl.level,
      message: tpl.message
    };
  }

  updateEnvVars(serviceId: string, envVars: EnvironmentVariable[]): Service {
    const service = this.findService(serviceId);
    if (!service) throw new Error('Service not found');
    service.envVars = envVars.map(e => ({
      key: e.key.trim(),
      value: e.value,
      isSecret: e.isSecret
    })).filter(e => e.key);
    service.envPendingDeploy = true;
    return service;
  }

  updateQuota(serviceId: string, quota: Partial<ResourceQuota>): Service {
    const service = this.findService(serviceId);
    if (!service) throw new Error('Service not found');
    service.quota = {
      memorymb: quota.memorymb ?? service.quota.memorymb,
      cpuMilli: quota.cpuMilli ?? service.quota.cpuMilli,
      storageGb: quota.storageGb ?? service.quota.storageGb
    };
    return service;
  }

  updateVolume(serviceId: string, volume?: VolumeMount): Service {
    const service = this.findService(serviceId);
    if (!service) throw new Error('Service not found');
    service.volume = volume;
    return service;
  }

  setSubdomain(serviceId: string, subdomain: string): Service {
    return this.setCustomDomain(serviceId, subdomain);
  }

  checkCustomDomain(serviceId: string, domain: string): { domain: string; available: boolean; reason: string } {
    const service = this.findService(serviceId);
    if (!service) throw new Error('Service not found');
    if (service.sourceType === 'DATABASE') {
      return { domain: '', available: false, reason: 'Databases are not publicly routed' };
    }
    let clean = (domain ?? '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/[^a-z0-9.-]/g, '');
    if (!clean) {
      return { domain: '', available: true, reason: 'Empty value clears the custom domain' };
    }
    if (clean === 'cloudbase.website' || clean.endsWith('.cloudbase.website')) {
      return {
        domain: clean,
        available: false,
        reason: 'Platform domains are assigned automatically. Bring your own domain (e.g. app.example.com).'
      };
    }
    if (!clean.includes('.') || clean.startsWith('.') || clean.endsWith('.') || clean.includes('..')) {
      return { domain: clean, available: false, reason: 'Enter a full hostname like app.example.com' };
    }
    if ((service.customDomain ?? '').toLowerCase() === clean) {
      return { domain: clean, available: true, reason: 'Already assigned to this service' };
    }
    const taken = this.projects.some(p =>
      p.services.some(
        s =>
          s.id !== serviceId &&
          ((s.customDomain ?? '').toLowerCase() === clean || (s.subdomain ?? '').toLowerCase() === clean)
      )
    );
    if (taken) {
      return { domain: clean, available: false, reason: 'Domain already in use' };
    }
    return { domain: clean, available: true, reason: 'Available' };
  }

  setCustomDomain(serviceId: string, domain: string): Service {
    const service = this.findService(serviceId);
    if (!service) throw new Error('Service not found');
    const check = this.checkCustomDomain(serviceId, domain);
    let clean = check.domain;
    if (!clean) {
      service.customDomain = undefined;
      return service;
    }
    if (!check.available) {
      throw new Error(check.reason);
    }
    service.customDomain = clean;
    if (!service.subdomain) {
      const n = String(Math.floor(1000 + Math.random() * 9000));
      service.subdomain = `cloudbase${n}.cloudbase.website`;
    }
    return service;
  }

  vanityStatus(serviceId: string, userId: string) {
    const service = this.findService(serviceId);
    if (!service) throw new Error('Service not found');
    const claim = this.vanityByUser.get(userId);
    const baseDomain = 'cloudbase.website';
    return {
      baseDomain,
      limitPerAccount: 1,
      claimedSlug: claim?.slug ?? null,
      claimedFqdn: claim ? `${claim.slug}.${baseDomain}` : null,
      claimedServiceId: claim?.serviceId ?? null,
      thisServiceHoldsVanity: !!claim && claim.serviceId === serviceId
    };
  }

  checkVanitySubdomain(
    serviceId: string,
    userId: string,
    rawSlug: string
  ): { domain: string; available: boolean; reason: string } {
    const service = this.findService(serviceId);
    if (!service) throw new Error('Service not found');
    if (service.sourceType === 'DATABASE') {
      return { domain: '', available: false, reason: 'Databases are not publicly routed' };
    }
    let slug = (rawSlug ?? '').trim().toLowerCase().replace(/^https?:\/\//, '');
    if (slug.includes('.')) slug = slug.slice(0, slug.indexOf('.'));
    slug = slug.replace(/[^a-z0-9-]/g, '');
    const baseDomain = 'cloudbase.website';
    const fqdn = `${slug}.${baseDomain}`;
    if (slug.length < 3 || slug.length > 30) {
      return { domain: slug, available: false, reason: 'Slug must be 3–30 characters' };
    }
    if (!/^[a-z][a-z0-9-]{1,28}[a-z0-9]$/.test(slug) || slug.includes('--')) {
      return { domain: slug, available: false, reason: 'Invalid slug format' };
    }
    const reserved = new Set(['admin', 'api', 'www', 'app', 'mail', 'cloudbase', 'manage', 'npm', 'login']);
    if (reserved.has(slug) || /^cloudbase\d{4}$/.test(slug)) {
      return { domain: fqdn, available: false, reason: 'This subdomain is reserved' };
    }
    const claim = this.vanityByUser.get(userId);
    if (claim?.slug === slug && claim.serviceId === serviceId) {
      return { domain: fqdn, available: true, reason: 'Already claimed on this service' };
    }
    for (const [uid, c] of this.vanityByUser) {
      if (uid !== userId && c.slug === slug) {
        return { domain: fqdn, available: false, reason: 'Subdomain already taken' };
      }
    }
    const taken = this.projects.some(p =>
      p.services.some(
        s =>
          s.id !== serviceId &&
          ((s.subdomain ?? '').toLowerCase() === fqdn || (s.customDomain ?? '').toLowerCase() === fqdn)
      )
    );
    if (taken) return { domain: fqdn, available: false, reason: 'Subdomain already in use' };
    if (claim && claim.serviceId !== serviceId && claim.slug !== slug) {
      return {
        domain: fqdn,
        available: false,
        reason: `This account already claimed \`${claim.slug}.${baseDomain}\` on another service. Release it first, or move that same slug here.`
      };
    }
    return { domain: fqdn, available: true, reason: 'Available' };
  }

  setVanitySubdomain(serviceId: string, userId: string, rawSlug: string): Service {
    const check = this.checkVanitySubdomain(serviceId, userId, rawSlug);
    if (!check.available) throw new Error(check.reason);
    const service = this.findService(serviceId);
    if (!service) throw new Error('Service not found');
    const claim = this.vanityByUser.get(userId);
    if (claim && claim.serviceId !== serviceId) {
      const prev = this.findService(claim.serviceId);
      if (prev) {
        const n = String(Math.floor(1000 + Math.random() * 9000));
        prev.subdomain = `cloudbase${n}.cloudbase.website`;
      }
    }
    let slug = (rawSlug ?? '').trim().toLowerCase();
    if (slug.includes('.')) slug = slug.slice(0, slug.indexOf('.'));
    slug = slug.replace(/[^a-z0-9-]/g, '');
    this.vanityByUser.set(userId, { slug, serviceId });
    service.subdomain = `${slug}.cloudbase.website`;
    return service;
  }

  clearVanitySubdomain(serviceId: string, userId: string): Service {
    const service = this.findService(serviceId);
    if (!service) throw new Error('Service not found');
    const claim = this.vanityByUser.get(userId);
    if (!claim || claim.serviceId !== serviceId) {
      throw new Error('This service does not hold your vanity subdomain');
    }
    this.vanityByUser.delete(userId);
    const n = String(Math.floor(1000 + Math.random() * 9000));
    service.subdomain = `cloudbase${n}.cloudbase.website`;
    return service;
  }

  runTerminalCommand(serviceId: string, command: string): string[] {
    const service = this.findService(serviceId);
    if (!service) return ['error: service not found'];
    if (service.status !== 'RUNNING') {
      return ['error: container is not running. Deploy the service first.'];
    }

    const cmd = command.trim();
    if (!cmd) return [];
    const [bin, ...args] = cmd.split(/\s+/);
    const cwd = `/app/${service.name}`;

    switch (bin) {
      case 'help':
        return [
          'CloudBase shell — available commands:',
          '  help, clear, pwd, ls, whoami, env, ps, top, df, free',
          '  cat <file>, curl <url>, hostname, uptime, history',
          service.sourceType === 'DATABASE' ? '  psql / mysql / redis-cli (db helpers)' : '  npm / node (app helpers)'
        ];
      case 'pwd':
        return [cwd];
      case 'whoami':
        return ['cloudbase'];
      case 'hostname':
        return [`${service.name}-1`];
      case 'uptime':
        return ['up 2 days, 4:12,  load average: 0.18, 0.22, 0.19'];
      case 'ls':
        return service.sourceType === 'DATABASE'
          ? ['bin  data  docker-entrypoint-initdb.d  lib  usr']
          : ['Dockerfile  package.json  src  node_modules  .env  dist'];
      case 'env':
        return [
          `SERVICE_NAME=${service.name}`,
          `SERVICE_ID=${service.id}`,
          `STATUS=${service.status}`,
          ...service.envVars.map(e => `${e.key}=${e.isSecret ? '********' : e.value}`),
          'HOME=/home/cloudbase',
          'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
        ];
      case 'ps':
        return [
          'PID   USER        TIME  COMMAND',
          '  1   cloudbase   0:04  /sbin/tini -- node dist/main.js',
          ' 18   cloudbase   0:00  [healthcheck]',
          ' 42   cloudbase   0:01  bash'
        ];
      case 'top':
      case 'free':
        return [
          `CPU: ${service.cpuUsage.toFixed(1)}% / ${(service.quota.cpuMilli / 10).toFixed(0)}m`,
          `MEM: ${service.ramUsageMb}MB / ${service.quota.memorymb}MB`,
          `DISK: ${service.volume?.sizeGb ?? service.quota.storageGb}GB allocated`
        ];
      case 'df':
        return [
          'Filesystem     Size  Used Avail Use%',
          `/dev/vda1       ${service.quota.storageGb}G  1.2G  ${(service.quota.storageGb - 1.2).toFixed(1)}G  18% /`
        ];
      case 'cat': {
        const file = args[0];
        if (!file) return ['usage: cat <file>'];
        if (file === 'package.json') return ['{', '  "name": "' + service.name + '",', '  "version": "1.0.0"', '}'];
        if (file === '.env') return service.envVars.map(e => `${e.key}=${e.isSecret ? '***' : e.value}`);
        return [`cat: ${file}: No such file or directory`];
      }
      case 'curl': {
        const url = args[0] || `https://${service.subdomain ?? 'localhost'}`;
        return [
          `> GET ${url}`,
          '< HTTP/1.1 200 OK',
          '< content-type: application/json',
          '',
          `{"service":"${service.name}","status":"ok"}`
        ];
      }
      case 'psql':
      case 'mysql':
      case 'redis-cli':
        if (service.sourceType !== 'DATABASE') return [`${bin}: not a database service`];
        return [`Connected to ${service.name}.`, '(mock) Type SQL/commands — this is a simulated session.'];
      case 'npm':
      case 'node':
        if (service.sourceType === 'DATABASE') return [`${bin}: not available on database containers`];
        return args[0] === 'start'
          ? ['> node dist/main.js', `${service.name} listening on :8080`]
          : [`${bin} ${args.join(' ')}`, '(mock) command completed with exit code 0'];
      case 'clear':
        return ['__CLEAR__'];
      case 'history':
        return ['  1  ls', '  2  env', '  3  top', '  4  help'];
      default:
        return [`sh: ${bin}: command not found`, 'Type "help" for available commands.'];
    }
  }

  private logTemplates(service: Service): Array<{ level: LogLevel; message: string }> {
    if (service.sourceType === 'DATABASE') {
      return [
        { level: 'info', message: 'database system is ready to accept connections' },
        { level: 'info', message: 'checkpoint starting: time' },
        { level: 'debug', message: 'connection received: host=10.0.1.12 port=54321' },
        { level: 'info', message: 'autovacuum launcher started' },
        { level: 'warn', message: 'could not resize shared memory segment' },
        { level: 'info', message: 'LOG:  duration: 12.441 ms  statement: SELECT 1' },
        { level: 'error', message: 'ERROR:  relation "tmp_cache" does not exist' },
        { level: 'info', message: 'backup checkpoint complete' }
      ];
    }
    if (service.sourceType === 'DOCKER') {
      return [
        { level: 'info', message: 'Starting nginx 1.27.0' },
        { level: 'info', message: 'GET / 200 4ms' },
        { level: 'info', message: 'GET /assets/main.css 200 2ms' },
        { level: 'warn', message: 'upstream timed out (110: Connection timed out)' },
        { level: 'info', message: 'configuration reload requested' },
        { level: 'debug', message: 'worker process 12 exited with code 0' },
        { level: 'error', message: 'open() "/usr/share/nginx/html/favicon.ico" failed (2: No such file)' },
        { level: 'info', message: 'GET /api/health 200 1ms' }
      ];
    }
    return [
      { level: 'info', message: `Listening on http://0.0.0.0:8080` },
      { level: 'info', message: 'GET /health 200 3ms' },
      { level: 'info', message: 'GET /api/v1/maps?q=riyadh 200 48ms' },
      { level: 'debug', message: 'cache hit key=maps:riyadh ttl=54s' },
      { level: 'warn', message: 'slow query detected (312ms) route=/api/v1/routes' },
      { level: 'info', message: 'POST /api/v1/auth/refresh 200 18ms' },
      { level: 'error', message: 'Unhandled rejection: ECONNRESET from postgres' },
      { level: 'info', message: 'Deployment healthcheck passed' }
    ];
  }

  findService(serviceId: string): Service | undefined {
    for (const project of this.projects) {
      const svc = project.services?.find(s => s.id === serviceId);
      if (svc) return svc;
    }
    return undefined;
  }

  infrastructure(): InfrastructureOverview {
    const running = this.projects
      .flatMap(p => p.services ?? [])
      .filter(s => s.status === 'RUNNING').length;

    return {
      portainerStatus: 'connected',
      nginxProxyManagerStatus: 'connected',
      cloudflareTunnelStatus: 'active',
      activeContainers: running,
      hostCpuUsage: '31%',
      hostRamUsage: '6.8 GB / 16 GB'
    };
  }

  listAuditLogs(): AuditLogEntry[] {
    return [...this.auditLogs].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  private recordAudit(
    actor: UserAccount | undefined,
    action: AuditAction,
    target: string,
    details: string
  ) {
    this.auditLogs.unshift({
      id: 'aud-' + Math.random().toString(36).slice(2, 10),
      timestamp: new Date().toISOString(),
      actorName: actor?.name ?? 'System',
      actorEmail: actor?.email ?? 'system@cloudbase.dev',
      action,
      target,
      details
    });
  }

  setAccountStatus(userId: string, status: AccountStatus, actor?: UserAccount): UserAccount {
    const user = this.findUserById(userId);
    if (!user) throw new Error('User not found');
    const updated = this.updateUser({ ...user, accountStatus: status });
    this.recordAudit(
      actor,
      status === 'ACTIVE' ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_SUSPENDED',
      user.name,
      status === 'ACTIVE' ? 'Account activated' : 'Account suspended'
    );
    return updated;
  }

  setDeploymentAccess(userId: string, enabled: boolean, actor?: UserAccount): UserAccount {
    const user = this.findUserById(userId);
    if (!user) throw new Error('User not found');
    const updated = this.updateUser({ ...user, deploymentEnabled: enabled });
    this.recordAudit(
      actor,
      enabled ? 'DEPLOY_ACCESS_ENABLED' : 'DEPLOY_ACCESS_DISABLED',
      user.name,
      enabled ? 'Deployment access enabled' : 'Deployment access disabled'
    );
    return updated;
  }

  setRole(userId: string, role: UserRole, actor?: UserAccount): UserAccount {
    const user = this.findUserById(userId);
    if (!user) throw new Error('User not found');
    const updated = this.updateUser({ ...user, role });
    this.recordAudit(actor, 'ROLE_CHANGED', user.name, `Role changed to ${role}`);
    return updated;
  }

  sendPasswordReset(userId: string, actor?: UserAccount): void {
    const user = this.findUserById(userId);
    if (!user) throw new Error('User not found');
    this.recordAudit(
      actor,
      'PASSWORD_RESET_SENT',
      user.name,
      `Password reset link sent to ${user.email}`
    );
  }
}
