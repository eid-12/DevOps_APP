import { Component, HostListener, OnInit, inject, signal, ElementRef, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TableModule } from 'primeng/table';
import { ToolbarModule } from 'primeng/toolbar';
import { AuthService } from '../core/auth.service';
import { GitHubOAuthService } from '../core/github-oauth.service';
import {
  CreateServiceRequest,
  DatabaseType,
  EnvironmentVariable,
  GitHubRepo,
  PlanInfo,
  Project,
  ProjectEnvironment,
  ServiceRuntime,
  ServiceSourceDetails,
  ServiceSourceType,
  UsageSummary
} from '../core/models';
import { ProjectService } from '../core/project.service';
import { CreatePickerComponent, CreatePickerOptionId } from '../shared/create-picker.component';
import { EnvironmentSelectComponent } from '../shared/environment-select.component';
import { RuntimeSelectComponent } from '../shared/runtime-select.component';
import { GithubRepoSelectComponent } from '../shared/github-repo-select.component';
import { DockerPresetSelectComponent } from '../shared/docker-preset-select.component';
import { DatabaseTypeSelectComponent } from '../shared/database-type-select.component';
import { StyledSelectComponent, StyledSelectOption } from '../shared/styled-select.component';
import { ConfirmDeleteDialogComponent } from '../shared/confirm-delete-dialog.component';
import {
  DB_PRESETS,
  DOCKER_IMAGE_PRESETS,
  defaultStartCommand,
  guessContainerPort,
  parseDockerImageRef,
  slugifyServiceName
} from '../shared/service-source.util';

type CreateStep = 'picker' | 'form' | 'empty';
type CreateKind = 'empty' | 'github' | 'docker' | 'database';


@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CreatePickerComponent,
    EnvironmentSelectComponent,
    RuntimeSelectComponent,
    GithubRepoSelectComponent,
    DockerPresetSelectComponent,
    DatabaseTypeSelectComponent,
    StyledSelectComponent,
    ConfirmDeleteDialogComponent,
    RouterLink,
    ButtonModule,
    TagModule,
    TableModule,
    ToolbarModule
  ],
  template: `
    <div class="page railway-page">
      <div class="container">
        <header class="railway-topbar">
          <div>
            <h1 class="railway-page-title">Projects</h1>
            <p class="railway-page-sub">Your deployment canvases and services</p>
          </div>
          <div class="railway-topbar-actions flex align-items-center gap-2">
            <div class="railway-search">
              <span class="railway-search-icon" aria-hidden="true">⌕</span>
              <input
                #searchInput
                [(ngModel)]="searchQuery"
                type="search"
                placeholder="Search projects..."
                aria-label="Search projects"
              >
              <kbd class="railway-search-kbd">Ctrl K</kbd>
            </div>
            <p-button
              label="New"
              icon="pi pi-plus"
              styleClass="railway-new-btn"
              (onClick)="openCreateModal()"
              [disabled]="!canCreate()"
            />
          </div>
        </header>

        @if (message()) {
          <div class="pill pill-red railway-alert">{{ message() }}</div>
        }

        @if (isSuspended()) {
          <div class="pill pill-red railway-alert">
            Your account is suspended. You cannot deploy or manage projects.
          </div>
        } @else if (!canDeploy()) {
          <div class="pill pill-red railway-alert">
            Deploy access is locked. You can browse existing projects, but create, deploy, edit, stop, and delete are blocked until an admin enables Deploy for your account.
          </div>
        }

        @if (showOnboarding()) {
          <section class="panel onboarding-card">
            <div class="svc-panel-head">
              <h3>Getting started</h3>
              <button type="button" class="btn btn-ghost btn-sm" (click)="dismissOnboarding()">Dismiss</button>
            </div>
            <div class="onboarding-steps">
              <label [class.done]="auth.isGitHubConnected()">
                <input type="checkbox" [checked]="auth.isGitHubConnected()" disabled />
                <span>Connect GitHub</span>
                <a routerLink="/account">Open</a>
              </label>
              <label [class.done]="projects().length > 0">
                <input type="checkbox" [checked]="projects().length > 0" disabled />
                <span>Create a project</span>
                <button type="button" (click)="openCreateModal()" [disabled]="!canCreate()">New</button>
              </label>
              <label [class.done]="hasAnyDeploy()">
                <input type="checkbox" [checked]="hasAnyDeploy()" disabled />
                <span>Deploy a service</span>
                <a routerLink="/help">How?</a>
              </label>
              <label [class.done]="hasDomain()">
                <input type="checkbox" [checked]="hasDomain()" disabled />
                <span>Assign a public URL</span>
                <a routerLink="/help">Docs</a>
              </label>
            </div>
          </section>
        }

        @if (!auth.isGitHubConnected() && canDeploy() && !isSuspended()) {
          <div class="pill pill-amber railway-alert github-banner">
            GitHub is not connected.
            <a routerLink="/account" fragment="github-connect" class="link-inline">Account</a>
            — connect to deploy from GitHub.
          </div>
        }

        @if (usage(); as u) {
          <div class="usage-strip panel" [class.usage-over]="isOverPlan()">
            <div class="usage-strip-item">
              <span>Projects</span><strong>{{ u.projects }}</strong>
            </div>
            <div class="usage-strip-item">
              <span>Services</span><strong>{{ u.services }}</strong>
            </div>
            <div class="usage-strip-item" [class.over]="isOver(u.memoryMbUsed, u.memoryMbLimit)">
              <span>RAM</span><strong>{{ u.memoryMbUsed }}/{{ u.memoryMbLimit }}MB</strong>
            </div>
            <div class="usage-strip-item">
              <span>Deploys</span><strong>{{ u.deploymentsThisMonth }}</strong>
            </div>
            <a routerLink="/billing" class="btn btn-ghost btn-sm">Billing</a>
          </div>
          @if (isOverPlan()) {
            <div class="pill pill-red railway-alert">
              Free plan resource limit exceeded. Downsize RAM/CPU/storage before creating more.
              <a routerLink="/billing" class="link-inline">Billing</a>
            </div>
          }
        }

        <div class="railway-toolbar">
          <div class="railway-toolbar-left">
            <span class="railway-count">
              {{ filteredProjects().length }} Project{{ filteredProjects().length === 1 ? '' : 's' }}
            </span>
            <app-styled-select
              class="railway-sort-wrap"
              [compact]="true"
              [(value)]="sortBy"
              [options]="sortOptions"
            />
            <button
              type="button"
              class="railway-filter-chip"
              [class.active]="showArchived"
              (click)="showArchived = !showArchived"
              [attr.aria-pressed]="showArchived"
            >
              Show archived
            </button>
          </div>
        </div>

        @if (loading()) {
          <div class="railway-grid">
            @for (i of skeletonSlots; track i) {
              <article class="railway-card skeleton-card" aria-hidden="true">
                <div class="skeleton skeleton-title"></div>
                <div class="skeleton skeleton-line w-70"></div>
                <div class="skeleton-canvas">
                  <div class="skeleton skeleton-block"></div>
                  <div class="skeleton skeleton-block"></div>
                  <div class="skeleton skeleton-block"></div>
                </div>
                <div class="skeleton skeleton-footer"></div>
              </article>
            }
          </div>
        } @else {
          <div class="railway-grid">
            @for (project of filteredProjects(); track project.id) {
              <article
                class="railway-card railway-card-clickable"
                [class.is-archived]="project.status === 'ARCHIVED'"
                (click)="openProject(project)"
              >
                <div class="railway-card-head">
                  <h3 class="railway-card-title">
                    <a class="railway-card-title-link" [routerLink]="['/projects', project.id]" (click)="$event.stopPropagation()">{{ project.name }}</a>
                  </h3>
                  <div class="project-menu" (click)="$event.stopPropagation()">
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm project-menu-btn"
                      (click)="toggleMenu(project.id)"
                      [attr.aria-expanded]="menuOpenId() === project.id"
                    >⋮</button>
                    @if (menuOpenId() === project.id) {
                      <div class="project-menu-dropdown panel">
                        <button type="button" (click)="openEditProject(project)">Edit</button>
                        <button type="button" (click)="cloneProject(project)">Clone</button>
                        @if (project.status === 'ACTIVE') {
                          <button type="button" (click)="archiveProject(project)">Archive</button>
                        } @else {
                          <button type="button" (click)="restoreProject(project)">Restore</button>
                        }
                        <button type="button" class="danger" (click)="deleteProject(project)">Delete</button>
                      </div>
                    }
                  </div>
                </div>
                @if (project.status === 'ARCHIVED') {
                  <span class="pill pill-amber u-mb-8 u-inline-flex">Archived</span>
                }
                @if (project.description) {
                  <p class="railway-card-desc">{{ project.description }}</p>
                }
                <div class="railway-canvas">
                  @for (svc of project.services; track svc.id) {
                    <div class="railway-service-block {{ sourceToTone(svc.sourceType) }}" [title]="svc.name + ' · ' + svc.status">
                      <span class="railway-service-icon">{{ sourceIcon(svc.sourceType) }}</span>
                    </div>
                  }
                  @if (!project.services.length) {
                    <span class="railway-empty-canvas">No services yet</span>
                  }
                </div>
                <footer class="railway-card-footer">
                  <span class="railway-status-dot" [class.online]="hasRunning(project)"></span>
                  <p-tag
                    [value]="(project.environment || 'production') | uppercase"
                    [severity]="envSeverity(project.environment)"
                    styleClass="railway-env-tag"
                  />
                  <span class="railway-footer-sep">·</span>
                  <span>{{ runningCount(project) }}/{{ project.services.length }} services online</span>
                </footer>
              </article>
            }

            @if (canCreate()) {
              <button type="button" class="railway-card railway-card-create" (click)="openCreateModal()" [disabled]="!canCreate()">
                <span class="railway-create-plus">+</span>
                <span>New Project</span>
              </button>
            }
          </div>

          @if (filteredProjects().length === 0) {
            <div class="railway-empty panel">
              <div class="empty-icon">⬡</div>
              @if (searchQuery.trim()) {
                <p>No projects match “{{ searchQuery.trim() }}”</p>
                <p class="empty-sub">Try another search term.</p>
              } @else {
                <p>No projects yet</p>
                <p class="empty-sub">Click <strong>+ New</strong> to create your first project.</p>
              }
            </div>
          }
        }
      </div>
    </div>

    @if (createOpen()) {
      <div class="modal-backdrop modal-backdrop-dots" (click)="onBackdropClick($event)">
        @if (createStep() === 'picker') {
          <app-create-picker
            [(prompt)]="prompt"
            [error]="createError()"
            [githubConnected]="auth.isGitHubConnected()"
            (select)="onPickerSelect($event)"
            (enter)="onPromptEnter()"
          />
        }

        @if (createStep() === 'empty') {
          <div class="modal-panel panel create-form-panel" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
            <div class="modal-header">
              <h2>Empty Project</h2>
              <button type="button" class="btn btn-ghost btn-sm" (click)="backToPicker()" [disabled]="creating()">✕</button>
            </div>
            <p class="modal-desc">Create a blank canvas, then add services later.</p>
            @if (createError()) {
              <div class="pill pill-red railway-alert">{{ createError() }}</div>
            }
            <div class="field field-gap">
              <label>Project Name</label>
              <input
                [ngModel]="emptyName || ''"
                (ngModelChange)="emptyName = ($event ?? '').toString()"
                placeholder="my-project"
                autocomplete="off"
                (keydown.enter)="submitEmptyProject()"
              />
            </div>
            <div class="field field-gap">
              <label>Description (optional)</label>
              <input [(ngModel)]="emptyDescription" placeholder="What is this project for?" />
            </div>
            <div class="field field-gap-lg">
              <label>Environment</label>
              <app-environment-select [(value)]="emptyEnvironment" />
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" (click)="backToPicker()" [disabled]="creating()">Cancel</button>
              <button
                type="button"
                class="btn btn-primary"
                (click)="submitEmptyProject()"
                [disabled]="creating() || !emptyName.trim()"
              >
                {{ creating() ? 'Creating…' : 'Create Project' }}
              </button>
            </div>
          </div>
        }

        @if (createStep() === 'form') {
          <div
            class="modal-panel panel create-form-panel"
            [class.create-form-panel--github]="createKind() === 'github'"
            (click)="$event.stopPropagation()"
            role="dialog"
            aria-modal="true"
          >
            <div class="modal-header">
              <h2>{{ formTitle() }}</h2>
              <button type="button" class="modal-close" (click)="backToPicker()" [disabled]="creating()" aria-label="Close">✕</button>
            </div>

            @if (createError()) {
              <div class="pill pill-red railway-alert">{{ createError() }}</div>
            }

            @if (createKind() === 'github' && !auth.isGitHubConnected()) {
              <div class="pill pill-amber railway-alert">
                Connect GitHub from Account first, then pick a repository.
                <a routerLink="/account" fragment="github-connect" class="link-inline-sm">Account</a>
              </div>
            }

            <div class="add-service-form">
              <div class="field">
                <label>Service Name</label>
                <input [(ngModel)]="draft.name" placeholder="my-service" autocomplete="off" />
              </div>

              <div class="field">
                <label>Environment</label>
                <app-environment-select [(value)]="createEnvironment" />
              </div>

              @if (createKind() === 'github') {
                @if (auth.isGitHubConnected()) {
                  <div class="field">
                    <label>Repository</label>
                    <app-github-repo-select
                      [repos]="githubRepos()"
                      [value]="selectedRepoFullName"
                      [loading]="reposLoading()"
                      (valueChange)="onGitHubRepoPicked($event)"
                    />
                    @if (reposError()) {
                      <p class="muted u-text-danger u-text-12 empty-hint">{{ reposError() }}</p>
                    }
                  </div>
                }
                <div class="field">
                  <label>Repository URL</label>
                  <input
                    [(ngModel)]="draft.repoUrl"
                    [placeholder]="repoUrlPlaceholder()"
                  />
                </div>
                <div class="field">
                  <label>Branch</label>
                  <input [(ngModel)]="draft.branch" placeholder="main" />
                </div>
                <p class="create-form-hint">Advanced options (root directory, build, healthcheck, restart) are in Settings after create.</p>
              }

              @if (createKind() === 'docker') {
                <p class="muted muted-hint">
                  Pull any public image from Docker Hub (or your namespace <code>minipcer/…</code>).
                </p>
                <div class="field">
                  <label>Quick presets</label>
                  <app-docker-preset-select
                    [value]="dockerPresetKey"
                    (valueChange)="applyDockerPreset($event)"
                  />
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
                  <label>Container listen port</label>
                  <input type="number" [(ngModel)]="draft.containerPort" min="1" max="65535" />
                  <p class="empty-sub empty-hint">Port inside this container only (Nginx/Hello = 80, Grafana = 3000). Not a host port — many services can all use 80 safely. Public access is via a random HTTPS URL.</p>
                </div>
                <div class="field">
                  <label>Start command <span class="muted">(optional)</span></label>
                  <input
                    [(ngModel)]="draft.startCommand"
                    placeholder="Leave empty to use image default"
                    autocomplete="off"
                    spellcheck="false"
                    class="u-mono-input"
                  />
                </div>
              }

              @if (createKind() === 'database') {
                <div class="field">
                  <label>Database Type</label>
                  <app-database-type-select
                    [value]="draft.dbType"
                    (valueChange)="onDbTypeChange($event)"
                  />
                  <p class="empty-sub empty-hint">{{ dbPreset(draft.dbType).hint }}</p>
                </div>
                <div class="field">
                  <label>Internal port</label>
                  <input type="number" [ngModel]="dbPreset(draft.dbType).port" disabled />
                </div>
              }

              @if (createKind() === 'docker') {
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
                    <p class="empty-sub u-m-0">Optional — add keys your app needs at runtime.</p>
                  }
                </div>
              }

              @if (createKind() === 'database') {
                <p class="muted muted-hint">
                  Persistent volume is required for databases so data survives restarts.
                </p>
              } @else if (createKind() === 'docker') {
                <label class="toggle-field">
                  <input type="checkbox" [(ngModel)]="draft.useVolume" />
                  <span>Persistent Volume</span>
                </label>
              }
              @if (createKind() !== 'github' && (draft.useVolume || createKind() === 'database')) {
                <div class="field">
                  <label>Mount Path <span class="muted u-fw-400">(inside container only)</span></label>
                  <input [(ngModel)]="draft.mountPath" [placeholder]="createKind() === 'database' ? dbPreset(draft.dbType).mountPath : '/data'" />
                  <small class="muted">Host disk path is fixed by CloudBase. Example: /data or /var/lib/postgresql/data</small>
                </div>
                <div class="field">
                  <label>Storage (GB)</label>
                  <input type="number" [(ngModel)]="draft.storageGb" min="1" max="50" />
                </div>
              }

              <div class="modal-actions">
                <button type="button" class="btn btn-ghost" (click)="backToPicker()" [disabled]="creating()">Cancel</button>
                <button
                  type="button"
                  class="btn btn-primary"
                  (click)="submitWithService()"
                  [disabled]="creating() || !canSubmitForm()"
                >
                  {{ creating() ? 'Creating…' : (createKind() === 'github' ? 'Deploy' : 'Add Service') }}
                </button>
              </div>
            </div>
          </div>
        }
      </div>
    }

    @if (editOpen()) {
      <div class="modal-backdrop" (click)="onEditBackdrop($event)">
        <div class="modal-panel panel create-form-panel" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h2>Edit Project</h2>
            <button type="button" class="btn btn-ghost btn-sm" (click)="closeEdit()" [disabled]="savingEdit()">✕</button>
          </div>
          @if (editError()) {
            <div class="pill pill-red railway-alert">{{ editError() }}</div>
          }
          <div class="field field-gap">
            <label>Project Name</label>
            <input [(ngModel)]="editName" autocomplete="off" />
          </div>
          <div class="field field-gap">
            <label>Description</label>
            <input [(ngModel)]="editDescription" placeholder="Optional description" />
          </div>
          <div class="field field-gap-lg">
            <label>Environment</label>
            <app-environment-select [(value)]="editEnvironment" />
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" (click)="closeEdit()" [disabled]="savingEdit()">Cancel</button>
            <button type="button" class="btn btn-primary" (click)="saveEdit()" [disabled]="savingEdit() || !editName.trim()">
              {{ savingEdit() ? 'Saving…' : 'Save Changes' }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (deleteTarget(); as target) {
      <app-confirm-delete-dialog
        title="Delete project"
        [confirmName]="target.name"
        [busy]="deleting()"
        [error]="deleteError()"
        confirmLabel="Delete project permanently"
        warning="Deletes this project and everything under it. Each service is removed from Portainer and NPM with verification before CloudBase deletes DB rows. If teardown fails, nothing is deleted."
        (cancel)="closeDeleteDialog()"
        (confirm)="executeDeleteProject()"
      />
    }
  `
})
export class DashboardPageComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly githubOAuth = inject(GitHubOAuthService);
  private readonly projectService = inject(ProjectService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly projects = signal<Project[]>([]);
  readonly usage = signal<UsageSummary | null>(null);
  readonly plan = signal<PlanInfo | null>(null);
  readonly message = signal('');
  readonly loading = signal(true);
  readonly skeletonSlots = [1, 2, 3, 4];
  readonly createOpen = signal(false);
  readonly createStep = signal<CreateStep>('picker');
  readonly createKind = signal<CreateKind>('empty');
  readonly creating = signal(false);
  readonly createError = signal('');
  readonly githubRepos = signal<GitHubRepo[]>([]);
  readonly reposLoading = signal(false);
  readonly reposError = signal('');
  selectedRepoFullName = '';
  readonly menuOpenId = signal<string | null>(null);
  readonly editOpen = signal(false);
  readonly savingEdit = signal(false);
  readonly deleteTarget = signal<Project | null>(null);
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);
  readonly editError = signal('');

  prompt = '';
  emptyName = '';
  emptyDescription = '';
  emptyEnvironment: ProjectEnvironment = 'production';
  createEnvironment: ProjectEnvironment = 'production';
  searchQuery = '';
  sortBy = 'name';
  readonly sortOptions: StyledSelectOption[] = [
    { label: 'Sort by: Name', value: 'name', icon: 'pi pi-sort-alpha-down' },
    { label: 'Sort by: Status', value: 'status', icon: 'pi pi-chart-bar' }
  ];
  showArchived = false;
  editProjectId = '';
  editName = '';
  editDescription = '';
  editEnvironment: ProjectEnvironment = 'production';
  draft = this.freshDraft();
  readonly dbTypes: DatabaseType[] = ['POSTGRESQL', 'MYSQL', 'REDIS', 'MONGODB'];
  readonly dockerPresets = DOCKER_IMAGE_PRESETS;
  dockerPresetKey = '';

  ngOnInit() {
    this.loadProjects();
    this.auth.usage().subscribe({ next: u => this.usage.set(u), error: () => {} });
    this.auth.getPlan().subscribe({ next: p => this.plan.set(p), error: () => {} });
    if (this.route.snapshot.queryParamMap.get('create') === '1') {
      queueMicrotask(() => this.openCreateModal());
      void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.searchInput()?.nativeElement.focus();
    }
    if (event.key === 'Escape') {
      this.closeCreateModal();
      this.closeEdit();
      this.menuOpenId.set(null);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.project-menu')) return;
    this.menuOpenId.set(null);
  }

  loadProjects() {
    this.loading.set(true);
    this.projectService.list().subscribe({
      next: projects => {
        this.projects.set(projects);
        this.loading.set(false);
        if (this.onboardingComplete() && !this.auth.user()?.onboardingDismissed) {
          this.dismissOnboarding();
        }
      },
      error: err => { this.message.set(err?.error?.message ?? 'Failed to load projects'); this.loading.set(false); }
    });
  }

  filteredProjects(): Project[] {
    const q = this.searchQuery.trim().toLowerCase();
    let list = this.projects().filter(p => this.showArchived || p.status !== 'ARCHIVED');

    if (q) {
      list = list.filter(p =>
        p.name.toLowerCase().includes(q)
        || (p.description ?? '').toLowerCase().includes(q)
      );
    }

    if (this.sortBy === 'name') list = list.sort((a, b) => a.name.localeCompare(b.name));
    if (this.sortBy === 'status') list = list.sort((a, b) => a.status.localeCompare(b.status));
    return list;
  }

  openProject(project: Project) {
    this.router.navigate(['/projects', project.id]);
  }

  toggleMenu(projectId: string) {
    this.menuOpenId.update(id => id === projectId ? null : projectId);
  }

  openEditProject(project: Project) {
    this.menuOpenId.set(null);
    this.editProjectId = project.id;
    this.editName = project.name;
    this.editDescription = project.description ?? '';
    this.editEnvironment = project.environment || 'production';
    this.editError.set('');
    this.editOpen.set(true);
  }

  closeEdit() {
    if (this.savingEdit()) return;
    this.editOpen.set(false);
  }

  onEditBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) this.closeEdit();
  }

  saveEdit() {
    if (!this.editName.trim() || this.savingEdit()) return;
    this.savingEdit.set(true);
    this.editError.set('');
    this.projectService.update(this.editProjectId, {
      name: this.editName.trim(),
      description: this.editDescription.trim(),
      environment: this.editEnvironment
    }).subscribe({
      next: updated => {
        this.projects.update(list => list.map(p => p.id === updated.id ? updated : p));
        this.savingEdit.set(false);
        this.editOpen.set(false);
      },
      error: err => {
        this.savingEdit.set(false);
        this.editError.set(err?.error?.message ?? 'Failed to update project');
      }
    });
  }

  archiveProject(project: Project) {
    this.menuOpenId.set(null);
    this.projectService.archive(project.id).subscribe({
      next: updated => this.projects.update(list => list.map(p => p.id === updated.id ? updated : p)),
      error: err => this.message.set(err?.error?.message ?? 'Failed to archive project')
    });
  }

  restoreProject(project: Project) {
    this.menuOpenId.set(null);
    this.projectService.restore(project.id).subscribe({
      next: updated => this.projects.update(list => list.map(p => p.id === updated.id ? updated : p)),
      error: err => this.message.set(err?.error?.message ?? 'Failed to restore project')
    });
  }

  deleteProject(project: Project) {
    this.menuOpenId.set(null);
    if (!this.canDeploy()) {
      this.message.set('Deploy access is locked. Delete is blocked.');
      return;
    }
    this.deleteError.set(null);
    this.deleting.set(false);
    this.deleteTarget.set(project);
  }

  closeDeleteDialog() {
    if (this.deleting()) return;
    this.deleteTarget.set(null);
    this.deleteError.set(null);
  }

  executeDeleteProject() {
    const project = this.deleteTarget();
    if (!project || this.deleting()) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    this.projectService.delete(project.id).subscribe({
      next: () => {
        this.projects.update(list => list.filter(p => p.id !== project.id));
        this.deleting.set(false);
        this.deleteTarget.set(null);
      },
      error: err => {
        this.deleting.set(false);
        this.deleteError.set(
          err?.error?.message ?? 'Delete failed. Nothing was removed from CloudBase until Portainer confirms.'
        );
      }
    });
  }

  cloneProject(project: Project) {
    this.menuOpenId.set(null);
    this.projectService.clone(project.id).subscribe({
      next: cloned => {
        this.projects.update(list => [cloned, ...list]);
        this.router.navigate(['/projects', cloned.id]);
      },
      error: err => this.message.set(err?.error?.message ?? 'Clone failed')
    });
  }

  showOnboarding(): boolean {
    if (this.auth.user()?.onboardingDismissed || this.isSuspended()) {
      return false;
    }
    // Already finished the checklist (e.g. has projects + deploy + URL) — don't keep nagging.
    if (this.onboardingComplete()) {
      return false;
    }
    return true;
  }

  /** True when every Getting started step is done. */
  onboardingComplete(): boolean {
    return (
      this.auth.isGitHubConnected() &&
      this.projects().length > 0 &&
      this.hasAnyDeploy() &&
      this.hasDomain()
    );
  }

  dismissOnboarding() {
    this.auth.dismissOnboarding().subscribe();
  }

  hasAnyDeploy(): boolean {
    return this.projects().some(p => p.services.some(s => s.status === 'RUNNING' || !!s.latestDeploymentId));
  }

  hasDomain(): boolean {
    return this.projects().some(p => p.services.some(s => !!(s.customDomain || s.subdomain)));
  }

  openCreateModal() {
    if (!this.canCreate()) {
      this.message.set(
        this.isSuspended()
          ? 'Your account is suspended. All manage and deploy actions are blocked.'
          : 'Deploy access is locked. An admin must enable Deploy before you can create or change anything.'
      );
      return;
    }
    this.prompt = '';
    this.emptyName = '';
    this.emptyDescription = '';
    this.emptyEnvironment = 'production';
    this.createEnvironment = 'production';
    this.createError.set('');
    this.createStep.set('picker');
    this.createKind.set('empty');
    this.draft = this.freshDraft();
    this.createOpen.set(true);
  }

  closeCreateModal() {
    if (this.creating()) return;
    this.createOpen.set(false);
  }

  onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) this.closeCreateModal();
  }

  backToPicker() {
    if (this.creating()) return;
    this.createError.set('');
    this.createStep.set('picker');
  }

  onPickerSelect(id: CreatePickerOptionId) {
    if (this.creating()) return;

    // Empty Project → ask for name
    if (id === 'empty') {
      this.createError.set('');
      this.emptyName = this.prompt.trim() ? this.slugify(this.prompt) : '';
      this.createStep.set('empty');
      return;
    }

    // GitHub requires a connected account → OAuth login on github.com
    if (id === 'github' && !this.auth.isGitHubConnected()) {
      this.redirectToGitHubLogin();
      return;
    }

    if (id === 'github' || id === 'docker' || id === 'database') {
      this.createError.set('');
      this.openForm(id);
    }
  }

  /** Send the user to GitHub's OAuth login/authorize page. */
  private redirectToGitHubLogin() {
    try {
      this.githubOAuth.startLogin();
    } catch (e) {
      this.createError.set((e as Error).message || 'Could not start GitHub login');
      this.createStep.set('picker');
    }
  }

  openForm(kind: 'github' | 'docker' | 'database') {
    this.createKind.set(kind);
    this.draft = this.freshDraft();
    this.createEnvironment = 'production';
    this.draft.runtime = kind === 'database' ? 'other' : 'node';
    this.draft.startCommand = kind === 'github' ? defaultStartCommand('node') : '';
    this.startCommandTouched = false;
    this.selectedRepoFullName = '';
    this.githubRepos.set([]);
    this.reposError.set('');
    this.dockerPresetKey = '';

    const prompt = this.prompt.trim();
    if (kind === 'github' && (prompt.startsWith('http') || prompt.includes('github.com'))) {
      this.draft.repoUrl = prompt;
      this.draft.name = this.guessNameFromRepo(prompt);
    } else if (kind === 'docker' && prompt && !prompt.includes(' ')) {
      const parsed = parseDockerImageRef(prompt);
      this.draft.imageName = parsed.imageName;
      this.draft.imageTag = parsed.imageTag;
      this.draft.containerPort = guessContainerPort(parsed.imageName);
      this.draft.name = slugifyServiceName(parsed.imageName.split('/').pop() || parsed.imageName);
    } else if (prompt) {
      this.draft.name = this.slugify(prompt);
    }

    if (kind === 'github') {
      const user = this.auth.githubUsername();
      if (!this.draft.repoUrl && user) {
        this.draft.repoUrl = `https://github.com/${user}/`;
      }
      this.loadGitHubRepos();
    }

    if (kind === 'docker' && !this.draft.imageName) {
      this.draft.containerPort = 80;
    }

    if (kind === 'database') {
      this.draft.useVolume = true;
      this.draft.storageGb = 2;
      this.onDbTypeChange(this.draft.dbType);
    }

    this.createStep.set('form');
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
    // Only split tag when user typed image:tag in the image field
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
      this.draft.name = this.slugify(repo.name);
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

    // Paste repo link → GitHub form (or OAuth if not connected)
    if (value.includes('github.com') || /^https?:\/\//i.test(value)) {
      if (!this.auth.isGitHubConnected()) {
        this.redirectToGitHubLogin();
        return;
      }
      this.openForm('github');
      return;
    }

    // docker image:tag shorthand → Docker form
    if (/^[a-z0-9._/-]+:[a-z0-9._-]+$/i.test(value)) {
      this.openForm('docker');
      return;
    }

    // Free text → Empty Project name step
    this.emptyName = this.slugify(value);
    this.createStep.set('empty');
  }

  submitEmptyProject() {
    if (!this.emptyName.trim() || this.creating() || !this.canCreate()) return;
    this.creating.set(true);
    this.createError.set('');

    this.projectService.create({
      name: this.slugify(this.emptyName.trim()),
      description: this.emptyDescription.trim(),
      environment: this.emptyEnvironment
    }).subscribe({
      next: project => {
        this.creating.set(false);
        this.createOpen.set(false);
        this.router.navigate(['/projects', project.id]);
      },
      error: err => {
        this.creating.set(false);
        this.createError.set(err?.error?.message ?? 'Failed to create project');
      }
    });
  }

  formTitle(): string {
    return {
      github: 'Deploy from GitHub',
      docker: 'Deploy Docker Image',
      database: 'Add Database',
      empty: 'New Project'
    }[this.createKind()];
  }

  canSubmitForm(): boolean {
    if (!this.draft.name.trim()) return false;
    if (this.createKind() === 'github') return !!this.draft.repoUrl.trim();
    if (this.createKind() === 'docker') return !!this.draft.imageName.trim();
    return true;
  }

  submitWithService() {
    if (!this.canSubmitForm() || this.creating()) return;

    const kind = this.createKind();
    const projectName = this.slugify(this.draft.name.trim());
    this.creating.set(true);
    this.createError.set('');

    this.projectService.create({
      name: projectName,
      description: '',
      environment: this.createEnvironment
    }).subscribe({
      next: project => {
        const payload = this.buildServicePayload(project.id, kind);
        this.projectService.addService(project.id, payload).subscribe({
          next: () => {
            this.creating.set(false);
            this.createOpen.set(false);
            this.router.navigate(['/projects', project.id]);
          },
          error: err => {
            this.creating.set(false);
            this.createOpen.set(false);
            this.router.navigate(['/projects', project.id]);
            this.message.set(err?.error?.message ?? 'Project created, but service failed to add');
          }
        });
      },
      error: err => {
        this.creating.set(false);
        this.createError.set(err?.error?.message ?? 'Failed to create project');
      }
    });
  }

  addEnvVar() { this.draft.envVars.push({ key: '', value: '', isSecret: false }); }
  removeEnvVar(i: number) { this.draft.envVars.splice(i, 1); }

  sourceIcon(type: string): string {
    return ({ GITHUB: '⊙', DOCKER: '◈', DATABASE: '◉' } as Record<string, string>)[type] ?? '◌';
  }

  envSeverity(env?: string): 'success' | 'info' | 'warning' | 'danger' | 'secondary' | 'contrast' {
    switch (env) {
      case 'staging':
        return 'warning';
      case 'development':
        return 'info';
      case 'production':
      default:
        return 'danger';
    }
  }

  sourceToTone(type: string): string {
    return ({ GITHUB: 'tone-github', DOCKER: 'tone-app', DATABASE: 'tone-db' } as Record<string, string>)[type] ?? '';
  }

  hasRunning(project: Project): boolean {
    return project.services.some(s => s.status === 'RUNNING');
  }

  runningCount(project: Project): number {
    return project.services.filter(s => s.status === 'RUNNING').length;
  }

  isSuspended() {
    return this.auth.user()?.accountStatus === 'SUSPENDED';
  }

  canDeploy() {
    return this.auth.hasDeployAccess();
  }

  canCreate() {
    if (!this.canDeploy() || this.isSuspended()) return false;
    const u = this.usage();
    const p = this.plan();
    if (u && p) return this.auth.canCreateProject(u, p);
    return true;
  }

  isOver(used: number | undefined, limit: number | undefined): boolean {
    if (used == null || limit == null) return false;
    return used > limit;
  }

  isOverPlan(): boolean {
    const u = this.usage();
    const p = this.plan();
    if (!u || !p || this.auth.isAdmin()) return false;
    return u.memoryMbUsed > u.memoryMbLimit
      || u.storageGbUsed > u.storageGbLimit
      || (u.cpuMilliUsed ?? 0) > (u.cpuMilliLimit ?? 2000);
  }

  private buildServicePayload(projectId: string, kind: CreateKind): CreateServiceRequest {
    let sourceType: ServiceSourceType;
    let sourceDetails: ServiceSourceDetails;

    if (kind === 'github') {
      sourceType = 'GITHUB';
      sourceDetails = {
        repositoryUrl: this.draft.repoUrl.trim(),
        branch: this.draft.branch.trim() || 'main',
        autoDeploy: true,
        runtime: this.draft.runtime || 'node',
        startCommand: (this.draft.startCommand || defaultStartCommand(this.draft.runtime || 'node')).trim()
      };
    } else if (kind === 'docker') {
      sourceType = 'DOCKER';
      sourceDetails = {
        imageName: this.draft.imageName.trim(),
        imageTag: this.draft.imageTag.trim() || 'latest',
        containerPort: Number(this.draft.containerPort) || guessContainerPort(this.draft.imageName),
        ...(this.draft.startCommand.trim() ? { startCommand: this.draft.startCommand.trim() } : {})
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

    const forceVolume = kind === 'database' || this.draft.useVolume;
    const storageGb = this.draft.storageGb || (kind === 'database' ? 2 : 2);
    return {
      projectId,
      name: this.draft.name.trim(),
      sourceType,
      sourceDetails,
      runtime: kind === 'database' || kind === 'docker' ? 'other' : this.draft.runtime,
      envVars: this.draft.envVars.filter(e => e.key.trim()),
      quota: {
        memorymb: 512,
        cpuMilli: 500,
        storageGb
      },
      ...(forceVolume
        ? {
            volume: {
              mountPath: this.draft.mountPath || (kind === 'database' ? DB_PRESETS[this.draft.dbType].mountPath : '/data'),
              sizeGb: storageGb
            }
          }
        : {})
    };
  }

  private freshDraft() {
    return {
      name: '',
      runtime: 'node' as ServiceRuntime,
      startCommand: defaultStartCommand('node'),
      repoUrl: '',
      branch: 'main',
      rootDirectory: '',
      buildCommand: '',
      healthcheckPath: '',
      restartPolicy: 'unless-stopped' as 'unless-stopped' | 'on-failure',
      restartRetries: 10,
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

  /** When false, changing runtime refreshes the suggested start command. */
  startCommandTouched = false;

  onRuntimeChange(runtime: ServiceRuntime) {
    this.draft.runtime = runtime;
    if (!this.startCommandTouched) {
      this.draft.startCommand = defaultStartCommand(runtime);
    }
  }

  private slugify(value: string | null | undefined): string {
    return String(value ?? '')
      .toLowerCase()
      .replace(/https?:\/\//g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'untitled-project';
  }

  private guessNameFromRepo(url: string): string {
    const parts = url.replace(/\.git$/, '').split('/').filter(Boolean);
    return this.slugify(parts[parts.length - 1] || 'github-service');
  }
}
