import { Component, HostListener, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { ProjectService } from '../core/project.service';
import {
  Project, Service, ServiceRuntime, ServiceSourceType, DatabaseType,
  CreateServiceRequest, EnvironmentVariable, ServiceSourceDetails, SharedVariable, GitHubRepo
} from '../core/models';
import { CreatePickerComponent, CreatePickerOptionId } from '../shared/create-picker.component';
import {
  DB_PRESETS,
  DOCKER_IMAGE_PRESETS,
  guessContainerPort,
  parseDockerImageRef,
  slugifyServiceName
} from '../shared/service-source.util';
import { publicHost } from '../shared/public-host.util';

type AddServiceMode = 'github' | 'docker' | 'database' | null;

const SOON_OPTIONS = new Set<CreatePickerOptionId>(['template', 'function', 'bucket']);
const SOON_LABELS: Record<string, string> = {
  template: 'Templates are coming soon.',
  function: 'Functions are coming soon.',
  bucket: 'Buckets are coming soon.'
};

@Component({
  selector: 'app-project-detail-page',
  standalone: true,
  imports: [CommonModule, FormsModule, CreatePickerComponent],
  template: `
<div class="page railway-page">
  <div class="container">
    <header class="railway-topbar">
      <div class="railway-topbar-left">
        <button type="button" class="btn btn-ghost btn-sm back-btn" (click)="router.navigate(['/dashboard'])">
          ← Projects
        </button>
        <div>
          <h1 class="railway-page-title">{{ project()?.name ?? '…' }}</h1>
          @if (project()?.description) {
            <p class="railway-page-sub">{{ project()?.description }}</p>
          } @else {
            <p class="railway-page-sub">{{ project()?.environment || 'production' }}</p>
          }
        </div>
      </div>

      <div class="railway-topbar-actions">
        <button
          type="button"
          class="btn btn-ghost"
          (click)="openSettings()"
          [disabled]="!project()"
        >Settings</button>
        <button
          type="button"
          class="btn btn-primary railway-new-btn"
          (click)="openPicker()"
          [disabled]="adding() || !canManage() || project()?.status === 'ARCHIVED'"
        >+ Add Service</button>
      </div>
    </header>

    @if (error()) {
      <div class="pill pill-red railway-alert">{{ error() }}</div>
    }

    @if (flash()) {
      <div class="pill pill-green railway-alert">{{ flash() }}</div>
    }

    @if (project()?.status === 'ARCHIVED') {
      <div class="pill pill-amber railway-alert">
        This project is archived. Restore it from Settings to manage services again.
      </div>
    }

    @if (!canManage() && !loading()) {
      <div class="pill pill-amber railway-alert">
        You cannot add or manage services while deployment access is disabled or your account is suspended.
      </div>
    }

    <nav class="svc-tabs project-tabs" role="tablist">
      <button type="button" class="svc-tab" [class.active]="projectTab() === 'services'" (click)="projectTab.set('services')">Services</button>
      <button type="button" class="svc-tab" [class.active]="projectTab() === 'variables'" (click)="openVariablesTab()">Project Variables</button>
    </nav>

    @if (projectTab() === 'variables') {
      <section class="panel svc-panel shared-vars-panel">
        <div class="svc-panel-head">
          <div>
            <h3>Shared variables</h3>
            <p class="muted" style="margin:4px 0 0;font-size:13px">
              Project-scoped keys inherited by selected services (Railway-style shared config).
            </p>
          </div>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            (click)="startNewSharedVar()"
            [disabled]="!canManage() || project()?.status === 'ARCHIVED' || editingShared()"
          >+ Add Variable</button>
        </div>

        @if (sharedError()) {
          <div class="pill pill-red railway-alert">{{ sharedError() }}</div>
        }

        @if (editingShared()) {
          <div class="shared-var-editor panel">
            <div class="shared-var-grid">
              <div class="field">
                <label>Key</label>
                <input [(ngModel)]="sharedDraft.key" placeholder="DATABASE_URL" class="mono" [disabled]="!!sharedDraft.id" />
              </div>
              <div class="field">
                <label>Value</label>
                <div class="shared-value-row">
                  <input
                    [(ngModel)]="sharedDraft.value"
                    [type]="sharedDraft.isSecret && !sharedShowValue ? 'password' : 'text'"
                    placeholder="value"
                    class="mono"
                  />
                  @if (sharedDraft.isSecret) {
                    <button type="button" class="btn btn-ghost btn-sm" (click)="sharedShowValue = !sharedShowValue">
                      {{ sharedShowValue ? 'Hide' : 'Show' }}
                    </button>
                  }
                </div>
              </div>
            </div>
            <label class="toggle-field" style="margin-top:10px">
              <input type="checkbox" [(ngModel)]="sharedDraft.isSecret" />
              <span>Secret (mask value)</span>
            </label>

            <div class="shared-services-block">
              <div class="shared-services-head">
                <span>Reference in services</span>
                <button type="button" class="btn btn-ghost btn-sm" (click)="toggleAllSharedServices()">
                  {{ allServicesSelected() ? 'Clear all' : 'Select all' }}
                </button>
              </div>
              @if (!project()?.services?.length) {
                <p class="muted" style="margin:0;font-size:13px">No services in this project yet.</p>
              } @else {
                <div class="shared-service-chips">
                  @for (svc of project()!.services; track svc.id) {
                    <label class="shared-service-chip" [class.selected]="isSharedServiceSelected(svc.id)">
                      <input type="checkbox" [checked]="isSharedServiceSelected(svc.id)" (change)="toggleSharedService(svc.id)" />
                      <span>{{ svc.name }}</span>
                      <small>{{ svc.sourceType }}</small>
                    </label>
                  }
                </div>
              }
            </div>

            <div class="modal-actions" style="margin-top:16px">
              <button type="button" class="btn btn-ghost" (click)="cancelSharedEdit()" [disabled]="sharedSaving()">Cancel</button>
              <button type="button" class="btn btn-primary" (click)="saveSharedVar()" [disabled]="sharedSaving() || !sharedDraft.key.trim()">
                {{ sharedSaving() ? 'Saving…' : (sharedDraft.id ? 'Save Variable' : 'Create Variable') }}
              </button>
            </div>
          </div>
        }

        @if (sharedLoading()) {
          <p class="muted">Loading variables…</p>
        } @else if (!sharedVars().length && !editingShared()) {
          <div class="railway-empty" style="padding:28px 16px">
            <p>No shared variables yet</p>
            <p class="empty-sub">Add keys once, then attach them to any service in this project.</p>
          </div>
        } @else {
          <div class="shared-var-list">
            @for (v of sharedVars(); track v.id) {
              <article class="shared-var-row">
                <div class="shared-var-main">
                  <div class="shared-var-key-row">
                    <code class="mono">{{ v.key }}</code>
                    @if (v.isSecret) { <span class="pill pill-amber">Secret</span> }
                  </div>
                  <div class="shared-var-value mono">
                    {{ v.isSecret && !revealedShared[v.id] ? '••••••••••••' : v.value }}
                    @if (v.isSecret) {
                      <button type="button" class="btn btn-ghost btn-sm" (click)="revealedShared[v.id] = !revealedShared[v.id]">
                        {{ revealedShared[v.id] ? 'Hide' : 'Reveal' }}
                      </button>
                    }
                  </div>
                  <div class="shared-var-refs">
                    <span class="muted">Used by</span>
                    @if (!v.serviceIds.length) {
                      <span class="pill">No services</span>
                    } @else {
                      @for (sid of v.serviceIds; track sid) {
                        <span class="pill pill-indigo">{{ serviceName(sid) }}</span>
                      }
                    }
                  </div>
                </div>
                <div class="shared-var-actions">
                  <button type="button" class="btn btn-ghost btn-sm" (click)="editSharedVar(v)" [disabled]="!canManage() || editingShared()">Edit</button>
                  <button type="button" class="btn btn-danger-soft btn-sm" (click)="deleteSharedVar(v)" [disabled]="!canManage() || sharedSaving()">Delete</button>
                </div>
              </article>
            }
          </div>
        }
      </section>
    }

    @if (projectTab() === 'services') {
    <div class="services-canvas">
      @if (loading()) {
        <div class="services-grid">
          @for (i of skeletonSlots; track i) {
            <div class="service-card skeleton-card" aria-hidden="true">
              <div class="skeleton skeleton-title"></div>
              <div class="skeleton skeleton-line w-55"></div>
              <div class="skeleton skeleton-line w-40"></div>
              <div class="skeleton skeleton-meter"></div>
              <div class="skeleton skeleton-footer"></div>
            </div>
          }
        </div>
      } @else if (!project()?.services?.length) {
        <div class="railway-empty panel">
          <div class="empty-icon">⬡</div>
          <p>No services yet</p>
          <p class="empty-sub">Add a GitHub repo, Docker image, or database to get started.</p>
          @if (canManage()) {
            <button type="button" class="btn btn-primary" style="margin-top:16px" (click)="openPicker()">
              + Add Service
            </button>
          }
        </div>
      } @else {
        <div class="services-grid">
          @for (svc of project()!.services; track svc.id) {
            <div
              class="service-card service-card-clickable"
              [ngClass]="'status-' + svc.status.toLowerCase()"
              [class.is-deploying]="isServiceDeploying(svc)"
              (click)="openService(svc)"
            >
              <div class="service-card-header">
                <span class="service-icon">{{ sourceIcon(svc.sourceType) }}</span>
                <span class="service-name">{{ svc.name }}</span>
                <span class="service-status-badge" [class]="'badge-' + svc.status.toLowerCase()">{{ svc.status }}</span>
              </div>

              <div class="service-card-meta">
                <span class="service-type">{{ runtimeLabel(svc.runtime) }}</span>
                <span class="service-type">{{ svc.sourceType }}</span>
                @if (servicePublicHost(svc); as host) {
                  <a
                    class="service-url"
                    [href]="'https://' + host"
                    target="_blank"
                    rel="noopener"
                    (click)="$event.stopPropagation()"
                  >
                    {{ host }}
                  </a>
                }
              </div>

              <div class="service-source-line">{{ sourceSummary(svc) }}</div>

              <div class="service-metrics-mini">
                <span>CPU {{ svc.cpuUsage | number:'1.0-0' }}%</span>
                <span>RAM {{ svc.ramUsageMb }}MB</span>
              </div>

              @if (isServiceDeploying(svc)) {
                <div class="service-deploy-chrome deploy-chrome" (click)="$event.stopPropagation()">
                  <div class="deploy-timeline" aria-label="Deployment progress">
                    @for (step of deployTimelineSteps; track step; let i = $index) {
                      <span
                        class="deploy-step"
                        [class.done]="i < serviceDeployStep(svc)"
                        [class.active]="i === serviceDeployStep(svc)"
                      >{{ step }}</span>
                      @if (i < deployTimelineSteps.length - 1) {
                        <span class="deploy-step-sep">→</span>
                      }
                    }
                  </div>
                  <div class="deploy-progress" aria-hidden="true">
                    <span [style.width.%]="serviceDeployProgress(svc)"></span>
                  </div>
                </div>
              }

              <div class="service-card-footer" (click)="$event.stopPropagation()">
                <button type="button" class="btn btn-sm btn-ghost" (click)="openService(svc, 'logs')">Logs</button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  (click)="openService(svc, 'terminal')"
                  [disabled]="svc.status !== 'RUNNING'"
                >Terminal</button>
                @if (svc.status === 'PENDING' || svc.status === 'STOPPED' || svc.status === 'FAILED') {
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    (click)="deployService(svc)"
                    [disabled]="isServiceDeploying(svc) || !canManage()"
                  >
                    {{ isServiceDeploying(svc) ? 'Deploying…' : 'Deploy' }}
                  </button>
                }
                @if (svc.status === 'RUNNING') {
                  <button
                    type="button"
                    class="btn btn-sm btn-danger-soft"
                    (click)="stopService(svc)"
                    [disabled]="!canManage()"
                  >Stop</button>
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost"
                    (click)="deployService(svc)"
                    [disabled]="isServiceDeploying(svc) || !canManage()"
                  >
                    {{ isServiceDeploying(svc) ? '…' : 'Redeploy' }}
                  </button>
                }
                <button
                  type="button"
                  class="btn btn-sm btn-ghost danger"
                  (click)="confirmDeleteService(svc)"
                  [disabled]="!canManage()"
                >Delete</button>
              </div>
            </div>
          }
        </div>
      }
    </div>
    }
  </div>
</div>

@if (pickerOpen() || addMode()) {
  <div class="modal-backdrop modal-backdrop-dots" (click)="onBackdropClick($event)">
    @if (pickerOpen() && !addMode()) {
      <app-create-picker
        [(prompt)]="prompt"
        placeholder="Describe a service or paste a repo link"
        [showEmpty]="false"
        [error]="pickerError()"
        (select)="onPickerSelect($event)"
        (enter)="onPromptEnter()"
      />
    }

    @if (addMode()) {
      <div class="modal-panel panel create-form-panel" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h2>{{ addModeLabel() }}</h2>
          <button type="button" class="btn btn-ghost btn-sm" (click)="closeForm()" [disabled]="adding()">✕</button>
        </div>

        <div class="add-service-form">
          <div class="field">
            <label>Service Name</label>
            <input [(ngModel)]="draft.name" placeholder="my-service" autocomplete="off" />
          </div>

          @if (addMode() === 'github') {
            <div class="field">
              <label>Runtime / Language</label>
              <select [(ngModel)]="draft.runtime">
                <option value="node">Node.js</option>
                <option value="java">Java</option>
                <option value="python">Python</option>
                <option value="go">Go</option>
                <option value="dotnet">.NET</option>
                <option value="php">PHP</option>
                <option value="rust">Rust</option>
                <option value="other">Other</option>
              </select>
            </div>
          }

          @if (addMode() === 'github') {
            @if (auth.isGitHubConnected()) {
              <p class="muted" style="font-size:12px;margin:0 0 10px">
                Connected as &#64;{{ auth.githubUsername() }} — pick a repo or paste a URL.
              </p>
              <div class="field">
                <label>Your repositories</label>
                <select
                  [ngModel]="selectedRepoFullName"
                  (ngModelChange)="onGitHubRepoPicked($event)"
                  [disabled]="reposLoading()"
                >
                  <option value="">
                    {{ reposLoading() ? 'Loading repositories…' : (githubRepos().length ? 'Select a repository…' : 'No repos found — paste URL below') }}
                  </option>
                  @for (r of githubRepos(); track r.fullName) {
                    <option [value]="r.fullName">
                      {{ r.fullName }}{{ r.isPrivate ? ' (private)' : '' }}
                    </option>
                  }
                </select>
                @if (reposError()) {
                  <p class="muted" style="color:#f87171;font-size:12px;margin:6px 0 0">{{ reposError() }}</p>
                }
              </div>
            } @else {
              <div class="pill pill-amber railway-alert" style="margin-bottom:12px">
                Connect GitHub on Account to list your repositories.
              </div>
            }
            <div class="field">
              <label>Repository URL</label>
              <input [(ngModel)]="draft.repoUrl" [placeholder]="repoUrlPlaceholder()" />
            </div>
            <div class="field">
              <label>Branch</label>
              <input [(ngModel)]="draft.branch" placeholder="main" />
            </div>
            <label class="toggle-field">
              <input type="checkbox" [(ngModel)]="draft.autoDeploy" />
              <span>Auto deploy on push</span>
            </label>
          }

          @if (addMode() === 'docker') {
            <p class="muted" style="font-size:12px;margin:0 0 10px">
              Pull any public image from Docker Hub (or your namespace).
            </p>
            <div class="field">
              <label>Quick presets</label>
              <select (ngModelChange)="applyDockerPreset($event)" [ngModel]="dockerPresetKey">
                <option value="">Custom image…</option>
                @for (p of dockerPresets; track p.image) {
                  <option [value]="p.image + ':' + p.tag">{{ p.label }} — {{ p.image }}:{{ p.tag }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label>Image</label>
              <input
                [(ngModel)]="draft.imageName"
                (ngModelChange)="onDockerImageChange($event)"
                placeholder="nginxdemos/hello or nginx"
                autocomplete="off"
              />
            </div>
            <div class="field">
              <label>Tag</label>
              <input [(ngModel)]="draft.imageTag" placeholder="latest" />
            </div>
            <div class="field">
              <label>Container port</label>
              <input type="number" [(ngModel)]="draft.containerPort" min="1" max="65535" />
              <p class="empty-sub" style="margin:6px 0 0">Port inside the container. A random public URL is assigned automatically.</p>
            </div>
          }

          @if (addMode() === 'database') {
            <div class="field">
              <label>Database Type</label>
              <select [(ngModel)]="draft.dbType" (ngModelChange)="onDbTypeChange($event)">
                @for (t of dbTypes; track t) {
                  <option [value]="t">{{ dbPreset(t).label }}</option>
                }
              </select>
              <p class="empty-sub" style="margin:6px 0 0">{{ dbPreset(draft.dbType).hint }}</p>
            </div>
            <div class="field">
              <label>Internal port</label>
              <input type="number" [ngModel]="dbPreset(draft.dbType).port" disabled />
            </div>
          }

          @if (addMode() === 'github' || addMode() === 'docker') {
            <div class="env-section">
              <div class="env-header">
                <span>Environment Variables</span>
                <button type="button" class="btn btn-ghost btn-sm" (click)="addEnvVar()">+ Add</button>
              </div>
              @for (env of draft.envVars; track $index) {
                <div class="env-row">
                  <input [(ngModel)]="env.key" placeholder="KEY" />
                  <input [(ngModel)]="env.value" placeholder="value" />
                  <button type="button" class="btn btn-ghost btn-sm danger" (click)="removeEnvVar($index)">✕</button>
                </div>
              }
              @if (!draft.envVars.length) {
                <p class="empty-sub" style="margin:0">Optional — add keys your app needs at runtime.</p>
              }
            </div>
          }

          @if (addMode() === 'database') {
            <p class="muted" style="font-size:12px;margin:0 0 10px">
              Persistent volume is required for databases so data survives restarts.
            </p>
          } @else {
            <label class="toggle-field">
              <input type="checkbox" [(ngModel)]="draft.useVolume" />
              <span>Persistent Volume</span>
            </label>
          }
          @if (draft.useVolume || addMode() === 'database') {
            <div class="field">
              <label>Mount Path</label>
              <input [(ngModel)]="draft.mountPath" [placeholder]="addMode() === 'database' ? dbPreset(draft.dbType).mountPath : '/data'" />
            </div>
            <div class="field">
              <label>Storage (GB)</label>
              <input type="number" [(ngModel)]="draft.storageGb" min="1" max="50" />
            </div>
          }

          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" (click)="closeForm()" [disabled]="adding()">Cancel</button>
            <button
              type="button"
              class="btn btn-primary"
              (click)="submitService()"
              [disabled]="adding() || !canSubmitService()"
            >
              {{ adding() ? 'Creating…' : 'Add Service' }}
            </button>
          </div>
        </div>
      </div>
    }
  </div>
}

@if (settingsOpen()) {
  <div class="modal-backdrop" (click)="onSettingsBackdrop($event)">
    <div class="modal-panel panel create-form-panel" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2>Project Settings</h2>
        <button type="button" class="btn btn-ghost btn-sm" (click)="closeSettings()" [disabled]="savingSettings()">✕</button>
      </div>
      @if (settingsError()) {
        <div class="pill pill-red railway-alert">{{ settingsError() }}</div>
      }
      <div class="field" style="margin-bottom:14px">
        <label>Project Name</label>
        <input [(ngModel)]="settingsName" />
      </div>
      <div class="field" style="margin-bottom:14px">
        <label>Description</label>
        <input [(ngModel)]="settingsDescription" placeholder="Optional description" />
      </div>
      <div class="field" style="margin-bottom:18px">
        <label>Environment</label>
        <select [(ngModel)]="settingsEnvironment">
          <option value="production">production</option>
          <option value="staging">staging</option>
          <option value="development">development</option>
        </select>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" (click)="closeSettings()" [disabled]="savingSettings()">Cancel</button>
        <button type="button" class="btn btn-primary" (click)="saveSettings()" [disabled]="savingSettings() || !settingsName.trim()">
          {{ savingSettings() ? 'Saving…' : 'Save' }}
        </button>
      </div>
      <div class="danger-zone">
        <h4>Project lifecycle</h4>
        @if (project()?.status === 'ACTIVE') {
          <button type="button" class="btn btn-ghost btn-sm" (click)="archiveProject()" [disabled]="savingSettings()">Archive Project</button>
        } @else {
          <button type="button" class="btn btn-ghost btn-sm" (click)="restoreProject()" [disabled]="savingSettings()">Restore Project</button>
        }
        <button type="button" class="btn btn-danger-soft btn-sm" style="margin-left:8px" (click)="deleteProject()" [disabled]="savingSettings()">Delete Project</button>
      </div>
    </div>
  </div>
}
  `,
})
export class ProjectDetailPageComponent implements OnInit {
  readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly projectService = inject(ProjectService);
  readonly auth = inject(AuthService);

  project = signal<Project | null>(null);
  loading = signal(true);
  skeletonSlots = [1, 2, 3];
  error = signal<string | null>(null);
  flash = signal('');
  adding = signal(false);
  addMode = signal<AddServiceMode>(null);
  pickerOpen = signal(false);
  pickerError = signal('');
  settingsOpen = signal(false);
  savingSettings = signal(false);
  settingsError = signal('');
  projectTab = signal<'services' | 'variables'>('services');
  sharedVars = signal<SharedVariable[]>([]);
  sharedLoading = signal(false);
  sharedSaving = signal(false);
  sharedError = signal('');
  editingShared = signal(false);
  settingsName = '';
  settingsDescription = '';
  settingsEnvironment: 'production' | 'staging' | 'development' = 'production';
  prompt = '';
  sharedShowValue = false;
  revealedShared: Record<string, boolean> = {};
  sharedDraft = this.freshSharedDraft();

  deploying: Record<string, boolean> = {};
  deployStage: Record<string, string> = {};
  readonly deployTimelineSteps = ['Queued', 'Building', 'Deploying', 'Success'] as const;
  private deployPollTimers: Array<ReturnType<typeof setTimeout>> = [];
  draft = this.freshDraft();
  readonly dbTypes: DatabaseType[] = ['POSTGRESQL', 'MYSQL', 'REDIS', 'MONGODB'];
  readonly dockerPresets = DOCKER_IMAGE_PRESETS;
  dockerPresetKey = '';
  readonly githubRepos = signal<GitHubRepo[]>([]);
  readonly reposLoading = signal(false);
  readonly reposError = signal('');
  selectedRepoFullName = '';

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('projectId')!;
    const tab = this.route.snapshot.queryParamMap.get('tab');
    this.projectService.get(id).subscribe({
      next: p => {
        this.project.set(p);
        this.loading.set(false);
        if (tab === 'variables') this.openVariablesTab();
      },
      error: e => { this.error.set(e?.error?.message ?? 'Failed to load project'); this.loading.set(false); }
    });
  }

  openVariablesTab() {
    this.projectTab.set('variables');
    this.loadSharedVars();
  }

  loadSharedVars() {
    const p = this.project();
    if (!p) return;
    this.sharedLoading.set(true);
    this.sharedError.set('');
    this.projectService.listSharedVariables(p.id).subscribe({
      next: vars => {
        this.sharedVars.set(vars);
        this.sharedLoading.set(false);
      },
      error: e => {
        this.sharedError.set(e?.error?.message ?? 'Failed to load variables');
        this.sharedLoading.set(false);
      }
    });
  }

  startNewSharedVar() {
    this.sharedDraft = this.freshSharedDraft();
    this.sharedShowValue = false;
    this.sharedError.set('');
    this.editingShared.set(true);
  }

  editSharedVar(v: SharedVariable) {
    this.sharedDraft = {
      id: v.id,
      key: v.key,
      value: v.value,
      isSecret: v.isSecret,
      serviceIds: [...v.serviceIds]
    };
    this.sharedShowValue = false;
    this.sharedError.set('');
    this.editingShared.set(true);
  }

  cancelSharedEdit() {
    if (this.sharedSaving()) return;
    this.editingShared.set(false);
    this.sharedDraft = this.freshSharedDraft();
  }

  isSharedServiceSelected(serviceId: string): boolean {
    return this.sharedDraft.serviceIds.includes(serviceId);
  }

  toggleSharedService(serviceId: string) {
    const set = new Set(this.sharedDraft.serviceIds);
    if (set.has(serviceId)) set.delete(serviceId);
    else set.add(serviceId);
    this.sharedDraft.serviceIds = [...set];
  }

  allServicesSelected(): boolean {
    const services = this.project()?.services ?? [];
    return !!services.length && services.every(s => this.sharedDraft.serviceIds.includes(s.id));
  }

  toggleAllSharedServices() {
    const services = this.project()?.services ?? [];
    this.sharedDraft.serviceIds = this.allServicesSelected() ? [] : services.map(s => s.id);
  }

  serviceName(serviceId: string): string {
    return this.project()?.services?.find(s => s.id === serviceId)?.name ?? serviceId;
  }

  saveSharedVar() {
    const p = this.project();
    if (!p || !this.canManage()) return;
    this.sharedSaving.set(true);
    this.sharedError.set('');
    this.projectService.upsertSharedVariable(p.id, {
      id: this.sharedDraft.id,
      key: this.sharedDraft.key,
      value: this.sharedDraft.value,
      isSecret: this.sharedDraft.isSecret,
      serviceIds: this.sharedDraft.serviceIds
    }).subscribe({
      next: () => {
        this.sharedSaving.set(false);
        this.editingShared.set(false);
        this.sharedDraft = this.freshSharedDraft();
        this.loadSharedVars();
        this.flash.set('Shared variable saved');
      },
      error: e => {
        this.sharedSaving.set(false);
        this.sharedError.set(e?.error?.message ?? 'Failed to save');
      }
    });
  }

  deleteSharedVar(v: SharedVariable) {
    const p = this.project();
    if (!p || !this.canManage()) return;
    if (!confirm(`Delete shared variable ${v.key}?`)) return;
    this.sharedSaving.set(true);
    this.projectService.deleteSharedVariable(p.id, v.id).subscribe({
      next: () => {
        this.sharedSaving.set(false);
        this.loadSharedVars();
        this.flash.set(`${v.key} deleted`);
      },
      error: e => {
        this.sharedSaving.set(false);
        this.sharedError.set(e?.error?.message ?? 'Delete failed');
      }
    });
  }

  private freshSharedDraft() {
    return {
      id: undefined as string | undefined,
      key: '',
      value: '',
      isSecret: false,
      serviceIds: [] as string[]
    };
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.closeOverlays();
    this.closeSettings();
  }

  openSettings() {
    const p = this.project();
    if (!p) return;
    this.settingsName = p.name;
    this.settingsDescription = p.description ?? '';
    this.settingsEnvironment = p.environment || 'production';
    this.settingsError.set('');
    this.settingsOpen.set(true);
  }

  closeSettings() {
    if (this.savingSettings()) return;
    this.settingsOpen.set(false);
  }

  onSettingsBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) this.closeSettings();
  }

  saveSettings() {
    const p = this.project();
    if (!p || !this.settingsName.trim()) return;
    this.savingSettings.set(true);
    this.settingsError.set('');
    this.projectService.update(p.id, {
      name: this.settingsName.trim(),
      description: this.settingsDescription.trim(),
      environment: this.settingsEnvironment
    }).subscribe({
      next: updated => {
        this.project.set(updated);
        this.savingSettings.set(false);
        this.settingsOpen.set(false);
        this.flash.set('Project updated');
      },
      error: e => {
        this.savingSettings.set(false);
        this.settingsError.set(e?.error?.message ?? 'Failed to save');
      }
    });
  }

  archiveProject() {
    const p = this.project();
    if (!p) return;
    this.savingSettings.set(true);
    this.projectService.archive(p.id).subscribe({
      next: updated => {
        this.project.set(updated);
        this.savingSettings.set(false);
        this.settingsOpen.set(false);
        this.flash.set('Project archived');
      },
      error: e => {
        this.savingSettings.set(false);
        this.settingsError.set(e?.error?.message ?? 'Archive failed');
      }
    });
  }

  restoreProject() {
    const p = this.project();
    if (!p) return;
    this.savingSettings.set(true);
    this.projectService.restore(p.id).subscribe({
      next: updated => {
        this.project.set(updated);
        this.savingSettings.set(false);
        this.settingsOpen.set(false);
        this.flash.set('Project restored');
      },
      error: e => {
        this.savingSettings.set(false);
        this.settingsError.set(e?.error?.message ?? 'Restore failed');
      }
    });
  }

  deleteProject() {
    const p = this.project();
    if (!p) return;
    if (!confirm(`Delete project "${p.name}" and all its services? This cannot be undone.`)) return;
    this.savingSettings.set(true);
    this.projectService.delete(p.id).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: e => {
        this.savingSettings.set(false);
        this.settingsError.set(e?.error?.message ?? 'Delete failed');
      }
    });
  }

  canManage(): boolean {
    const user = this.auth.user();
    return !!user && user.accountStatus === 'ACTIVE' && user.deploymentEnabled;
  }

  openPicker() {
    if (!this.canManage() || this.project()?.status === 'ARCHIVED') return;
    this.prompt = '';
    this.pickerError.set('');
    this.addMode.set(null);
    this.pickerOpen.set(true);
  }

  closeOverlays() {
    if (this.adding()) return;
    this.pickerOpen.set(false);
    this.addMode.set(null);
    this.pickerError.set('');
  }

  onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) this.closeOverlays();
  }

  closeForm() {
    if (this.adding()) return;
    this.addMode.set(null);
    this.pickerError.set('');
    this.pickerOpen.set(true);
  }

  onPickerSelect(id: CreatePickerOptionId) {
    if (SOON_OPTIONS.has(id)) {
      this.pickerError.set(SOON_LABELS[id] ?? 'Coming soon.');
      return;
    }
    if (id === 'github' || id === 'docker' || id === 'database') {
      this.pickerError.set('');
      this.openAdd(id);
    }
  }

  openAdd(mode: AddServiceMode) {
    this.addMode.set(mode);
    this.draft = this.freshDraft();
    this.selectedRepoFullName = '';
    this.githubRepos.set([]);
    this.reposError.set('');
    this.dockerPresetKey = '';
    const prompt = this.prompt.trim();

    if (mode === 'github' && (prompt.startsWith('http') || prompt.includes('github.com'))) {
      this.draft.repoUrl = prompt;
      const parts = prompt.replace(/\.git$/, '').split('/').filter(Boolean);
      this.draft.name = slugifyServiceName(parts[parts.length - 1] || 'service');
    } else if (mode === 'docker' && prompt && !prompt.includes(' ')) {
      const parsed = parseDockerImageRef(prompt);
      this.draft.imageName = parsed.imageName;
      this.draft.imageTag = parsed.imageTag;
      this.draft.containerPort = guessContainerPort(parsed.imageName);
      this.draft.name = slugifyServiceName(parsed.imageName.split('/').pop() || parsed.imageName);
    } else if (prompt) {
      this.draft.name = slugifyServiceName(prompt);
    }

    if (mode === 'github') {
      const user = this.auth.githubUsername();
      if (!this.draft.repoUrl && user) {
        this.draft.repoUrl = `https://github.com/${user}/`;
      }
      this.loadGitHubRepos();
    }

    if (mode === 'docker' && !this.draft.imageName) {
      this.draft.containerPort = 80;
    }

    if (mode === 'database') {
      this.draft.useVolume = true;
      this.draft.storageGb = 1;
      this.draft.runtime = 'other';
      this.onDbTypeChange(this.draft.dbType);
    }
    this.pickerOpen.set(false);
  }

  dbPreset(dbType: DatabaseType) {
    return DB_PRESETS[dbType];
  }

  applyDockerPreset(key: string) {
    this.dockerPresetKey = key;
    if (!key) return;
    const preset = this.dockerPresets.find(p => `${p.image}:${p.tag}` === key);
    if (!preset) return;
    this.draft.imageName = preset.image;
    this.draft.imageTag = preset.tag;
    this.draft.containerPort = preset.port;
    if (!this.draft.name.trim()) {
      this.draft.name = slugifyServiceName(preset.image.split('/').pop() || preset.label);
    }
  }

  onDockerImageChange(value: string) {
    const parsed = parseDockerImageRef(value);
    if (value.includes(':') && parsed.imageName && parsed.imageName !== value.trim()) {
      this.draft.imageName = parsed.imageName;
      this.draft.imageTag = parsed.imageTag;
    }
    this.draft.containerPort = guessContainerPort(this.draft.imageName || parsed.imageName);
    this.dockerPresetKey = '';
  }

  onDbTypeChange(dbType: DatabaseType) {
    this.draft.dbType = dbType;
    this.draft.useVolume = true;
    const preset = DB_PRESETS[dbType];
    this.draft.mountPath = preset.mountPath;
    if (!this.draft.name.trim() || ['postgres', 'mysql', 'redis', 'mongodb'].includes(this.draft.name)) {
      this.draft.name = preset.name;
    }
  }

  repoUrlPlaceholder(): string {
    const u = this.auth.githubUsername();
    return u ? `https://github.com/${u}/my-repo` : 'https://github.com/user/repo';
  }

  onGitHubRepoPicked(fullName: string) {
    this.selectedRepoFullName = fullName;
    const repo = this.githubRepos().find(r => r.fullName === fullName);
    if (!repo) return;
    this.draft.repoUrl = repo.htmlUrl;
    this.draft.branch = repo.defaultBranch || 'main';
    if (!this.draft.name.trim()) {
      this.draft.name = repo.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }
  }

  private loadGitHubRepos() {
    if (!this.auth.isGitHubConnected()) {
      this.githubRepos.set([]);
      return;
    }
    this.reposLoading.set(true);
    this.reposError.set('');
    this.auth.listGitHubRepos().subscribe({
      next: repos => {
        this.githubRepos.set(repos);
        this.reposLoading.set(false);
      },
      error: e => {
        this.reposLoading.set(false);
        this.reposError.set(e?.error?.message ?? 'Could not load GitHub repositories');
      }
    });
  }

  onPromptEnter() {
    const value = this.prompt.trim();
    if (!value) return;
    if (value.includes('github.com') || /^https?:\/\//i.test(value)) {
      this.openAdd('github');
      return;
    }
    if (/^[a-z0-9._/-]+:[a-z0-9._-]+$/i.test(value)) {
      this.openAdd('docker');
      return;
    }
    this.pickerError.set('Choose GitHub, Docker, or Database below.');
  }

  addModeLabel(): string {
    return { github: 'Deploy from GitHub', docker: 'Deploy Docker Image', database: 'Add Database' }[this.addMode()!] ?? '';
  }

  openService(svc: Service, tab?: string) {
    this.router.navigate(
      ['/projects', this.project()!.id, 'services', svc.id],
      tab ? { queryParams: { tab } } : undefined
    );
  }

  servicePublicHost(svc: Service): string | undefined {
    return publicHost(svc);
  }

  sourceIcon(type: ServiceSourceType): string {
    return { GITHUB: '⊙', DOCKER: '◈', DATABASE: '◉' }[type] ?? '◌';
  }

  runtimeLabel(type?: ServiceRuntime): string {
    return ({
      node: 'Node.js',
      java: 'Java',
      python: 'Python',
      go: 'Go',
      dotnet: '.NET',
      php: 'PHP',
      rust: 'Rust',
      other: 'Other'
    } as Record<string, string>)[type ?? 'node'] ?? 'Node.js';
  }

  sourceSummary(svc: Service): string {
    const d = svc.sourceDetails as unknown as Record<string, unknown>;
    if (svc.sourceType === 'GITHUB') return `${d['repositoryUrl'] ?? ''} @ ${d['branch'] ?? 'main'}`;
    if (svc.sourceType === 'DOCKER') {
      const port = d['containerPort'] != null ? ` :${d['containerPort']}` : '';
      return `${d['imageName']}:${d['imageTag'] ?? 'latest'}${port}`;
    }
    const db = String(d['dbType'] ?? 'DATABASE');
    const port = d['containerPort'] != null ? ` :${d['containerPort']}` : '';
    return `${db}${port}`;
  }

  addEnvVar() { this.draft.envVars.push({ key: '', value: '', isSecret: false }); }
  removeEnvVar(i: number) { this.draft.envVars.splice(i, 1); }

  canSubmitService(): boolean {
    if (!this.draft.name.trim()) return false;
    const mode = this.addMode();
    if (mode === 'github') return !!this.draft.repoUrl.trim();
    if (mode === 'docker') return !!this.draft.imageName.trim();
    return true;
  }

  submitService() {
    const mode = this.addMode();
    if (!mode || !this.canSubmitService() || !this.canManage()) return;

    let sourceDetails: ServiceSourceDetails;
    let sourceType: ServiceSourceType;

    if (mode === 'github') {
      sourceType = 'GITHUB';
      sourceDetails = {
        repositoryUrl: this.draft.repoUrl.trim(),
        branch: this.draft.branch.trim() || 'main',
        autoDeploy: this.draft.autoDeploy,
        runtime: this.draft.runtime
      };
    } else if (mode === 'docker') {
      sourceType = 'DOCKER';
      sourceDetails = {
        imageName: this.draft.imageName.trim(),
        imageTag: this.draft.imageTag.trim() || 'latest',
        containerPort: Number(this.draft.containerPort) || guessContainerPort(this.draft.imageName)
      };
    } else {
      const preset = DB_PRESETS[this.draft.dbType];
      sourceType = 'DATABASE';
      sourceDetails = {
        dbType: this.draft.dbType,
        serviceName: this.draft.name.trim(),
        containerPort: preset.port
      };
    }

    const forceVolume = mode === 'database' || this.draft.useVolume;
    const payload: CreateServiceRequest = {
      projectId: this.project()!.id,
      name: this.draft.name.trim(),
      sourceType,
      sourceDetails,
      runtime: mode === 'database' || mode === 'docker' ? 'other' : this.draft.runtime,
      envVars: this.draft.envVars.filter(e => e.key.trim()),
      ...(forceVolume
        ? {
            volume: {
              mountPath: this.draft.mountPath || (mode === 'database' ? DB_PRESETS[this.draft.dbType].mountPath : '/data'),
              sizeGb: this.draft.storageGb || (mode === 'database' ? 1 : 2)
            }
          }
        : {}),
    };

    this.adding.set(true);
    this.error.set(null);
    this.projectService.addService(this.project()!.id, payload).subscribe({
      next: svc => {
        this.project.update(p => p ? { ...p, services: [...p.services, svc] } : p);
        this.addMode.set(null);
        this.pickerOpen.set(false);
        this.adding.set(false);
      },
      error: e => {
        this.error.set(e?.error?.message ?? 'Failed to add service');
        this.adding.set(false);
      }
    });
  }

  deployService(svc: Service) {
    if (!this.canManage()) return;
    this.deploying[svc.id] = true;
    this.deployStage[svc.id] = 'QUEUED';
    this.error.set(null);
    this.projectService.deploy(svc.id).subscribe({
      next: () => {
        this.project.update(p => p ? {
          ...p,
          services: p.services.map(s =>
            s.id === svc.id ? { ...s, status: 'PENDING' } : s
          )
        } : p);
        this.pollServiceDeploy(svc.id);
      },
      error: e => {
        this.error.set(e?.error?.message ?? 'Deploy failed');
        this.deploying[svc.id] = false;
        delete this.deployStage[svc.id];
      }
    });
  }

  isServiceDeploying(svc: Service): boolean {
    return !!this.deploying[svc.id]
      || svc.status === 'BUILDING'
      || svc.status === 'DEPLOYING'
      || (svc.status === 'PENDING' && !!this.deployStage[svc.id]);
  }

  serviceDeployStep(svc: Service): number {
    const stage = this.deployStage[svc.id] ?? svc.status;
    switch (stage) {
      case 'QUEUED':
      case 'PENDING':
        return 0;
      case 'BUILDING':
        return 1;
      case 'DEPLOYING':
        return 2;
      case 'SUCCESS':
      case 'RUNNING':
        return 3;
      default:
        return 0;
    }
  }

  serviceDeployProgress(svc: Service): number {
    return [18, 42, 72, 100][this.serviceDeployStep(svc)] ?? 18;
  }

  private pollServiceDeploy(serviceId: string) {
    const projectId = this.project()?.id;
    if (!projectId) return;
    const ticks: Array<{ ms: number; stage: string }> = [
      { ms: 450, stage: 'BUILDING' },
      { ms: 1000, stage: 'DEPLOYING' },
      { ms: 1850, stage: 'SUCCESS' },
      { ms: 2300, stage: 'DONE' }
    ];
    ticks.forEach(({ ms, stage }) => {
      const t = setTimeout(() => {
        if (stage !== 'DONE') this.deployStage[serviceId] = stage;
        this.projectService.get(projectId).subscribe({
          next: p => {
            this.project.set(p);
            const svc = p.services.find(s => s.id === serviceId);
            if (stage === 'DONE' || svc?.status === 'RUNNING' || svc?.status === 'FAILED') {
              this.deploying[serviceId] = false;
              delete this.deployStage[serviceId];
            }
          },
          error: () => {
            if (stage === 'DONE') {
              this.deploying[serviceId] = false;
              delete this.deployStage[serviceId];
            }
          }
        });
      }, ms);
      this.deployPollTimers.push(t);
    });
  }

  stopService(svc: Service) {
    if (!this.canManage()) return;
    this.projectService.stopService(svc.id).subscribe({
      next: () => {
        this.project.update(p => p ? {
          ...p,
          services: p.services.map(s => s.id === svc.id ? { ...s, status: 'STOPPED' } : s)
        } : p);
      },
      error: e => this.error.set(e?.error?.message ?? 'Stop failed')
    });
  }

  confirmDeleteService(svc: Service) {
    if (!this.canManage()) return;
    if (!confirm(`Delete service "${svc.name}"? This cannot be undone.`)) return;
    this.projectService.deleteService(svc.id).subscribe({
      next: () => {
        this.project.update(p => p ? { ...p, services: p.services.filter(s => s.id !== svc.id) } : p);
      },
      error: e => this.error.set(e?.error?.message ?? 'Delete failed')
    });
  }

  private freshDraft() {
    return {
      name: '',
      runtime: 'node' as ServiceRuntime,
      repoUrl: '',
      branch: 'main',
      autoDeploy: true,
      imageName: '',
      imageTag: 'latest',
      containerPort: 80,
      dbType: 'POSTGRESQL' as DatabaseType,
      envVars: [] as EnvironmentVariable[],
      useVolume: false,
      mountPath: '/data',
      storageGb: 2,
    };
  }
}
