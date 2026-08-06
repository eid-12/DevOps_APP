import { Component, HostListener, OnInit, inject, signal, ElementRef, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TableModule } from 'primeng/table';
import { ToolbarModule } from 'primeng/toolbar';
import { AuthService } from '../core/auth.service';
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
import { HighlightDirective } from '../shared/highlight.directive';
import {
  DB_PRESETS,
  DOCKER_IMAGE_PRESETS,
  guessContainerPort,
  parseDockerImageRef,
  slugifyServiceName
} from '../shared/service-source.util';

type CreateStep = 'picker' | 'form' | 'empty';
type CreateKind = 'empty' | 'github' | 'docker' | 'database';

const SOON_OPTIONS = new Set<CreatePickerOptionId>(['template', 'function', 'bucket']);
const SOON_LABELS: Record<string, string> = {
  template: 'Templates are coming soon.',
  function: 'Functions are coming soon.',
  bucket: 'Buckets are coming soon.'
};

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, FormsModule, CreatePickerComponent, RouterLink, ButtonModule, TagModule, TableModule, ToolbarModule, HighlightDirective],
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

        @if (!loading() && projects().length) {
          <div appHighlight="sky" class="mb-3">
            Angular + PrimeNG · binding: "{{ searchQuery }}" · {{ filteredProjects().length }} project(s)
          </div>
          <p-table
            [value]="filteredProjects()"
            [paginator]="filteredProjects().length > 5"
            [rows]="5"
            styleClass="p-datatable-sm mb-4"
            [rowHover]="true"
          >
            <ng-template pTemplate="header">
              <tr>
                <th>Name</th>
                <th>Environment</th>
                <th>Status</th>
                <th>Services</th>
                <th></th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-p>
              <tr>
                <td>
                  <button type="button" class="btn btn-ghost btn-sm" (click)="openProject(p)">{{ p.name }}</button>
                </td>
                <td>{{ p.environment || 'production' }}</td>
                <td>
                  <p-tag
                    [value]="p.status"
                    [severity]="p.status === 'ACTIVE' ? 'success' : 'warning'"
                  />
                </td>
                <td>{{ p.services?.length || 0 }}</td>
                <td>
                  <p-button icon="pi pi-arrow-right" [rounded]="true" [text]="true" (onClick)="openProject(p)" />
                </td>
              </tr>
            </ng-template>
          </p-table>
        }

        @if (message()) {
          <div class="pill pill-red railway-alert">{{ message() }}</div>
        }

        @if (isSuspended()) {
          <div class="pill pill-red railway-alert">
            Your account is suspended. You cannot deploy or manage projects.
          </div>
        } @else if (!canDeploy()) {
          <div class="pill pill-amber railway-alert">
            Deployment is disabled. An admin must enable deploy access before you can create projects.
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
                <button type="button" (click)="openCreateModal()">New</button>
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
            <a routerLink="/account" style="margin-left:8px;color:inherit;text-decoration:underline">Connect GitHub</a>
            to deploy private repos and enable auto-deploy.
          </div>
        }

        @if (usage(); as u) {
          <div class="usage-strip panel">
            <div class="usage-strip-item"><span>Projects</span><strong>{{ u.projects }}/{{ plan()?.projectsLimit ?? 2 }}</strong></div>
            <div class="usage-strip-item"><span>Services</span><strong>{{ u.services }}/{{ plan()?.servicesLimit ?? 3 }}</strong></div>
            <div class="usage-strip-item"><span>RAM</span><strong>{{ u.memoryMbUsed }}/{{ u.memoryMbLimit }}MB</strong></div>
            <div class="usage-strip-item"><span>Deploys</span><strong>{{ u.deploymentsThisMonth }}/{{ plan()?.deploymentsLimit ?? 20 }}</strong></div>
            <a routerLink="/billing" class="btn btn-ghost btn-sm">Billing</a>
          </div>
        }

        <div class="railway-toolbar">
          <div class="railway-toolbar-left">
            <span class="railway-count">
              {{ filteredProjects().length }} Project{{ filteredProjects().length === 1 ? '' : 's' }}
            </span>
            <select class="railway-sort" [(ngModel)]="sortBy">
              <option value="name">Sort By: Name</option>
              <option value="status">Sort By: Status</option>
            </select>
            <label class="toggle-inline railway-archived-toggle">
              <input type="checkbox" [(ngModel)]="showArchived" />
              Show archived
            </label>
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
                  <h3 class="railway-card-title">{{ project.name }}</h3>
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
                  <span class="pill pill-amber" style="margin-bottom:8px;display:inline-flex">Archived</span>
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
                  <span class="railway-env">{{ project.environment || 'production' }}</span>
                  <span class="railway-footer-sep">·</span>
                  <span>{{ runningCount(project) }}/{{ project.services.length }} services online</span>
                </footer>
              </article>
            }

            @if (canCreate()) {
              <button type="button" class="railway-card railway-card-create" (click)="openCreateModal()">
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
            <div class="field" style="margin-bottom: 14px;">
              <label>Project Name</label>
              <input
                [(ngModel)]="emptyName"
                placeholder="my-project"
                autocomplete="off"
                (keydown.enter)="submitEmptyProject()"
              />
            </div>
            <div class="field" style="margin-bottom: 14px;">
              <label>Description (optional)</label>
              <input [(ngModel)]="emptyDescription" placeholder="What is this project for?" />
            </div>
            <div class="field" style="margin-bottom: 18px;">
              <label>Environment</label>
              <select [(ngModel)]="emptyEnvironment">
                <option value="production">production</option>
                <option value="staging">staging</option>
                <option value="development">development</option>
              </select>
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
          <div class="modal-panel panel create-form-panel" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
            <div class="modal-header">
              <h2>{{ formTitle() }}</h2>
              <button type="button" class="btn btn-ghost btn-sm" (click)="backToPicker()" [disabled]="creating()">✕</button>
            </div>

            @if (createError()) {
              <div class="pill pill-red railway-alert">{{ createError() }}</div>
            }

            @if (createKind() === 'github' && !auth.isGitHubConnected()) {
              <div class="pill pill-amber railway-alert">
                GitHub is not connected — you can still paste a public repository URL.
                <a routerLink="/account" style="margin-left:6px;color:inherit;text-decoration:underline">Connect</a>
              </div>
            }

            <div class="add-service-form">
              <div class="field">
                <label>Service Name</label>
                <input [(ngModel)]="draft.name" placeholder="my-service" autocomplete="off" />
              </div>

              @if (createKind() === 'github') {
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

              <div class="field">
                <label>Environment</label>
                <select [(ngModel)]="createEnvironment">
                  <option value="production">production</option>
                  <option value="staging">staging</option>
                  <option value="development">development</option>
                </select>
              </div>

              @if (createKind() === 'github') {
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
                <label class="toggle-field">
                  <input type="checkbox" [(ngModel)]="draft.autoDeploy" />
                  <span>Auto deploy on push</span>
                </label>
              }

              @if (createKind() === 'docker') {
                <p class="muted" style="font-size:12px;margin:0 0 10px">
                  Pull any public image from Docker Hub (or your namespace <code>minipcer/…</code>).
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
                  <p class="empty-sub" style="margin:6px 0 0">Port the process listens on inside the container (Nginx = 80). A random public URL is assigned automatically.</p>
                </div>
              }

              @if (createKind() === 'database') {
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

              @if (createKind() === 'github' || createKind() === 'docker') {
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

              @if (createKind() === 'database') {
                <p class="muted" style="font-size:12px;margin:0 0 10px">
                  Persistent volume is required for databases so data survives restarts.
                </p>
              } @else {
                <label class="toggle-field">
                  <input type="checkbox" [(ngModel)]="draft.useVolume" />
                  <span>Persistent Volume</span>
                </label>
              }
              @if (draft.useVolume || createKind() === 'database') {
                <div class="field">
                  <label>Mount Path</label>
                  <input [(ngModel)]="draft.mountPath" [placeholder]="createKind() === 'database' ? dbPreset(draft.dbType).mountPath : '/data'" />
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
                  {{ creating() ? 'Creating…' : 'Add Service' }}
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
          <div class="field" style="margin-bottom:14px">
            <label>Project Name</label>
            <input [(ngModel)]="editName" autocomplete="off" />
          </div>
          <div class="field" style="margin-bottom:14px">
            <label>Description</label>
            <input [(ngModel)]="editDescription" placeholder="Optional description" />
          </div>
          <div class="field" style="margin-bottom:18px">
            <label>Environment</label>
            <select [(ngModel)]="editEnvironment">
              <option value="production">production</option>
              <option value="staging">staging</option>
              <option value="development">development</option>
            </select>
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
  `
})
export class DashboardPageComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly projectService = inject(ProjectService);
  private readonly router = inject(Router);
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
  readonly editError = signal('');

  prompt = '';
  emptyName = '';
  emptyDescription = '';
  emptyEnvironment: ProjectEnvironment = 'production';
  createEnvironment: ProjectEnvironment = 'production';
  searchQuery = '';
  sortBy: 'name' | 'status' = 'name';
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
    this.auth.usage().subscribe({ next: u => this.usage.set(u) });
    this.auth.getPlan().subscribe({ next: p => this.plan.set(p) });
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
      next: projects => { this.projects.set(projects); this.loading.set(false); },
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
    if (!confirm(`Delete project "${project.name}" and all its services? This cannot be undone.`)) return;
    this.projectService.delete(project.id).subscribe({
      next: () => this.projects.update(list => list.filter(p => p.id !== project.id)),
      error: err => this.message.set(err?.error?.message ?? 'Failed to delete project')
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
    return !this.auth.user()?.onboardingDismissed && !this.isSuspended();
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
          ? 'Suspended users cannot create projects.'
          : 'Deployment access is disabled for your account.'
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

    // Template / Function / Bucket → coming soon message
    if (SOON_OPTIONS.has(id)) {
      this.createError.set(SOON_LABELS[id] ?? 'Coming soon.');
      return;
    }

    // Empty Project → ask for name
    if (id === 'empty') {
      this.createError.set('');
      this.emptyName = this.prompt.trim() ? this.slugify(this.prompt) : '';
      this.createStep.set('empty');
      return;
    }

    // GitHub / Docker / Database → config form
    if (id === 'github' || id === 'docker' || id === 'database') {
      this.createError.set('');
      this.openForm(id);
    }
  }

  openForm(kind: 'github' | 'docker' | 'database') {
    this.createKind.set(kind);
    this.draft = this.freshDraft();
    this.createEnvironment = 'production';
    this.draft.runtime = kind === 'database' ? 'other' : 'node';
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
      this.draft.storageGb = 1;
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

    // Paste repo link → GitHub form
    if (value.includes('github.com') || /^https?:\/\//i.test(value)) {
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
    const user = this.auth.user();
    return !!user && user.accountStatus === 'ACTIVE' && user.deploymentEnabled;
  }

  canCreate() {
    return this.canDeploy() && !this.isSuspended();
  }

  private buildServicePayload(projectId: string, kind: CreateKind): CreateServiceRequest {
    let sourceType: ServiceSourceType;
    let sourceDetails: ServiceSourceDetails;

    if (kind === 'github') {
      sourceType = 'GITHUB';
      sourceDetails = {
        repositoryUrl: this.draft.repoUrl.trim(),
        branch: this.draft.branch.trim() || 'main',
        autoDeploy: this.draft.autoDeploy,
        runtime: this.draft.runtime
      };
    } else if (kind === 'docker') {
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

    const forceVolume = kind === 'database' || this.draft.useVolume;
    return {
      projectId,
      name: this.draft.name.trim(),
      sourceType,
      sourceDetails,
      runtime: kind === 'database' || kind === 'docker' ? 'other' : this.draft.runtime,
      envVars: this.draft.envVars.filter(e => e.key.trim()),
      ...(forceVolume
        ? {
            volume: {
              mountPath: this.draft.mountPath || (kind === 'database' ? DB_PRESETS[this.draft.dbType].mountPath : '/data'),
              sizeGb: this.draft.storageGb || (kind === 'database' ? 1 : 2)
            }
          }
        : {})
    };
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

  private slugify(value: string): string {
    return value
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
