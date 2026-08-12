export type UserRole = 'ADMIN' | 'USER';
export type AccountStatus = 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED';
export type ProjectStatus = 'ACTIVE' | 'ARCHIVED';
export type ServiceRuntime = 'node' | 'java' | 'python' | 'go' | 'dotnet' | 'php' | 'rust' | 'other';
export type ProjectEnvironment = 'production' | 'staging' | 'development';
export type ServiceStatus = 'PENDING' | 'BUILDING' | 'DEPLOYING' | 'RUNNING' | 'STOPPED' | 'FAILED' | 'CRASHED';
export type ServiceSourceType = 'GITHUB' | 'DOCKER' | 'DATABASE';
export type DatabaseType = 'POSTGRESQL' | 'MYSQL' | 'REDIS' | 'MONGODB';
export type DeploymentStatus = 'QUEUED' | 'BUILDING' | 'DEPLOYING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  accountStatus: AccountStatus;
  deploymentEnabled: boolean;
  emailVerified?: boolean;
  github?: GitHubConnection | null;
  notifications?: NotificationPrefs;
  createdAt?: string;
  onboardingDismissed?: boolean;
  planId?: 'free';
}

export interface GitHubConnection {
  connected: boolean;
  /** GitHub login handle, e.g. octocat */
  username?: string;
  /** Profile display name from GitHub (name field) */
  displayName?: string;
  avatarUrl?: string;
  connectedAt?: string;
  scopes?: string[];
}

export interface GitHubRepo {
  fullName: string;
  name: string;
  htmlUrl: string;
  isPrivate: boolean;
  defaultBranch: string;
}

export interface NotificationPrefs {
  emailDeployments: boolean;
  emailFailures: boolean;
  emailWeeklyUsage: boolean;
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface ActivityEvent {
  id: string;
  userId: string;
  type: 'DEPLOY' | 'STOP' | 'CREATE_PROJECT' | 'CREATE_SERVICE' | 'DELETE' | 'GITHUB' | 'SETTINGS' | 'LOGIN';
  title: string;
  detail: string;
  timestamp: string;
  href?: string;
}

export interface UsageSummary {
  projects: number;
  services: number;
  runningServices: number;
  cpuMilliUsed: number;
  cpuMilliLimit: number;
  memoryMbUsed: number;
  memoryMbLimit: number;
  storageGbUsed: number;
  storageGbLimit: number;
  deploymentsThisMonth: number;
}

export interface AuthResponse {
  token: string;
  user: UserAccount;
  message: string;
  /** ISO-8601 absolute expiry when the server issued a token. */
  expiresAt?: string | null;
  /** Seconds until expiry at login time. */
  expiresInSeconds?: number;
}

/** A Project is a logical canvas that contains multiple Services */
export interface Project {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  description: string;
  status: ProjectStatus;
  environment: ProjectEnvironment;
  createdAt: string;
  services: Service[];
  sharedVariables?: SharedVariable[];
}

export interface SharedVariable {
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
  /** Service ids that inherit / reference this project variable */
  serviceIds: string[];
  updatedAt: string;
}

export interface InAppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  href?: string;
}

export interface PlanInfo {
  name: string;
  priceLabel: string;
  projectsLimit: number;
  servicesLimit: number;
  memoryMbLimit: number;
  storageGbLimit: number;
  deploymentsLimit: number;
  projectsUnlimited?: boolean;
  servicesUnlimited?: boolean;
  deploymentsUnlimited?: boolean;
  customDomains: boolean;
  prioritySupport: boolean;
}

export interface OnboardingState {
  dismissed: boolean;
  connectedGithub: boolean;
  createdProject: boolean;
  deployedService: boolean;
  addedDomain: boolean;
}

export interface GitHubSourceDetails {
  repositoryUrl: string;
  branch: string;
  autoDeploy: boolean;
  runtime?: ServiceRuntime;
  /** Process start command inside the container (e.g. java -jar /app/app.jar). */
  startCommand?: string;
  imageName?: string;
  imageTag?: string;
  containerPort?: number;
  ciBootstrapped?: boolean;
  ciMessage?: string;
  ciDockerfileCreated?: boolean;
  ciWorkflowCreated?: boolean;
  ciWebhookRegistered?: boolean;
}

export interface DockerSourceDetails {
  imageName: string;
  imageTag: string;
  registryUrl?: string;
  /** Container listen port (NPM / health). Defaults to 8080 on backend if omitted. */
  containerPort?: number;
  /** Optional override of image CMD/ENTRYPOINT. */
  startCommand?: string;
}

export interface DatabaseSourceDetails {
  dbType: DatabaseType;
  serviceName: string;
  containerPort?: number;
}

export type ServiceSourceDetails = GitHubSourceDetails | DockerSourceDetails | DatabaseSourceDetails;

export interface EnvironmentVariable {
  key: string;
  value: string;
  isSecret: boolean;
}

export interface VolumeMount {
  mountPath: string;
  sizeGb: number;
}

export interface ResourceQuota {
  memorymb: number;
  cpuMilli: number;
  storageGb: number;
}

/** A Service is one running entity inside a Project */
export interface Service {
  id: string;
  projectId: string;
  name: string;
  sourceType: ServiceSourceType;
  sourceDetails: ServiceSourceDetails;
  runtime: ServiceRuntime;
  status: ServiceStatus;
  /** Opaque platform host, e.g. cloudbase8472.cloudbase.website (not user-editable). */
  subdomain?: string;
  /** Optional bring-your-own hostname (e.g. app.example.com). */
  customDomain?: string;
  /** Port the container listens on (used by NPM / compose). */
  containerPort?: number;
  containerName?: string;
  envVars: EnvironmentVariable[];
  /** True after env save until a successful deploy applies them */
  envPendingDeploy?: boolean;
  volume?: VolumeMount;
  quota: ResourceQuota;
  cpuUsage: number;
  ramUsageMb: number;
  latestDeploymentId?: string;
  createdAt: string;
}

export interface Deployment {
  id: string;
  serviceId: string;
  projectId: string;
  status: DeploymentStatus;
  triggeredBy: string;
  commitSha?: string;
  imageTag?: string;
  startedAt: string;
  finishedAt?: string;
  logs?: string;
  /** When set, this deploy was created by rolling back to another deployment */
  rollbackOf?: string;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface ServiceLogLine {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
}

export interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'system' | 'error';
  text: string;
}

/** DTO for creating a new project */
export interface CreateProjectRequest {
  name: string;
  description: string;
  environment?: ProjectEnvironment;
}

/** DTO for updating a project */
export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  environment?: ProjectEnvironment;
}

/** DTO for adding a service to a project */
export interface CreateServiceRequest {
  projectId: string;
  name: string;
  sourceType: ServiceSourceType;
  sourceDetails: ServiceSourceDetails;
  runtime?: ServiceRuntime;
  envVars?: EnvironmentVariable[];
  volume?: VolumeMount;
  quota?: Partial<ResourceQuota>;
}

/** DTO for updating an existing service */
export interface UpdateServiceRequest {
  name?: string;
  sourceDetails?: ServiceSourceDetails;
  runtime?: ServiceRuntime;
  quota?: Partial<ResourceQuota>;
  volume?: VolumeMount | null;
  removeVolume?: boolean;
}

export interface InfrastructureOverview {
  portainerStatus: string;
  nginxProxyManagerStatus: string;
  cloudflareTunnelStatus: string;
  activeContainers: number;
  hostCpuUsage: string;
  hostRamUsage: string;
}

export type AuditAction =
  | 'PROJECT_CREATED'
  | 'SERVICE_CREATED'
  | 'SERVICE_DEPLOYED'
  | 'SERVICE_STOPPED'
  | 'SERVICE_DELETED'
  | 'DEPLOY_ACCESS_ENABLED'
  | 'DEPLOY_ACCESS_DISABLED'
  | 'ACCOUNT_ACTIVATED'
  | 'ACCOUNT_SUSPENDED'
  | 'PASSWORD_RESET_SENT'
  | 'ROLE_CHANGED'
  | 'HOSTING_SETTINGS_UPDATED';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorName: string;
  actorEmail: string;
  action: AuditAction;
  target: string;
  details: string;
}

/** Admin hosting/integration settings (secrets masked on read). */
export interface HostingSettings {
  portainerUrl: string;
  portainerApiKeyConfigured: boolean;
  portainerApiKeyHint: string;
  portainerEndpointId: string;
  npmEnabled: boolean;
  npmUrl: string;
  npmEmail: string;
  npmPasswordConfigured: boolean;
  npmPasswordHint: string;
  npmCertificateId: string;
  npmSslForced: boolean;
  githubClientId: string;
  githubClientSecretConfigured: boolean;
  githubClientSecretHint: string;
  githubRedirectUri: string;
  githubScopes: string;
  githubWebhookSecretConfigured: boolean;
  githubWebhookSecretHint: string;
  dockerHubUsername: string;
  dockerHubTokenConfigured: boolean;
  dockerHubTokenHint: string;
  dockerHubNamespace: string;
  baseDomain: string;
  publicApiUrl: string;
  dockerNetwork: string;
  volumeRoot: string;
}

export type HostingSettingsUpdate = Partial<{
  portainerUrl: string;
  portainerApiKey: string;
  portainerEndpointId: string;
  npmEnabled: boolean;
  npmUrl: string;
  npmEmail: string;
  npmPassword: string;
  npmCertificateId: string;
  npmSslForced: boolean;
  githubClientId: string;
  githubClientSecret: string;
  githubRedirectUri: string;
  githubScopes: string;
  githubWebhookSecret: string;
  dockerHubUsername: string;
  dockerHubToken: string;
  dockerHubNamespace: string;
  baseDomain: string;
  publicApiUrl: string;
  dockerNetwork: string;
  volumeRoot: string;
}>;
