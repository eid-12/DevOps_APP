export type UserRole = 'ADMIN' | 'USER';
export type ProjectStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'DEPLOYING' | 'RUNNING' | 'STOPPED' | 'REJECTED';

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  deploymentEnabled: boolean;
}

export interface AuthResponse {
  token: string;
  user: UserAccount;
  message: string;
}

export interface ProjectRecord {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  repository: string;
  framework: string;
  branch: string;
  subdomain: string;
  status: ProjectStatus;
  quota: {
    memory: string;
    cpu: string;
  };
  cpuUsage: number;
  ramUsageMb: number;
}

export interface InfrastructureOverview {
  portainerStatus: string;
  nginxProxyManagerStatus: string;
  cloudflareTunnelStatus: string;
  activeContainers: number;
  hostCpuUsage: string;
  hostRamUsage: string;
}
