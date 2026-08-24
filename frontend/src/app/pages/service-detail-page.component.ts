import {
  AfterViewChecked,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { friendlyApiMessage } from '../core/friendly-error';
import { ProjectService } from '../core/project.service';
import {
  DatabaseType,
  Deployment,
  EnvironmentVariable,
  Project,
  Service,
  ServiceLogLine,
  ServiceRuntime,
  ServiceSourceType,
  SharedVariable,
  TerminalLine,
  UsageSummary,
  PlanInfo
} from '../core/models';
import { DB_PRESETS, defaultStartCommand, dockerImageParts, formatDockerImage, guessContainerPort } from '../shared/service-source.util';
import { publicHost, publicUrl } from '../shared/public-host.util';
import { ConfirmDeleteDialogComponent } from '../shared/confirm-delete-dialog.component';
import { RuntimeSelectComponent } from '../shared/runtime-select.component';
import { DatabaseTypeSelectComponent } from '../shared/database-type-select.component';
import { StyledSelectComponent, StyledSelectOption } from '../shared/styled-select.component';

type ServiceTab = 'overview' | 'deployments' | 'metrics' | 'logs' | 'terminal' | 'variables' | 'network' | 'settings';
type MetricsRange = '1h' | '6h' | '1d' | '7d' | '30d';

interface MetricSeries {
  label: string;
  points: string;
  area: string;
  maxLabel: string;
  currentLabel: string;
  ticks: string[];
}

interface MetricSample {
  t: number;
  cpu: number;
  memMb: number;
  memPct: number;
}

@Component({
  selector: 'app-service-detail-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RuntimeSelectComponent, DatabaseTypeSelectComponent, StyledSelectComponent, ConfirmDeleteDialogComponent],
  template: `
<div class="page railway-page svc-page">
  <div class="container">
    <header class="railway-topbar svc-topbar">
      <div class="railway-topbar-left">
        <button type="button" class="btn btn-ghost btn-sm back-btn" (click)="goBack()">
          ← {{ project()?.name ?? 'Project' }}
        </button>
        <div>
          <div class="svc-title-row">
            <span class="svc-title-icon">{{ sourceIcon(service()?.sourceType) }}</span>
            <h1 class="railway-page-title">{{ service()?.name ?? '…' }}</h1>
            @if (service(); as svc) {
              <span class="service-status-badge" [class]="'badge-' + svc.status.toLowerCase()">{{ statusLabel(svc.status) }}</span>
            }
          </div>
          @if (headerStatusLine(); as line) {
            <p class="svc-status-hint">{{ line }}</p>
          }
          <p class="railway-page-sub">{{ sourceSummary() }}</p>
        </div>
      </div>

      <div class="railway-topbar-actions svc-actions">
        @if (service(); as svc) {
          @if (svc.status === 'PENDING' || svc.status === 'STOPPED' || svc.status === 'FAILED'
              || svc.status === 'BUILDING' || svc.status === 'DEPLOYING') {
            <button
              type="button"
              class="btn btn-primary btn-sm"
              (click)="deploy()"
              [disabled]="!canDeployNow()"
            >
              {{ svc.status === 'PENDING' || svc.status === 'STOPPED' ? 'Deploy' : 'Redeploy' }}
            </button>
            @if (svc.status === 'BUILDING' || svc.status === 'DEPLOYING' || svc.status === 'PENDING') {
              <button
                type="button"
                class="btn btn-sm btn-danger-soft"
                (click)="stop()"
                [disabled]="!canManage()"
                title="Cancel stuck deploy"
              >Stop</button>
            }
          }
          @if (svc.status === 'RUNNING') {
            <button type="button" class="btn btn-ghost btn-sm" (click)="setTab('terminal')">Terminal</button>
            <button type="button" class="btn btn-ghost btn-sm" (click)="setTab('logs')">Logs</button>
            <button type="button" class="btn btn-sm btn-ghost" (click)="restart()" [disabled]="busy() || !canManage()">
              {{ busy() ? '…' : 'Restart' }}
            </button>
            <button type="button" class="btn btn-sm btn-danger-soft" (click)="stop()" [disabled]="busy() || !canManage()">Stop</button>
            <button type="button" class="btn btn-primary btn-sm" (click)="deploy()" [disabled]="!canDeployNow()">
              Redeploy
            </button>
          }
        }
      </div>
    </header>

    @if (!canManage() && service()) {
      <div class="pill pill-red railway-alert" style="margin-bottom:14px">
        Deploy access is locked. Deploy, restart, stop, env/network changes, and delete are blocked until an admin enables Deploy.
      </div>
    }

    @if (message(); as msg) {
      <div class="pill svc-flash" [class]="messageTone() === 'error' ? 'pill-red' : 'pill-green'">
        <span>{{ msg }}</span>
        <button type="button" class="svc-flash-dismiss" (click)="clearMessage()" aria-label="Dismiss">✕</button>
      </div>
    }

    @if (loading()) {
      <div class="svc-skeleton">
        <div class="skeleton skeleton-tabs"></div>
        <div class="svc-panel-grid">
          <div class="panel skeleton-card">
            <div class="skeleton skeleton-line w-40"></div>
            <div class="skeleton skeleton-meter"></div>
            <div class="skeleton skeleton-meter"></div>
            <div class="skeleton skeleton-meter"></div>
          </div>
          <div class="panel skeleton-card">
            <div class="skeleton skeleton-line w-40"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line w-70"></div>
            <div class="skeleton skeleton-line w-55"></div>
          </div>
        </div>
      </div>
    } @else if (!service()) {
      <div class="railway-empty panel">
        <p>Service not found.</p>
        <p class="empty-sub">It may have been deleted or you lack access.</p>
        <button type="button" class="btn btn-ghost btn-sm" style="margin-top:10px" (click)="goBack()">← Back to project</button>
      </div>
    } @else {
      <nav class="svc-tabs" role="tablist">
        @for (t of tabs; track t.id) {
          <button
            type="button"
            class="svc-tab"
            [class.active]="tab() === t.id"
            (click)="setTab(t.id)"
          >{{ t.label }}</button>
        }
      </nav>

      <!-- OVERVIEW -->
      @if (tab() === 'overview') {
        @if (statusFeedback(); as fb) {
          <section class="panel svc-panel status-feedback" [attr.data-tone]="fb.tone">
            <div class="status-feedback-row">
              <div class="status-feedback-icon" aria-hidden="true">{{ fb.icon }}</div>
              <div class="status-feedback-body">
                <h3>{{ fb.title }}</h3>
                <p>{{ fb.body }}</p>
                @if (fb.detail) {
                  <p class="status-feedback-detail">{{ fb.detail }}</p>
                }
                <div class="status-feedback-actions">
                  @if (fb.primary === 'redeploy') {
                    <button type="button" class="btn btn-primary btn-sm" (click)="deploy()" [disabled]="!canDeployNow()">
                      {{ fb.primaryLabel }}
                    </button>
                  }
                  @if (fb.primary === 'account') {
                    <a routerLink="/account" fragment="github-connect" class="btn btn-primary btn-sm">{{ fb.primaryLabel }}</a>
                  }
                  @if (fb.secondary === 'logs') {
                    <button type="button" class="btn btn-ghost btn-sm" (click)="setTab('logs')">View logs</button>
                  }
                  @if (fb.secondary === 'deployments') {
                    <button type="button" class="btn btn-ghost btn-sm" (click)="setTab('deployments')">Deployments</button>
                  }
                </div>
              </div>
            </div>
          </section>
        }

        <div class="svc-panel-grid">
          <section class="panel svc-panel">
            <h3>Resources</h3>
            <div class="metric-row">
              <div class="metric">
                <span class="metric-label">CPU</span>
                <strong>{{ liveCpuLabel() }} <span class="metric-of">/ {{ service()!.quota.cpuMilli }}m</span></strong>
                <div class="meter"><span [style.width.%]="cpuPct()"></span></div>
                <small>Live usage vs limit</small>
              </div>
              <div class="metric">
                <span class="metric-label">Memory</span>
                <strong>{{ liveRamLabel() }} <span class="metric-of">/ {{ service()!.quota.memorymb }} MB</span></strong>
                <div class="meter"><span [style.width.%]="ramPct()"></span></div>
                <small>Live usage vs limit</small>
              </div>
              <div class="metric">
                <span class="metric-label">Storage</span>
                <strong>{{ storageAllocatedGb() }} GB <span class="metric-of">allocated</span></strong>
                <div class="meter"><span [style.width.%]="storagePct()"></span></div>
                <small>{{ service()!.volume?.mountPath || 'ephemeral (no volume)' }}</small>
              </div>
            </div>
          </section>

          <section class="panel svc-panel">
            <h3>Quick info</h3>
            <dl class="svc-dl">
              <div><dt>Source</dt><dd>{{ service()!.sourceType }}</dd></div>
              @if (service()!.sourceType === 'GITHUB') {
                <div><dt>Runtime</dt><dd>{{ runtimeLabel(service()!.runtime) }}</dd></div>
              }
              @if (service()!.sourceType === 'DATABASE') {
                <div><dt>Engine</dt><dd>{{ sourceSummary() }}</dd></div>
              }
              @if (service()!.sourceType === 'DOCKER') {
                <div><dt>Image</dt><dd>{{ sourceSummary() }}</dd></div>
              }
              <div><dt>Health</dt><dd>
                <span
                  class="pill"
                  [class.pill-green]="service()!.status === 'RUNNING'"
                  [class.pill-amber]="service()!.status !== 'RUNNING' && service()!.status !== 'FAILED'"
                  [class.pill-red]="service()!.status === 'FAILED'"
                >
                  {{ statusLabel(service()!.status) }}
                </span>
              </dd></div>
              <div><dt>Created</dt><dd>{{ service()!.createdAt | date:'medium' }}</dd></div>
              @if (service()!.sourceType !== 'DATABASE') {
                <div>
                  <dt>Public URL</dt>
                  <dd>
                    @if (publicUrl(service()!)) {
                      <a [href]="publicUrl(service()!)" target="_blank" rel="noopener">{{ publicHost(service()!) }}</a>
                      <button type="button" class="btn btn-ghost btn-sm" style="margin-left:6px" (click)="copyText(publicUrl(service()!)!)">Copy</button>
                    } @else {
                      <span class="muted">Not assigned</span>
                    }
                  </dd>
                </div>
              } @else {
                <div>
                  <dt>Private host</dt>
                  <dd class="mono">{{ service()!.containerName || ('cb-' + service()!.id) }}</dd>
                </div>
              }
              <div><dt>Latest deploy</dt><dd>{{ service()!.latestDeploymentId || '—' }}</dd></div>
            </dl>

            @if (service()!.sourceType === 'DATABASE' && dbConn()) {
              <h4 style="margin-top:18px">Connection</h4>
              <div class="conn-box">
                <code class="mono">{{ dbConn()!['url'] }}</code>
                <button type="button" class="btn btn-ghost btn-sm" (click)="copyText(dbConn()!['url'])">Copy URL</button>
              </div>
              <dl class="svc-dl" style="margin-top:10px">
                @for (key of dbConnKeys(); track key) {
                  @if (key !== 'url') {
                    <div>
                      <dt>{{ key }}</dt>
                      <dd class="mono">{{ dbConn()![key] }}</dd>
                    </div>
                  }
                }
              </dl>
            }

            <div class="svc-quick-links">
              <button type="button" class="btn btn-ghost btn-sm" (click)="setTab('logs')">View Logs</button>
              <button type="button" class="btn btn-ghost btn-sm" (click)="setTab('terminal')" [disabled]="service()!.status !== 'RUNNING'">Open Terminal</button>
              <button type="button" class="btn btn-ghost btn-sm" (click)="setTab('variables')">Edit Variables</button>
            </div>
          </section>
        </div>
      }

      <!-- DEPLOYMENTS -->
      @if (tab() === 'deployments') {
        <section class="panel svc-panel">
          <div class="svc-panel-head">
            <h3>Deployments</h3>
            <button type="button" class="btn btn-primary btn-sm" (click)="deploy()" [disabled]="busy() || !canDeployNow()">Deploy Now</button>
          </div>

          @if (!deployments().length) {
            <div class="railway-empty" style="padding:20px 8px">
              <p>No deployments yet.</p>
              <p class="empty-sub">Click Deploy Now to pull/build and start this service.</p>
              <button type="button" class="btn btn-primary btn-sm" style="margin-top:10px" (click)="deploy()" [disabled]="busy() || !canDeployNow()">Deploy Now</button>
            </div>
          } @else {
            <div class="dep-list">
              @for (d of deployments(); track d.id) {
                <article
                  class="dep-item"
                  [class.is-live]="isLiveDeploy(d)"
                  [class.is-active]="isInFlightDeploy(d)"
                  [class.is-failed]="d.status === 'FAILED' || deployStatusClass(d) === 'failed'"
                >
                  <div class="dep-item-main">
                    <div class="dep-item-left">
                      <span class="dep-status" [class]="'dep-' + deployStatusClass(d)">{{ deployStatusLabel(d) }}</span>
                      @if (isLiveDeploy(d)) {
                        <span class="pill pill-green dep-live-pill">Live</span>
                      }
                      @if (d.rollbackOf) {
                        <span class="pill pill-indigo dep-live-pill">Rollback</span>
                      }
                      @if (d.errorMessage && (d.status === 'FAILED' || deployStatusClass(d) === 'failed')) {
                        <p class="dep-error muted">{{ d.errorMessage }}</p>
                      }
                      <span class="dep-id mono">{{ d.id }}</span>
                      <span class="dep-when">{{ d.triggeredBy }} · {{ d.startedAt | date:'short' }}</span>
                      @if (d.commitSha) { <span class="mono dep-chip">#{{ d.commitSha }}</span> }
                      @if (d.imageTag) { <span class="mono dep-chip">{{ d.imageTag }}</span> }
                    </div>
                    <div class="dep-item-actions">
                      @if (isInFlightDeploy(d)) {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="cancelDeploy(d.id)" [disabled]="!canManage()">Cancel</button>
                      }
                      @if (d.status === 'SUCCESS' && isLiveDeploy(d)) {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="deploy()" [disabled]="busy() || !canDeployNow()">Redeploy</button>
                      }
                      @if (canRollback(d)) {
                        <button
                          type="button"
                          class="btn btn-ghost btn-sm"
                          (click)="openRollback(d)"
                          [disabled]="busy() || rollbackBusy()"
                        >Rollback</button>
                      }
                    </div>
                  </div>

                  @if (showDeployProgress(d)) {
                    <div class="dep-item-progress" aria-label="Deployment progress">
                      <p class="dep-stage">{{ stageLabel(d) }}</p>
                      <div class="deploy-timeline">
                        @for (step of deployTimelineSteps(); track step; let i = $index) {
                          <span
                            class="deploy-step"
                            [class.done]="i < deployStepIndex(d)"
                            [class.active]="i === deployStepIndex(d) && d.status !== 'FAILED'"
                            [class.failed]="i === deployStepIndex(d) && d.status === 'FAILED'"
                          >{{ step }}</span>
                          @if (i < deployTimelineSteps().length - 1) {
                            <span class="deploy-step-sep">→</span>
                          }
                        }
                      </div>
                      <div class="deploy-progress" aria-hidden="true">
                        <span [style.width.%]="deployProgressPct(d)"></span>
                      </div>
                    </div>
                  }

                  @if (deployFriendlyLog(d); as logText) {
                    <pre class="dep-logs">{{ logText }}</pre>
                  }
                </article>
              }
            </div>
          }
        </section>
      }

      @if (rollbackTarget(); as target) {
        <div class="modal-backdrop" (click)="onRollbackBackdrop($event)">
          <div class="modal-panel panel create-form-panel rollback-modal" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
            <div class="modal-header">
              <h2>Rollback deployment</h2>
              <button type="button" class="btn btn-ghost btn-sm" (click)="closeRollback()" [disabled]="rollbackBusy()">✕</button>
            </div>
            <p class="modal-desc">
              This will re-deploy the selected build and make it the live version of
              <strong> {{ service()?.name }}</strong>.
            </p>
            <div class="rollback-summary panel">
              <div class="rollback-summary-row">
                <span>Target</span>
                <strong class="mono">{{ target.id }}</strong>
              </div>
              <div class="rollback-summary-row">
                <span>Commit / image</span>
                <strong class="mono">
                  @if (target.commitSha) { #{{ target.commitSha }} }
                  @else if (target.imageTag) { {{ target.imageTag }} }
                  @else { — }
                </strong>
              </div>
              <div class="rollback-summary-row">
                <span>Originally deployed</span>
                <strong>{{ target.startedAt | date:'medium' }}</strong>
              </div>
              <div class="rollback-summary-row">
                <span>Triggered by</span>
                <strong>{{ target.triggeredBy }}</strong>
              </div>
            </div>
            <div class="pill pill-amber" style="margin:14px 0;display:block">
              Current live deploy will be replaced. Traffic switches after health checks pass.
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" (click)="closeRollback()" [disabled]="rollbackBusy()">Cancel</button>
              <button type="button" class="btn btn-primary" (click)="onRollback(target.id)" [disabled]="rollbackBusy()">
                {{ rollbackBusy() ? 'Rolling back…' : 'Confirm rollback' }}
              </button>
            </div>
          </div>
        </div>
      }

      <!-- LOGS -->
      @if (tab() === 'logs') {
        <section class="panel svc-panel logs-panel">
          <div class="svc-panel-head">
            <h3>Logs</h3>
            <div class="logs-toolbar">
              <app-styled-select
                [compact]="true"
                [(value)]="logFilter"
                [options]="logFilterOptions"
              />
              <label class="toggle-inline">
                <input
                  type="checkbox"
                  [ngModel]="liveLogs"
                  (ngModelChange)="toggleLiveLogs($event)"
                  [attr.aria-checked]="liveLogs"
                />
                Live
              </label>
              <button type="button" class="btn btn-ghost btn-sm" (click)="refreshLogs()">Refresh</button>
              <button type="button" class="btn btn-ghost btn-sm" (click)="clearLogsView()">Clear</button>
            </div>
          </div>
          @if (service()!.status !== 'RUNNING') {
            <div class="pill pill-amber" style="margin-bottom:12px;display:block;white-space:normal;line-height:1.45">
              @if (service()!.status === 'BUILDING') {
                Showing deploy / build activity. Container logs appear after the image is ready and Redeploy finishes.
              } @else if (service()!.status === 'FAILED') {
                No container yet — showing the last deploy trail. Connect GitHub if needed, then Redeploy.
              } @else {
                Container is not running yet. Showing deploy activity until the service is Healthy.
              }
            </div>
          }
          <div class="logs-console" #logsBox>
            @for (line of filteredLogs(); track line.id) {
              <div class="log-line" [class]="'lvl-' + line.level">
                <span class="log-time">{{ line.timestamp | date:'HH:mm:ss' }}</span>
                <span class="log-level">{{ line.level }}</span>
                @if (line.stream === 'deploy' || line.stream === 'system') {
                  <span class="log-stream">{{ line.stream }}</span>
                }
                <span class="log-msg">{{ line.message }}</span>
              </div>
            } @empty {
              <div class="muted" style="padding:16px">
                No log lines yet. Deploy the service, then Refresh or enable Live to stream output.
              </div>
            }
          </div>
        </section>
      }

      <!-- TERMINAL -->
      @if (tab() === 'terminal') {
        <section class="panel svc-panel term-panel">
          <div class="svc-panel-head">
            <h3>Terminal</h3>
            <span class="muted mono" style="font-size:12px">{{ service()!.name }}&#64;cloudbase:~$</span>
          </div>
          @if (service()!.status !== 'RUNNING') {
            <div class="pill pill-amber" style="margin-bottom:12px">
              Container is {{ service()!.status }}. Deploy the service to open a shell.
            </div>
          }
          <div class="term-console" #termBox (click)="focusTerm()">
            @for (line of termLines(); track line.id) {
              <div class="term-line" [class]="'term-' + line.type">{{ line.text }}</div>
            }
            <form class="term-input-row" (ngSubmit)="submitTerm()">
              <span class="term-prompt">$</span>
              <input
                #termInput
                class="term-input"
                [(ngModel)]="termCmd"
                name="termCmd"
                autocomplete="off"
                spellcheck="false"
                [disabled]="termBusy() || service()!.status !== 'RUNNING'"
                placeholder="Type a command — try help"
              />
            </form>
          </div>
          <div class="term-hints">
            @for (hint of terminalHints(); track hint.cmd) {
              <button type="button" class="term-chip" (click)="runHint(hint.cmd)" [title]="hint.cmd">{{ hint.label }}</button>
            }
          </div>
        </section>
      }

      <!-- VARIABLES -->
      @if (tab() === 'variables') {
        <section class="panel svc-panel">
          <div class="svc-panel-head">
            <div>
              <h3>Environment Variables</h3>
              <p class="muted" style="margin:4px 0 0;font-size:12px">Service-scoped keys + inherited project config</p>
            </div>
            <div class="var-head-actions">
              <span class="sync-chip" [ngClass]="varsSyncTone()">{{ varsSyncLabel() }}</span>
              <button type="button" class="btn btn-ghost btn-sm" (click)="addVar()" [disabled]="!canManage()">+ Add</button>
            </div>
          </div>

          <div class="inherited-vars panel">
            <div class="inherited-vars-head">
              <h4>Inherited from Project</h4>
              <a class="btn btn-ghost btn-sm" [routerLink]="['/projects', projectId]" [queryParams]="{ tab: 'variables' }">Manage →</a>
            </div>
            @if (!inheritedVars().length) {
              <p class="muted" style="margin:0;font-size:13px">
                No project variables attached to this service. Attach keys from Project → Variables.
              </p>
            } @else {
              <div class="inherited-var-list">
                @for (v of inheritedVars(); track v.id) {
                  <div class="inherited-var-row">
                    <code class="mono">{{ v.key }}</code>
                    <span class="inherited-var-val mono">{{ v.isSecret ? '••••••••' : v.value }}</span>
                    @if (v.isSecret) { <span class="pill pill-amber">Secret</span> }
                    <span class="pill pill-indigo">Project</span>
                  </div>
                }
              </div>
            }
          </div>

          <div class="svc-vars-block">
            <div class="svc-vars-head">
              <h4>Service variables</h4>
              <div class="ref-picker-wrap" [class.open]="refPickerOpen()">
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  (click)="toggleRefPicker()"
                  [disabled]="!canManage()"
                >Insert Reference</button>
                @if (refPickerOpen()) {
                  <div class="ref-picker panel">
                    <p class="ref-picker-title">Insert reference template</p>
                    @for (opt of referenceOptions(); track opt.value) {
                      <button type="button" class="ref-picker-item" (click)="insertReference(opt.value)">
                        <code class="mono">{{ opt.value }}</code>
                        <span class="muted">{{ opt.hint }}</span>
                      </button>
                    } @empty {
                      <p class="muted" style="margin:0;padding:8px;font-size:12px">No reference targets yet.</p>
                    }
                  </div>
                }
              </div>
            </div>

            <div class="var-list">
              @for (v of envDraft; track $index; let i = $index) {
                <div class="var-row" [class.var-row-focused]="refInsertIndex() === i">
                  <input
                    [(ngModel)]="v.key"
                    placeholder="KEY"
                    (ngModelChange)="markVarsDirty()"
                    (focus)="refInsertIndex.set(i)"
                  />
                  <div class="var-value-wrap">
                    <input
                      [(ngModel)]="v.value"
                      [attr.type]="v.isSecret && !showSecrets[i] ? 'password' : 'text'"
                      [placeholder]="refPlaceholder"
                      (ngModelChange)="markVarsDirty()"
                      (focus)="refInsertIndex.set(i)"
                    />
                  </div>
                  <label class="toggle-inline"><input type="checkbox" [(ngModel)]="v.isSecret" (ngModelChange)="markVarsDirty()" /> Secret</label>
                  @if (v.isSecret) {
                    <button type="button" class="btn btn-ghost btn-sm" (click)="showSecrets[i] = !showSecrets[i]">
                      {{ showSecrets[i] ? 'Hide' : 'Show' }}
                    </button>
                  }
                  <button type="button" class="btn btn-ghost btn-sm danger" (click)="removeVar(i)">✕</button>
                </div>
              } @empty {
                <p class="muted">No service variables yet. Add one, then use Insert Reference.</p>
              }
            </div>
          </div>

          <div class="modal-actions" style="margin-top:16px">
            <button type="button" class="btn btn-primary" (click)="saveVars()" [disabled]="saving() || !canManage() || !varsDirty()">
              {{ saving() ? 'Saving…' : 'Save Variables' }}
            </button>
            @if (service()?.envPendingDeploy) {
              <button type="button" class="btn btn-ghost" (click)="deploy()" [disabled]="busy() || !canDeployNow()">
                Redeploy to apply
              </button>
            }
          </div>
        </section>
      }

      <!-- METRICS -->
      @if (tab() === 'metrics') {
        <section class="metrics-section">
          <div class="metrics-toolbar">
            <div class="metrics-ranges">
              <span class="muted" style="font-size:12px;margin-right:8px;align-self:center">Live (this session)</span>
              @for (r of metricsRanges; track r) {
                <button
                  type="button"
                  class="metrics-range-btn"
                  [class.active]="metricsRange() === r"
                  (click)="setMetricsRange(r)"
                >{{ r }}</button>
              }
            </div>
            <button type="button" class="btn btn-ghost btn-sm" (click)="refreshLiveMetrics()" [disabled]="metricsLoading()">
              {{ metricsLoading() ? 'Refreshing…' : 'Refresh' }}
            </button>
          </div>

          @if (metricsLoading() && !cpuSeries().points) {
            <div class="metrics-grid">
              @for (i of [1,2]; track i) {
                <article class="panel metrics-card skeleton-card">
                  <div class="skeleton skeleton-line w-40"></div>
                  <div class="skeleton skeleton-chart"></div>
                </article>
              }
            </div>
          } @else if (!liveMetrics()?.['available'] && !cpuSeries().points) {
            <div class="panel svc-panel">
              <p class="muted">{{ liveMetrics()?.['error'] || 'Metrics unavailable — deploy the service and keep it RUNNING.' }}</p>
            </div>
          } @else {
            <div class="metrics-grid">
              <article class="panel metrics-card">
                <div class="metrics-card-head">
                  <h3>CPU</h3>
                  <strong>{{ cpuSeries().currentLabel }}</strong>
                </div>
                <svg class="metrics-chart" viewBox="0 0 360 140" preserveAspectRatio="none" aria-hidden="true">
                  <line class="metrics-gridline" x1="0" y1="35" x2="360" y2="35"></line>
                  <line class="metrics-gridline" x1="0" y1="70" x2="360" y2="70"></line>
                  <line class="metrics-gridline" x1="0" y1="105" x2="360" y2="105"></line>
                  <path class="metrics-area metrics-area-cpu" [attr.d]="cpuSeries().area"></path>
                  <polyline class="metrics-line metrics-line-cpu" fill="none" [attr.points]="cpuSeries().points"></polyline>
                </svg>
                <div class="metrics-axis">
                  <span>{{ cpuSeries().ticks[0] }}</span>
                  <span>{{ cpuSeries().ticks[1] }}</span>
                  <span>{{ cpuSeries().ticks[2] }}</span>
                </div>
                <div class="metrics-legend">
                  <span><i class="dot dot-cpu"></i> Usage</span>
                  <span class="muted">{{ cpuSeries().maxLabel }} peak</span>
                </div>
              </article>

              <article class="panel metrics-card">
                <div class="metrics-card-head">
                  <h3>Memory</h3>
                  <strong>{{ memSeries().currentLabel }}</strong>
                </div>
                <svg class="metrics-chart" viewBox="0 0 360 140" preserveAspectRatio="none" aria-hidden="true">
                  <line class="metrics-gridline" x1="0" y1="35" x2="360" y2="35"></line>
                  <line class="metrics-gridline" x1="0" y1="70" x2="360" y2="70"></line>
                  <line class="metrics-gridline" x1="0" y1="105" x2="360" y2="105"></line>
                  <path class="metrics-area metrics-area-mem" [attr.d]="memSeries().area"></path>
                  <polyline class="metrics-line metrics-line-mem" fill="none" [attr.points]="memSeries().points"></polyline>
                </svg>
                <div class="metrics-axis">
                  <span>{{ memSeries().ticks[0] }}</span>
                  <span>{{ memSeries().ticks[1] }}</span>
                  <span>{{ memSeries().ticks[2] }}</span>
                </div>
                <div class="metrics-legend">
                  <span><i class="dot dot-mem"></i> Usage</span>
                  <span class="muted">{{ memSeries().maxLabel }} peak</span>
                </div>
              </article>
            </div>
          }
        </section>
      }

      <!-- NETWORK -->
      @if (tab() === 'network') {
        <section class="panel svc-panel">
          <h3>Networking</h3>
          @if (service()!.sourceType === 'DATABASE') {
            <p class="muted" style="margin-bottom:16px">
              Databases stay on the private Docker network — no public URL or custom domain.
              Other services in this project connect by container name and port.
            </p>
          } @else {
            <p class="muted" style="margin-bottom:16px">
              Public HTTP via Cloudflare Tunnel + Nginx Proxy Manager.
              Platform hosts are random numbers (not guessable). Bring your own domain for a branded URL.
            </p>

            <div class="field" style="margin-bottom:18px">
              <label>Platform URL (read-only)</label>
              @if (service()!.subdomain) {
                <p class="svc-live-url" style="margin:8px 0 0">
                  <a [href]="'https://' + service()!.subdomain" target="_blank" rel="noopener">
                    https://{{ service()!.subdomain }}
                  </a>
                  <button type="button" class="btn btn-ghost btn-sm" style="margin-left:6px" (click)="copyText('https://' + service()!.subdomain!)">Copy</button>
                </p>
                <p class="muted" style="margin-top:8px;font-size:13px">
                  @if (vanityStatus()?.thisServiceHoldsVanity) {
                    This service holds your <strong>one</strong> vanity subdomain. Other services stay on random URLs.
                  } @else {
                    Random platform URL by default. Each account may claim <strong>exactly one</strong> vanity name below.
                  }
                </p>
              } @else {
                <p class="muted">Assigned on first deploy.</p>
              }
            </div>

            <div class="field" style="margin-bottom:22px">
              <label>Vanity subdomain (1 per account)</label>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <input
                  style="flex:1;min-width:140px;max-width:220px"
                  [(ngModel)]="vanityDraft"
                  (ngModelChange)="onVanityDraftChange($event)"
                  placeholder="myapp"
                  autocomplete="off"
                  [disabled]="!canManage()"
                />
                <span class="muted">.{{ vanityStatus()?.baseDomain || 'cloudbase.website' }}</span>
                <button
                  type="button"
                  class="btn btn-ghost"
                  (click)="checkVanity()"
                  [disabled]="checkingVanity() || !canManage() || !vanityDraft.trim()"
                >
                  {{ checkingVanity() ? 'Checking…' : 'Check' }}
                </button>
              </div>
              @if (vanityCheck(); as vcheck) {
                <p
                  class="muted"
                  style="margin-top:8px;font-size:13px"
                  [style.color]="vcheck.available ? 'var(--ok, #3d9a6a)' : 'var(--danger, #c44)'"
                >
                  {{ vcheck.available ? '✓' : '✗' }} {{ vcheck.reason }}
                  @if (vcheck.domain) {
                    <span> — <code>{{ vcheck.domain }}</code></span>
                  }
                </p>
              } @else if (vanityStatus()?.claimedSlug && !vanityStatus()?.thisServiceHoldsVanity) {
                <p class="muted" style="margin-top:8px;font-size:13px;color:var(--danger, #c44)">
                  Account already uses <code>{{ vanityStatus()?.claimedFqdn }}</code> on another service.
                  Release it there, or claim the <em>same</em> slug here to move it.
                </p>
              }
              <p class="muted" style="margin-top:8px;font-size:13px">
                Rules: 3–30 chars, lowercase, start with a letter. Names must be unique — already taken is rejected.
                All other services keep random <code>cloudbase####</code> URLs.
              </p>
              <div class="modal-actions" style="margin-top:12px;gap:8px;display:flex;flex-wrap:wrap">
                <button
                  type="button"
                  class="btn btn-primary"
                  (click)="claimVanity()"
                  [disabled]="saving() || !canManage() || vanityClaimBlocked()"
                >
                  {{ saving() ? 'Saving…' : vanityStatus()?.thisServiceHoldsVanity ? 'Update vanity' : 'Claim on this service' }}
                </button>
                @if (vanityStatus()?.thisServiceHoldsVanity) {
                  <button type="button" class="btn btn-ghost" (click)="releaseVanity()" [disabled]="saving() || !canManage()">
                    Release → random URL
                  </button>
                }
              </div>
            </div>

            <div class="field">
              <label>Custom domain</label>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <input
                  style="flex:1;min-width:200px"
                  [(ngModel)]="domainDraft"
                  (ngModelChange)="onDomainDraftChange($event)"
                  placeholder="app.example.com"
                  autocomplete="off"
                />
                <button
                  type="button"
                  class="btn btn-ghost"
                  (click)="checkDomain()"
                  [disabled]="checkingDomain() || !canManage() || !domainDraft.trim()"
                >
                  {{ checkingDomain() ? 'Checking…' : 'Check availability' }}
                </button>
              </div>
              @if (domainCheck(); as check) {
                <p
                  class="muted"
                  style="margin-top:8px;font-size:13px"
                  [style.color]="check.available ? 'var(--ok, #3d9a6a)' : 'var(--danger, #c44)'"
                >
                  {{ check.available ? '✓' : '✗' }} {{ check.reason }}
                  @if (check.domain) {
                    <span> — <code>{{ check.domain }}</code></span>
                  }
                </p>
              }
              <p class="muted" style="margin-top:8px;font-size:13px">
                Point a CNAME (or ALIAS) for this hostname to <code>cloudbase.website</code>, then save.
                Leave empty and save to remove. Use Check before saving a new hostname.
              </p>
            </div>
            @if (service()!.customDomain) {
              <p class="svc-live-url">
                Live custom:
                <a [href]="'https://' + service()!.customDomain" target="_blank" rel="noopener">
                  https://{{ service()!.customDomain }}
                </a>
              </p>
            }
            <div class="modal-actions" style="margin-top:16px;gap:8px;display:flex;flex-wrap:wrap">
              <button
                type="button"
                class="btn btn-primary"
                (click)="saveDomain()"
                [disabled]="saving() || !canManage() || domainSaveBlocked()"
              >
                {{ saving() ? 'Saving…' : domainSaveBlocked() ? 'Check domain first' : 'Save custom domain' }}
              </button>
              @if (service()!.customDomain) {
                <button type="button" class="btn btn-ghost" (click)="clearCustomDomain()" [disabled]="saving() || !canManage()">
                  Remove
                </button>
              }
            </div>
          }

          <div class="net-ports" style="margin-top:24px">
            <h4>Ports</h4>
            @if (service()!.sourceType === 'DATABASE') {
              <div class="port-row"><span>TCP</span><code>{{ serviceContainerPort() }}</code><span class="pill pill-amber">private network</span></div>
              <div class="port-row"><span>Container</span><code>{{ service()!.containerName || ('cb-' + service()!.id) }}</code><span class="pill pill-indigo">internal</span></div>
            } @else {
              <div class="port-row"><span>HTTP</span><code>{{ serviceContainerPort() }} → 443</code><span class="pill pill-green">public</span></div>
              <div class="port-row"><span>Container</span><code>{{ service()!.containerName || ('cb-' + service()!.id) }}</code><span class="pill pill-indigo">internal</span></div>
            }
          </div>
        </section>
      }

      <!-- SETTINGS (Railway-style sidebar) -->
      @if (tab() === 'settings') {
        <section class="panel svc-panel">
          <div class="settings-layout">
            <nav class="settings-nav" aria-label="Settings sections">
              <button type="button" class="settings-nav-item" [class.active]="settingsSection() === 'source'" (click)="settingsSection.set('source')">Source</button>
              @if (service()!.sourceType === 'GITHUB') {
                <button type="button" class="settings-nav-item" [class.active]="settingsSection() === 'build'" (click)="settingsSection.set('build')">Build</button>
                <button type="button" class="settings-nav-item" [class.active]="settingsSection() === 'deploy'" (click)="settingsSection.set('deploy')">Deploy</button>
              }
              <button type="button" class="settings-nav-item" [class.active]="settingsSection() === 'scale'" (click)="settingsSection.set('scale')">Scale</button>
              <button type="button" class="settings-nav-item" [class.active]="settingsSection() === 'danger'" (click)="settingsSection.set('danger')">Danger</button>
            </nav>

            <div class="settings-pane">
              @if (settingsSection() === 'source') {
                <h3>Source</h3>
                <div class="field" style="margin-bottom:14px">
                  <label>Service Name</label>
                  <input [(ngModel)]="nameDraft" />
                </div>

                @if (service()!.sourceType === 'GITHUB') {
                  <div class="field" style="margin-bottom:14px">
                    <label>Runtime / Language</label>
                    <app-runtime-select [value]="runtimeDraft" (valueChange)="onSettingsRuntimeChange($event)" />
                  </div>
                  <div class="field" style="margin-bottom:14px">
                    <label>Start command</label>
                    <input
                      [(ngModel)]="startCommandDraft"
                      (ngModelChange)="startCommandTouched = true"
                      placeholder="java -jar /app/app.jar"
                      autocomplete="off"
                      spellcheck="false"
                      style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px"
                    />
                  </div>
                  <div class="field"><label>Repository URL</label><input [(ngModel)]="sourceDraft.repoUrl" [placeholder]="'https://github.com/' + (auth.githubUsername() || 'user') + '/repo'" /></div>
                  <div class="field"><label>Branch</label><input [(ngModel)]="sourceDraft.branch" /></div>
                  <label class="toggle-field"><input type="checkbox" [(ngModel)]="sourceDraft.autoDeploy" /><span>Auto deploy on push</span></label>
                  <p class="hint" style="margin:8px 0 0;opacity:.75;font-size:13px;line-height:1.4">
                    When enabled: push to GitHub → Actions builds &amp; pushes the image → the live container updates automatically (Watchtower). Webhook redeploy also runs when the public API is reachable.
                  </p>
                  <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                    <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy() || !canManage()" (click)="syncGitHubCi()">
                      {{ busy() ? 'Syncing…' : 'Sync GitHub CI / webhook' }}
                    </button>
                    @if (githubWebhookOk()) {
                      <span class="pill pill-emerald">Webhook ready</span>
                    } @else if (service()!.sourceType === 'GITHUB') {
                      <span class="pill pill-amber">Webhook not registered</span>
                    }
                  </div>
                  @if (githubCiFriendly()) {
                    <div class="pill" [class.pill-emerald]="githubCiOk()" [class.pill-amber]="!githubCiOk()" style="margin-top:12px;display:block;white-space:normal;line-height:1.4">
                      <strong>Build:</strong> {{ githubCiFriendly() }}
                    </div>
                  }
                }

                @if (service()!.sourceType === 'DOCKER') {
                  <div class="field"><label>Image Name</label><input [(ngModel)]="sourceDraft.imageName" (ngModelChange)="onSettingsImageChange($event)" /></div>
                  <div class="field"><label>Image Tag</label><input [(ngModel)]="sourceDraft.imageTag" /></div>
                  <div class="field">
                    <label>Container listen port</label>
                    <input type="number" [(ngModel)]="sourceDraft.containerPort" min="1" max="65535" />
                  </div>
                  <div class="field">
                    <label>Start command <span class="muted">(optional)</span></label>
                    <input
                      [(ngModel)]="startCommandDraft"
                      placeholder="Leave empty for image default"
                      autocomplete="off"
                      spellcheck="false"
                      style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px"
                    />
                  </div>
                }

                @if (service()!.sourceType === 'DATABASE') {
                  <div class="field">
                    <label>Database Type</label>
                    <app-database-type-select
                      [value]="sourceDraft.dbType"
                      [disabled]="true"
                    />
                    <p class="empty-sub" style="margin:6px 0 0">{{ dbPreset(sourceDraft.dbType).hint }}</p>
                    <p class="empty-sub" style="margin:6px 0 0;color:#f59e0b">Locked after create — type and port cannot be changed.</p>
                  </div>
                  <div class="field">
                    <label>Internal port</label>
                    <input type="number" [ngModel]="dbPreset(sourceDraft.dbType).port" disabled />
                  </div>
                }

                <div class="modal-actions" style="margin:16px 0 8px">
                  <button type="button" class="btn btn-primary" (click)="saveIdentity()" [disabled]="saving() || !canManage() || !nameDraft.trim()">
                    {{ saving() ? 'Saving…' : 'Save' }}
                  </button>
                </div>
              }

              @if (settingsSection() === 'build' && service()!.sourceType === 'GITHUB') {
                <h3>Build</h3>
                <div class="field">
                  <label>Root Directory</label>
                  <input [(ngModel)]="sourceDraft.rootDirectory" placeholder="backend (optional — empty = repo root)" />
                  <p class="empty-sub" style="margin:6px 0 0">Docker build context for monorepos.</p>
                </div>
                <div class="field">
                  <label>Build command</label>
                  <input
                    [(ngModel)]="sourceDraft.buildCommand"
                    placeholder="npm run build (optional)"
                    autocomplete="off"
                    spellcheck="false"
                    style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px"
                  />
                </div>
                <div class="modal-actions" style="margin:16px 0 8px">
                  <button type="button" class="btn btn-primary" (click)="saveIdentity()" [disabled]="saving() || !canManage()">
                    {{ saving() ? 'Saving…' : 'Save' }}
                  </button>
                </div>
              }

              @if (settingsSection() === 'deploy' && service()!.sourceType === 'GITHUB') {
                <h3>Deploy</h3>
                <div class="field">
                  <label>Healthcheck path</label>
                  <input [(ngModel)]="sourceDraft.healthcheckPath" placeholder="/health (optional)" />
                </div>
                <div class="field">
                  <label>Restart policy</label>
                  <select [(ngModel)]="sourceDraft.restartPolicy">
                    <option value="unless-stopped">Always restart (unless stopped)</option>
                    <option value="on-failure">On Failure</option>
                  </select>
                </div>
                @if (sourceDraft.restartPolicy === 'on-failure') {
                  <div class="field">
                    <label>Restart retries</label>
                    <input type="number" [(ngModel)]="sourceDraft.restartRetries" min="1" max="50" />
                  </div>
                }
                <div class="modal-actions" style="margin:16px 0 8px">
                  <button type="button" class="btn btn-primary" (click)="saveIdentity()" [disabled]="saving() || !canManage()">
                    {{ saving() ? 'Saving…' : 'Save' }}
                  </button>
                </div>
              }

              @if (settingsSection() === 'scale') {
                <h3>Scale</h3>
                <div class="settings-grid">
                  <div class="field">
                    <label>Memory (MB)</label>
                    <input type="number" [(ngModel)]="quotaDraft.memorymb" min="128" step="128" />
                  </div>
                  <div class="field">
                    <label>CPU (milli)</label>
                    <input type="number" [(ngModel)]="quotaDraft.cpuMilli" min="100" step="100" />
                  </div>
                  <div class="field">
                    <label>Storage (GB)</label>
                    <input type="number" [(ngModel)]="quotaDraft.storageGb" min="1" step="1" />
                  </div>
                </div>
                <label class="toggle-field" style="margin:14px 0">
                  <input type="checkbox" [(ngModel)]="useVolume" />
                  <span>Attach persistent volume</span>
                </label>
                @if (useVolume) {
                  <div class="settings-grid">
                    <div class="field">
                      <label>Mount Path</label>
                      <input [(ngModel)]="volumePath" placeholder="/data" />
                    </div>
                    <div class="field">
                      <label>Volume Size (GB)</label>
                      <input type="number" [(ngModel)]="volumeSize" min="1" />
                    </div>
                  </div>
                }
                <div class="modal-actions" style="margin-top:16px">
                  <button type="button" class="btn btn-primary" (click)="saveSettings()" [disabled]="saving() || !canManage()">
                    {{ saving() ? 'Saving…' : 'Save' }}
                  </button>
                </div>
              }

              @if (settingsSection() === 'danger') {
                <div class="danger-zone" style="margin-top:0">
                  <h4>Danger zone</h4>
                  <p class="muted">Deleting removes the Portainer stack/containers and NPM proxy — CloudBase verifies both are gone before erasing the DB row. Type the service name to confirm.</p>
                  <button type="button" class="btn btn-danger-soft" (click)="openDeleteService()" [disabled]="!canManage()">
                    Delete Service
                  </button>
                </div>
              }
            </div>
          </div>
        </section>
      }
    }
  </div>
</div>

@if (deleteTarget(); as svc) {
  <app-confirm-delete-dialog
    title="Delete service"
    [confirmName]="svc.name"
    [busy]="deleting()"
    [error]="deleteError()"
    confirmLabel="Delete service permanently"
    warning="Removes Portainer stack + containers (verified gone), NPM proxy (verified gone), volumes, and history. If Portainer or NPM do not confirm, nothing is deleted in CloudBase."
    (cancel)="closeDeleteDialog()"
    (confirm)="executeDeleteService()"
  />
}
  `
})
export class ServiceDetailPageComponent implements OnInit, OnDestroy, AfterViewChecked {
  readonly auth = inject(AuthService);
  private readonly projectService = inject(ProjectService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  @ViewChild('termInput') termInput?: ElementRef<HTMLInputElement>;
  @ViewChild('termBox') termBox?: ElementRef<HTMLDivElement>;
  @ViewChild('logsBox') logsBox?: ElementRef<HTMLDivElement>;

  readonly tabs: Array<{ id: ServiceTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'deployments', label: 'Deployments' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'logs', label: 'Logs' },
    { id: 'terminal', label: 'Console' },
    { id: 'variables', label: 'Variables' },
    { id: 'network', label: 'Network' },
    { id: 'settings', label: 'Settings' }
  ];

  readonly liveMetrics = signal<Record<string, unknown> | null>(null);
  readonly metricsRanges: MetricsRange[] = ['1h', '6h', '1d', '7d', '30d'];
  readonly metricsRange = signal<MetricsRange>('1h');
  readonly cpuSeries = signal<MetricSeries>({
    label: 'CPU', points: '', area: '', maxLabel: '0%', currentLabel: '0%', ticks: ['', '', '']
  });
  readonly memSeries = signal<MetricSeries>({
    label: 'Memory', points: '', area: '', maxLabel: '0 MB', currentLabel: '0 MB', ticks: ['', '', '']
  });
  private metricHistory: MetricSample[] = [];
  private metricsPollTimer: ReturnType<typeof setInterval> | null = null;

  readonly project = signal<Project | null>(null);
  readonly service = signal<Service | null>(null);
  readonly deployments = signal<Deployment[]>([]);
  readonly logs = signal<ServiceLogLine[]>([]);
  readonly termLines = signal<TerminalLine[]>([]);
  readonly loading = signal(true);
  readonly rollbackTarget = signal<Deployment | null>(null);
  readonly rollbackBusy = signal(false);
  readonly busy = signal(false);
  readonly saving = signal(false);
  readonly deleteTarget = signal<Service | null>(null);
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);
  readonly checkingDomain = signal(false);
  readonly domainCheck = signal<{ domain: string; available: boolean; reason: string } | null>(null);
  readonly checkingVanity = signal(false);
  readonly vanityCheck = signal<{ domain: string; available: boolean; reason: string } | null>(null);
  readonly vanityStatus = signal<{
    baseDomain: string;
    limitPerAccount: number;
    claimedSlug?: string | null;
    claimedFqdn?: string | null;
    claimedServiceId?: string | null;
    thisServiceHoldsVanity: boolean;
  } | null>(null);
  readonly termBusy = signal(false);
  readonly tab = signal<ServiceTab>('overview');
  readonly settingsSection = signal<'source' | 'build' | 'deploy' | 'scale' | 'danger'>('source');
  readonly message = signal('');
  readonly messageTone = signal<'ok' | 'error'>('ok');
  readonly dbConn = signal<Record<string, string> | null>(null);

  envDraft: EnvironmentVariable[] = [];
  showSecrets: boolean[] = [];
  readonly varsDirty = signal(false);
  readonly refPickerOpen = signal(false);
  readonly refInsertIndex = signal(0);
  readonly refPlaceholder = 'value or ${{Service.KEY}}';
  readonly metricsLoading = signal(false);
  domainDraft = '';
  vanityDraft = '';
  private domainCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private domainCheckSeq = 0;
  private vanityCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private vanityCheckSeq = 0;
  readonly deployTimelineSteps = computed(() => {
    const type = this.service()?.sourceType;
    if (type === 'DOCKER' || type === 'DATABASE') {
      return ['Queued', 'Starting', 'Success'] as const;
    }
    return ['Queued', 'Building', 'Deploying', 'Verify', 'Success'] as const;
  });
  private metricsLoadTimer: ReturnType<typeof setTimeout> | null = null;
  private deployPollTimers: Array<ReturnType<typeof setTimeout>> = [];
  quotaDraft = { memorymb: 512, cpuMilli: 500, storageGb: 2 };
  useVolume = false;
  volumePath = '/data';
  volumeSize = 2;
  nameDraft = '';
  runtimeDraft: ServiceRuntime = 'node';
  startCommandDraft = '';
  startCommandTouched = false;
  sourceDraft = {
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
    dbType: 'POSTGRESQL' as DatabaseType
  };
  readonly dbTypes: DatabaseType[] = ['POSTGRESQL', 'MYSQL', 'REDIS', 'MONGODB'];
  logFilter = 'all';
  readonly logFilterOptions: StyledSelectOption[] = [
    { label: 'All levels', value: 'all', icon: 'pi pi-list' },
    { label: 'Info', value: 'info', icon: 'pi pi-info-circle' },
    { label: 'Warn', value: 'warn', icon: 'pi pi-exclamation-triangle' },
    { label: 'Error', value: 'error', icon: 'pi pi-times-circle' },
    { label: 'Debug', value: 'debug', icon: 'pi pi-code' }
  ];
  liveLogs = false;
  termCmd = '';
  private termHistory: string[] = [];
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private shouldScrollTerm = false;
  private shouldScrollLogs = false;
  projectId = '';
  private serviceId = '';
  readonly usage = signal<UsageSummary | null>(null);
  readonly plan = signal<PlanInfo | null>(null);

  ngOnInit() {
    this.projectId = this.route.snapshot.paramMap.get('projectId')!;
    this.serviceId = this.route.snapshot.paramMap.get('serviceId')!;
    const tabParam = this.route.snapshot.queryParamMap.get('tab') as ServiceTab | null;
    if (tabParam && this.tabs.some(t => t.id === tabParam)) this.tab.set(tabParam);
    this.auth.usage().subscribe({ next: u => this.usage.set(u) });
    this.auth.getPlan().subscribe({ next: p => this.plan.set(p) });
    this.load();
    if (this.tab() === 'metrics') this.startMetricsPoll();
  }

  ngOnDestroy() {
    this.stopLiveLogs();
    this.clearDeployPolls();
    this.stopMetricsPoll();
    if (this.metricsLoadTimer) clearTimeout(this.metricsLoadTimer);
    if (this.domainCheckTimer) clearTimeout(this.domainCheckTimer);
    if (this.vanityCheckTimer) clearTimeout(this.vanityCheckTimer);
  }

  ngAfterViewChecked() {
    if (this.shouldScrollTerm && this.termBox) {
      this.termBox.nativeElement.scrollTop = this.termBox.nativeElement.scrollHeight;
      this.shouldScrollTerm = false;
    }
    if (this.shouldScrollLogs && this.logsBox) {
      this.logsBox.nativeElement.scrollTop = this.logsBox.nativeElement.scrollHeight;
      this.shouldScrollLogs = false;
    }
  }

  load() {
    this.loading.set(true);
    this.projectService.getService(this.projectId, this.serviceId).subscribe({
      next: ({ project, service }) => {
        this.project.set(project);
        this.applyService(service);
        this.loading.set(false);
        this.loadDeployments();
        this.refreshLogs();
        this.bootTerminal();
        this.loadVanityStatus();
        if (service.sourceType === 'DATABASE') {
          this.projectService.dbConnection(service.id).subscribe({
            next: info => this.dbConn.set(info),
            error: () => this.dbConn.set(null)
          });
        }
      },
      error: e => {
        this.message.set(friendlyApiMessage(e, 'Failed to load service'));
        this.messageTone.set('error');
        this.loading.set(false);
      }
    });
  }

  private applyService(service: Service) {
    this.service.set(service);
    this.envDraft = service.envVars.map(e => ({ ...e }));
    this.showSecrets = this.envDraft.map(() => false);
    this.varsDirty.set(false);
    this.refPickerOpen.set(false);
    this.domainDraft = service.customDomain ?? '';
    this.domainCheck.set(null);
    this.vanityCheck.set(null);
    this.quotaDraft = { ...service.quota };
    this.useVolume = !!service.volume;
    this.volumePath = service.volume?.mountPath ?? '/data';
    this.volumeSize = service.volume?.sizeGb ?? 2;
    this.nameDraft = service.name;
    this.runtimeDraft = service.runtime ?? 'node';
    const d0 = service.sourceDetails as unknown as Record<string, unknown>;
    this.startCommandDraft = String(d0['startCommand'] ?? defaultStartCommand(this.runtimeDraft));
    this.startCommandTouched = !!d0['startCommand'];
    const d = service.sourceDetails as unknown as Record<string, unknown>;
    this.sourceDraft = {
      repoUrl: String(d['repositoryUrl'] ?? ''),
      branch: String(d['branch'] ?? 'main'),
      rootDirectory: String(d['rootDirectory'] ?? ''),
      buildCommand: String(d['buildCommand'] ?? ''),
      healthcheckPath: String(d['healthcheckPath'] ?? ''),
      restartPolicy: (d['restartPolicy'] === 'on-failure' ? 'on-failure' : 'unless-stopped') as 'unless-stopped' | 'on-failure',
      restartRetries: Number(d['restartRetries'] ?? 10) || 10,
      autoDeploy: d['autoDeploy'] !== false,
      imageName: dockerImageParts(d).imageName,
      imageTag: dockerImageParts(d).imageTag,
      containerPort: Number(d['containerPort'] ?? service.containerPort ?? guessContainerPort(dockerImageParts(d).imageName)) || 80,
      dbType: (d['dbType'] as DatabaseType) ?? 'POSTGRESQL'
    };
    this.refreshLiveMetrics();
  }

  dbPreset(dbType: DatabaseType) {
    return DB_PRESETS[dbType];
  }

  serviceContainerPort(): number {
    const svc = this.service();
    if (!svc) return 8080;
    if (svc.containerPort && svc.containerPort > 0) return svc.containerPort;
    const d = svc.sourceDetails as unknown as Record<string, unknown>;
    if (d['containerPort'] != null) return Number(d['containerPort']);
    if (svc.sourceType === 'DATABASE') {
      return DB_PRESETS[(d['dbType'] as DatabaseType) ?? 'POSTGRESQL'].port;
    }
    return guessContainerPort(String(d['imageName'] ?? ''));
  }

  onSettingsImageChange(value: string) {
    this.sourceDraft.containerPort = guessContainerPort(value);
  }

  onSettingsDbTypeChange(dbType: DatabaseType) {
    this.sourceDraft.dbType = dbType;
    if (this.useVolume) {
      this.volumePath = DB_PRESETS[dbType].mountPath;
    }
  }

  inheritedVars(): SharedVariable[] {
    const project = this.project();
    const svc = this.service();
    if (!project || !svc) return [];
    return (project.sharedVariables ?? []).filter(v => v.serviceIds.includes(svc.id));
  }

  varsSyncLabel(): string {
    if (this.varsDirty()) return 'Unsaved changes';
    if (this.service()?.envPendingDeploy) return 'Pending deploy';
    return 'Live';
  }

  varsSyncTone(): string {
    if (this.varsDirty()) return 'sync-unsaved';
    if (this.service()?.envPendingDeploy) return 'sync-pending';
    return 'sync-live';
  }

  markVarsDirty() {
    this.varsDirty.set(true);
  }

  toggleRefPicker() {
    this.refPickerOpen.update(v => !v);
  }

  referenceOptions(): Array<{ value: string; hint: string }> {
    const project = this.project();
    const current = this.service();
    if (!project || !current) return [];
    const opts: Array<{ value: string; hint: string }> = [];

    for (const v of project.sharedVariables ?? []) {
      opts.push({
        value: `\${{Project.${v.key}}}`,
        hint: v.isSecret ? 'Shared secret' : 'Shared variable'
      });
    }

    for (const svc of project.services ?? []) {
      if (svc.id === current.id) continue;
      for (const env of svc.envVars ?? []) {
        if (!env.key) continue;
        opts.push({
          value: `\${{${svc.name}.${env.key}}}`,
          hint: `${svc.name} · ${svc.sourceType}`
        });
      }
    }
    return opts;
  }

  insertReference(template: string) {
    if (!this.envDraft.length) {
      this.addVar();
    }
    let idx = this.refInsertIndex();
    if (idx < 0 || idx >= this.envDraft.length) idx = this.envDraft.length - 1;
    const row = this.envDraft[idx];
    row.value = row.value ? `${row.value}${template}` : template;
    this.markVarsDirty();
    this.refPickerOpen.set(false);
  }

  loadDeployments() {
    this.projectService.getDeployments(this.serviceId).subscribe({
      next: deps => this.deployments.set(deps),
      error: () => this.deployments.set([])
    });
  }

  activeDeploy(): Deployment | undefined {
    return this.deployments().find(d => this.isInFlightDeploy(d));
  }

  /** True only while a deploy is actually running — not finished/stale orphan rows. */
  isInFlightDeploy(d: Deployment): boolean {
    if (d.status !== 'QUEUED' && d.status !== 'DEPLOYING' && d.status !== 'BUILDING') return false;
    if (d.finishedAt) return false;

    // Ignore orphans older than 20 minutes (backend sweeper also fails these).
    const started = d.startedAt ? Date.parse(d.startedAt) : NaN;
    if (Number.isFinite(started) && Date.now() - started > 20 * 60 * 1000) {
      return false;
    }

    // If a newer finished deploy exists, an older in-flight row is orphaned.
    const newerFinished = this.deployments().some(other => {
      if (other.id === d.id) return false;
      const otherStart = other.startedAt ? Date.parse(other.startedAt) : 0;
      const thisStart = Number.isFinite(started) ? started : 0;
      const finished = other.status === 'SUCCESS'
        || other.status === 'FAILED'
        || other.status === 'CANCELLED';
      return finished && otherStart > thisStart;
    });
    if (newerFinished) return false;

    if (d.status === 'BUILDING') {
      const logs = (d.logs || '').toLowerCase();
      // Legacy rows left as BUILDING after image/GitHub gate failed
      if (logs.includes('could not start') || logs.includes('connect github')) return false;
    }
    return true;
  }

  showDeployProgress(d: Deployment): boolean {
    if (this.isInFlightDeploy(d)) return true;
    return d.status === 'FAILED' && this.deployments()[0]?.id === d.id;
  }

  stageLabel(d: Deployment): string {
    const github = this.service()?.sourceType === 'GITHUB';
    const stage = d.stage || '';
    if (d.status === 'FAILED') {
      if (stage === 'building') {
        return github
          ? 'Failed during build (GitHub Actions / Docker image check)'
          : 'Failed while preparing the stack';
      }
      if (stage === 'deploying') return 'Failed while starting the container (Portainer)';
      if (stage === 'verify') return 'Failed while checking the public URL';
      if (stage === 'queued') return 'Failed before deploy started';
      return 'Deploy failed — see logs below';
    }
    switch (stage) {
      case 'queued': return 'Stage: Queued';
      case 'building':
        return github ? 'Stage: Building image (GitHub Actions / Docker Hub)' : 'Stage: Preparing stack';
      case 'deploying': return 'Stage: Deploying on Portainer';
      case 'verify': return 'Stage: Verifying public URL';
      case 'success': return 'Stage: Success';
      default:
        if (d.status === 'BUILDING') return 'Stage: Building…';
        if (d.status === 'DEPLOYING') return 'Stage: Deploying…';
        if (d.status === 'QUEUED') return 'Stage: Queued…';
        return '';
    }
  }

  deployStepIndex(d: Deployment | string): number {
    const steps = this.deployTimelineSteps().length;
    const status = typeof d === 'string' ? d : d.status;
    const stage = typeof d === 'string' ? undefined : d.stage;
    let idx = this.stepFromStage(stage, status, steps);
    if (status === 'FAILED') {
      idx = Math.min(idx, Math.max(0, steps - 2));
    }
    return idx;
  }

  private stepFromStage(stage: string | undefined, status: string, steps: number): number {
    if (steps === 3) {
      if (status === 'SUCCESS' || status === 'RUNNING' || stage === 'success') return 2;
      if (status === 'QUEUED' || status === 'PENDING' || stage === 'queued') return 0;
      return 1;
    }
    switch (stage) {
      case 'queued': return 0;
      case 'building': return 1;
      case 'deploying': return 2;
      case 'verify': return Math.min(3, steps - 2);
      case 'success': return steps - 1;
      default:
        break;
    }
    switch (status) {
      case 'QUEUED':
      case 'PENDING':
        return 0;
      case 'BUILDING':
        return 1;
      case 'DEPLOYING':
        return Math.min(2, steps - 2);
      case 'SUCCESS':
      case 'RUNNING':
        return steps - 1;
      default:
        return 0;
    }
  }

  deployProgressPct(d: Deployment | string): number {
    const steps = this.deployTimelineSteps().length;
    const idx = this.deployStepIndex(d);
    if (steps === 3) return [22, 65, 100][idx] ?? 22;
    if (steps === 5) return [12, 32, 52, 74, 100][idx] ?? 12;
    return [18, 42, 72, 100][idx] ?? 18;
  }

  showDeployChrome(): boolean {
    return !!this.activeDeploy() || this.busy();
  }

  /** One short line under the title — no duplicate timeline in the header. */
  headerStatusLine(): string {
    const active = this.activeDeploy();
    if (active) {
      const label = this.stageLabel(active);
      return label || 'Deploy in progress… Check Deployments for the current stage.';
    }
    const latest = this.deployments()[0];
    if (latest?.status === 'FAILED') {
      return this.stageLabel(latest);
    }
    const hint = this.statusHint();
    if (hint) return hint;
    return '';
  }

  headerDeployStep(): number {
    const active = this.activeDeploy();
    if (active) return this.deployStepIndex(active.status);
    return this.deployStepIndex(this.service()?.status ?? 'PENDING');
  }

  headerDeployProgress(): number {
    const active = this.activeDeploy();
    if (active) return this.deployProgressPct(active.status);
    return this.deployProgressPct(this.service()?.status ?? 'PENDING');
  }

  clearMessage() {
    this.message.set('');
  }

  isActiveDeploy(d: Deployment): boolean {
    return this.isInFlightDeploy(d);
  }

  isLiveDeploy(d: Deployment): boolean {
    return d.status === 'SUCCESS' && d.id === this.service()?.latestDeploymentId;
  }

  canRollback(d: Deployment): boolean {
    return this.canManage() && d.status === 'SUCCESS' && !this.isLiveDeploy(d) && !this.activeDeploy();
  }

  openRollback(d: Deployment) {
    if (!this.canRollback(d)) return;
    this.rollbackTarget.set(d);
  }

  closeRollback() {
    if (this.rollbackBusy()) return;
    this.rollbackTarget.set(null);
  }

  onRollbackBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) this.closeRollback();
  }

  onRollback(deploymentId: string) {
    if (!this.canManage() || this.rollbackBusy()) return;
    this.rollbackBusy.set(true);
    this.projectService.rollback(this.serviceId, deploymentId).subscribe({
      next: () => {
        this.rollbackTarget.set(null);
        this.rollbackBusy.set(false);
        this.busy.set(true);
        this.service.update(s => s ? { ...s, status: 'DEPLOYING' } : s);
        this.setTab('deployments');
        this.message.set('Rollback started');
        this.messageTone.set('ok');
        this.loadDeployments();
        const poll = setInterval(() => this.loadDeployments(), 500);
        setTimeout(() => {
          clearInterval(poll);
          this.projectService.getService(this.projectId, this.serviceId).subscribe({
            next: ({ service }) => {
              this.applyService(service);
              this.loadDeployments();
              this.busy.set(false);
              this.message.set('Rollback complete');
            },
            error: () => this.busy.set(false)
          });
        }, 2000);
      },
      error: e => {
        this.rollbackBusy.set(false);
        this.message.set(friendlyApiMessage(e, 'Rollback failed'));
        this.messageTone.set('error');
      }
    });
  }

  setTab(id: ServiceTab) {
    this.tab.set(id);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: id },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    if (id === 'logs') this.shouldScrollLogs = true;
    if (id === 'terminal') {
      setTimeout(() => this.focusTerm(), 50);
      this.shouldScrollTerm = true;
    }
    if (id === 'metrics') {
      this.refreshLiveMetrics();
      this.startMetricsPoll();
    } else {
      this.stopMetricsPoll();
      // Overview: one light snapshot only when we have nothing yet
      if (id === 'overview' && !this.liveMetrics()?.['available']) {
        this.refreshLiveMetrics();
      }
    }
    if (id === 'network') this.loadVanityStatus();
  }

  setMetricsRange(range: MetricsRange) {
    this.metricsRange.set(range);
    this.refreshLiveMetrics();
  }

  refreshLiveMetrics() {
    const svc = this.service();
    if (!svc) return;
    this.metricsLoading.set(true);
    this.projectService.getMetrics(svc.id, this.metricsRange()).subscribe({
      next: m => {
        this.liveMetrics.set(m);
        if (m['available']) {
          const cpu = Number(m['cpuPercent'] ?? 0);
          const mem = Number(m['memoryUsageMb'] ?? 0);
          const memPct = Number(m['memoryPercent'] ?? 0);
          this.service.update(s => s ? { ...s, cpuUsage: cpu, ramUsageMb: Math.round(mem) } : s);
        }
        const history = Array.isArray(m['history']) ? (m['history'] as Array<Record<string, unknown>>) : [];
        if (history.length) {
          this.metricHistory = history.map(h => ({
            t: Number(h['t'] ?? Date.now()),
            cpu: Number(h['cpuPercent'] ?? 0),
            memMb: Number(h['memoryUsageMb'] ?? 0),
            memPct: Number(h['memoryPercent'] ?? 0)
          }));
        } else if (m['available']) {
          this.pushMetricSample({
            t: Date.now(),
            cpu: Number(m['cpuPercent'] ?? 0),
            memMb: Number(m['memoryUsageMb'] ?? 0),
            memPct: Number(m['memoryPercent'] ?? 0)
          });
        }
        this.rebuildMetricCharts();
        this.metricsLoading.set(false);
      },
      error: () => {
        this.liveMetrics.set({ available: false, error: 'Could not load metrics' });
        this.metricsLoading.set(false);
      }
    });
  }

  private startMetricsPoll() {
    this.stopMetricsPoll();
    this.refreshLiveMetrics();
    this.metricsPollTimer = setInterval(() => {
      if (this.tab() === 'metrics') this.refreshLiveMetrics();
    }, 15000);
  }

  private stopMetricsPoll() {
    if (this.metricsPollTimer) {
      clearInterval(this.metricsPollTimer);
      this.metricsPollTimer = null;
    }
  }

  private pushMetricSample(sample: MetricSample) {
    this.metricHistory.push(sample);
    const maxKeep = 500;
    if (this.metricHistory.length > maxKeep) {
      this.metricHistory = this.metricHistory.slice(-maxKeep);
    }
    this.rebuildMetricCharts();
  }

  private rebuildMetricCharts() {
    const windowMs =
      this.metricsRange() === '1h' ? 3600_000 :
      this.metricsRange() === '6h' ? 6 * 3600_000 :
      this.metricsRange() === '1d' ? 24 * 3600_000 :
      this.metricsRange() === '7d' ? 7 * 24 * 3600_000 :
      30 * 24 * 3600_000;
    const cutoff = Date.now() - windowMs;
    let samples = this.metricHistory.filter(s => s.t >= cutoff);
    if (samples.length === 0 && this.liveMetrics()?.['available']) {
      const cpu = Number(this.liveMetrics()!['cpuPercent'] ?? 0);
      const mem = Number(this.liveMetrics()!['memoryUsageMb'] ?? 0);
      const memPct = Number(this.liveMetrics()!['memoryPercent'] ?? 0);
      samples = [{ t: Date.now(), cpu, memMb: mem, memPct }];
    }
    // Need at least 2 points for a visible area; pad with flat history if first sample
    if (samples.length === 1) {
      samples = [
        { ...samples[0], t: samples[0].t - 60_000 },
        samples[0]
      ];
    }
    this.cpuSeries.set(this.buildSeries(
      samples.map(s => s.cpu),
      samples.map(s => s.t),
      v => `${v.toFixed(1)}%`,
      Math.max(100, ...samples.map(s => s.cpu), 1)
    ));
    const memLimit = Number(this.liveMetrics()?.['memoryLimitMb'] ?? this.service()?.quota.memorymb ?? 512);
    this.memSeries.set(this.buildSeries(
      samples.map(s => s.memMb),
      samples.map(s => s.t),
      v => `${Math.round(v)} MB`,
      Math.max(memLimit, ...samples.map(s => s.memMb), 1)
    ));
  }

  private buildSeries(
    values: number[],
    times: number[],
    format: (v: number) => string,
    scaleMax: number
  ): MetricSeries {
    const w = 360;
    const h = 140;
    const pad = 6;
    const n = Math.max(values.length, 1);
    const pts: string[] = [];
    const areaPts: string[] = [`${pad},${h - pad}`];
    for (let i = 0; i < n; i++) {
      const x = pad + (i / Math.max(n - 1, 1)) * (w - pad * 2);
      const y = h - pad - (Math.min(values[i], scaleMax) / scaleMax) * (h - pad * 2);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      areaPts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    areaPts.push(`${w - pad},${h - pad}`);
    const current = values[values.length - 1] ?? 0;
    const peak = Math.max(...values, 0);
    const ticks = [
      this.formatTick(times[0] ?? Date.now()),
      this.formatTick(times[Math.floor((times.length - 1) / 2)] ?? Date.now()),
      this.formatTick(times[times.length - 1] ?? Date.now())
    ];
    return {
      label: '',
      points: pts.join(' '),
      area: `M ${areaPts.join(' L ')} Z`,
      maxLabel: format(peak),
      currentLabel: format(current),
      ticks
    };
  }

  private formatTick(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  metricBarPct(value: unknown): number {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(100, n);
  }

  goBack() {
    this.router.navigate(['/projects', this.projectId]);
  }

  canManage(): boolean {
    return this.auth.hasDeployAccess();
  }

  canDeployNow(): boolean {
    if (!this.canManage()) return false;
    if (this.busy() || !!this.activeDeploy()) return false;
    const u = this.usage();
    const p = this.plan();
    if (u && p) return this.auth.canStartDeploy(u, p);
    return true;
  }

  sourceIcon(type?: ServiceSourceType): string {
    return ({ GITHUB: '⊙', DOCKER: '◈', DATABASE: '◉' } as Record<string, string>)[type ?? ''] ?? '◌';
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

  sourceSummary(): string {
    const svc = this.service();
    if (!svc) return '';
    const d = svc.sourceDetails as unknown as Record<string, unknown>;
    if (svc.sourceType === 'GITHUB') return `${d['repositoryUrl']} @ ${d['branch']}`;
    if (svc.sourceType === 'DOCKER') return formatDockerImage(d) || 'Docker image';
    return String(d['dbType'] ?? 'DATABASE');
  }

  githubCiMessage(): string {
    const d = this.service()?.sourceDetails as unknown as Record<string, unknown> | undefined;
    return d?.['ciMessage'] ? String(d['ciMessage']) : '';
  }

  githubCiFriendly(): string {
    return this.softenTech(this.githubCiMessage());
  }

  githubCiOk(): boolean {
    const d = this.service()?.sourceDetails as unknown as Record<string, unknown> | undefined;
    return d?.['ciBootstrapped'] === true;
  }

  githubWebhookOk(): boolean {
    const d = this.service()?.sourceDetails as unknown as Record<string, unknown> | undefined;
    return d?.['ciWebhookRegistered'] === true;
  }

  syncGitHubCi() {
    if (!this.canManage() || this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    this.projectService.syncGitHubCi(this.serviceId).subscribe({
      next: svc => {
        this.applyService(svc);
        this.busy.set(false);
        const d = svc.sourceDetails as unknown as Record<string, unknown>;
        const ok = d?.['ciWebhookRegistered'] === true;
        this.message.set(ok
          ? 'GitHub webhook ready — push to the repo to auto-redeploy.'
          : String(d?.['ciMessage'] ?? 'CI sync finished. Check Build status below.'));
        this.messageTone.set(ok ? 'ok' : 'error');
      },
      error: err => {
        this.busy.set(false);
        this.message.set(friendlyApiMessage(err, 'Could not sync GitHub CI'));
        this.messageTone.set('error');
      }
    });
  }

  statusLabel(status: string | undefined): string {
    switch (status) {
      case 'RUNNING': return 'Healthy';
      case 'BUILDING': return 'Building';
      case 'DEPLOYING': return 'Starting';
      case 'QUEUED': return 'Queued';
      case 'PENDING': return 'Ready to deploy';
      case 'STOPPED': return 'Stopped';
      case 'FAILED': return 'Failed';
      case 'SUCCESS': return 'Success';
      case 'CANCELLED': return 'Cancelled';
      default: return status || 'Unknown';
    }
  }

  deployStatusLabel(d: Deployment): string {
    if (d.status === 'BUILDING' && !this.isInFlightDeploy(d)) return 'Needs build';
    return this.statusLabel(d.status);
  }

  deployStatusClass(d: Deployment): string {
    if (d.status === 'BUILDING' && !this.isInFlightDeploy(d)) return 'failed';
    return d.status.toLowerCase();
  }

  statusHint(): string {
    const fb = this.statusFeedback();
    return fb?.body ?? '';
  }

  /** Friendly overview card when the service needs attention or is mid-flight. */
  statusFeedback(): {
    tone: 'info' | 'wait' | 'warn' | 'error';
    icon: string;
    title: string;
    body: string;
    detail?: string;
    primary?: 'redeploy' | 'account';
    primaryLabel: string;
    secondary?: 'logs' | 'deployments';
  } | null {
    const svc = this.service();
    if (!svc || svc.status === 'RUNNING') return null;

    const needsGitHub =
      svc.sourceType === 'GITHUB' &&
      (!this.auth.isGitHubConnected() || !this.githubCiOk() || /connect github/i.test(this.githubCiMessage()));

    const latest = this.deployments()[0];
    const rawLog = latest?.logs || this.githubCiMessage();

    if (svc.status === 'BUILDING') {
      if (needsGitHub) {
        return {
          tone: 'warn',
          icon: '◎',
          title: 'Almost there — link GitHub to build',
          body: 'Your app image is not ready yet. Connect GitHub so CloudBase can build it automatically, then Redeploy.',
          detail: this.softenTech(rawLog),
          primary: 'account',
          primaryLabel: 'Connect GitHub',
          secondary: 'deployments'
        };
      }
      return {
        tone: 'wait',
        icon: '◌',
        title: 'Building your image',
        body: 'GitHub Actions is preparing the Docker image. This usually takes 1–3 minutes. Stay here — no need to open GitHub.',
        detail: this.softenTech(rawLog),
        primary: 'redeploy',
        primaryLabel: 'Check again / Redeploy',
        secondary: 'deployments'
      };
    }

    if (svc.status === 'DEPLOYING' || svc.status === 'PENDING') {
      return {
        tone: 'wait',
        icon: '◌',
        title: svc.status === 'PENDING' ? 'Ready when you are' : 'Starting your service',
        body: svc.status === 'PENDING'
          ? 'Click Deploy to pull or build the image and start the container.'
          : 'CloudBase is creating the container and wiring the network. Almost done.',
        primary: 'redeploy',
        primaryLabel: svc.status === 'PENDING' ? 'Deploy now' : 'Redeploy',
        secondary: 'deployments'
      };
    }

    if (svc.status === 'FAILED') {
      return {
        tone: 'error',
        icon: '!',
        title: 'Deploy didn’t finish',
        body: 'Something went wrong starting this service. Fix the issue, then Redeploy.',
        detail: this.softenTech(rawLog),
        primary: 'redeploy',
        primaryLabel: 'Try Redeploy',
        secondary: 'logs'
      };
    }

    if (svc.status === 'STOPPED') {
      return {
        tone: 'info',
        icon: '■',
        title: 'Service is stopped',
        body: 'Nothing is running right now. Deploy again when you want it online.',
        primary: 'redeploy',
        primaryLabel: 'Deploy',
        secondary: 'deployments'
      };
    }

    return null;
  }

  deployFriendlyLog(d: { logs?: string; status?: string; errorMessage?: string } | null | undefined): string {
    if (!d) return '';
    const err = (d.errorMessage || '').trim();
    const raw = (d.logs || '').trim();
    const source = raw || (err ? `Deployment failed: ${err}` : '');
    if (source) {
      const lines = source.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      return lines.slice(-80).join('\n');
    }
    if (d.status === 'BUILDING') return 'Waiting for the image build to finish…';
    if (d.status === 'DEPLOYING') return 'Starting container…';
    if (d.status === 'QUEUED') return 'Waiting in queue…';
    return '';
  }

  private softenTech(raw: string | undefined): string {
    if (!raw?.trim()) return '';
    let t = raw
      .replace(/\bHTTP\s*\d{3}\b/gi, '')
      .replace(/\bcb-svc-[a-z0-9]+\b/gi, '')
      .replace(/\bminipcer\/[^\s,]+/gi, 'your image')
      .replace(/Failed to write \.github\/workflows\/[^\s]+/gi, 'Could not set up the build workflow')
      .replace(/Connect GitHub on Account once, then Redeploy\.?/gi, 'Connect GitHub on Account, then Redeploy.')
      .replace(/Image not ready and build could not start\.?/gi, 'Image is not ready yet.')
      .replace(/Setup failed:\s*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (t.length > 180) t = t.slice(0, 177) + '…';
    return t;
  }

  githubImageName(): string {
    const d = this.service()?.sourceDetails as unknown as Record<string, unknown> | undefined;
    return d?.['imageName'] ? String(d['imageName']) : '';
  }

  liveCpuLabel(): string {
    const m = this.liveMetrics();
    if (!m?.['available']) return '—';
    return `${Number(m['cpuPercent'] ?? 0).toFixed(1)}%`;
  }

  liveRamLabel(): string {
    const m = this.liveMetrics();
    if (!m?.['available']) return '—';
    return `${Math.round(Number(m['memoryUsageMb'] ?? 0))} MB`;
  }

  cpuPct(): number {
    const m = this.liveMetrics();
    if (!m?.['available']) return 0;
    const s = this.service();
    if (!s) return 0;
    const cpu = Number(m['cpuPercent'] ?? 0);
    return Math.min(100, (cpu / Math.max(1, s.quota.cpuMilli / 10)) * 100);
  }

  ramPct(): number {
    const m = this.liveMetrics();
    if (!m?.['available']) return 0;
    const s = this.service();
    if (!s) return 0;
    const mem = Number(m['memoryUsageMb'] ?? 0);
    return Math.min(100, (mem / Math.max(1, s.quota.memorymb)) * 100);
  }

  /** Allocated disk for this service (volume size wins over quota). */
  storageAllocatedGb(): number {
    const s = this.service();
    if (!s) return 0;
    if (s.volume?.sizeGb && s.volume.sizeGb > 0) return s.volume.sizeGb;
    return s.quota.storageGb || 0;
  }

  /**
   * Storage meter: we don't have live disk fill yet — show a soft marker
   * (allocated relative to quota), never a fake 100% "full disk".
   */
  storagePct(): number {
    const s = this.service();
    if (!s) return 0;
    const allocated = this.storageAllocatedGb();
    if (allocated <= 0) return 0;
    const quota = Math.max(1, s.quota.storageGb || allocated);
    return Math.min(100, Math.round((allocated / quota) * 40)); // soft fill, not alarming
  }

  filteredLogs(): ServiceLogLine[] {
    const f = this.logFilter;
    if (f === 'all') return this.logs();
    return this.logs().filter(l => l.level === f);
  }

  refreshLogs() {
    this.projectService.getLogs(this.serviceId).subscribe({
      next: lines => {
        this.logs.set(lines);
        this.shouldScrollLogs = true;
      }
    });
  }

  clearLogsView() {
    this.logs.set([]);
  }

  toggleLiveLogs(on: boolean) {
    if (on) this.startLiveLogs();
    else this.stopLiveLogs();
  }

  private startLiveLogs() {
    this.stopLiveLogs();
    this.liveTimer = setInterval(() => {
      // Prefer re-fetching real container logs when API is on
      this.projectService.getLogs(this.serviceId).subscribe({
        next: lines => {
          if (lines.length) {
            this.logs.set(lines);
            this.shouldScrollLogs = true;
            return;
          }
          const line = this.projectService.nextLiveLog(this.serviceId);
          if (!line) return;
          this.logs.update(list => [...list.slice(-200), line]);
          this.shouldScrollLogs = true;
        },
        error: () => {
          const line = this.projectService.nextLiveLog(this.serviceId);
          if (!line) return;
          this.logs.update(list => [...list.slice(-200), line]);
          this.shouldScrollLogs = true;
        }
      });
    }, 6000);
  }

  private stopLiveLogs() {
    if (this.liveTimer) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
    this.liveLogs = false;
  }

  bootTerminal() {
    const svc = this.service();
    if (!svc) return;
    this.termLines.set([
      {
        id: 'boot-1',
        type: 'system',
        text: `Connected to ${svc.name} · live container shell`
      },
      {
        id: 'boot-2',
        type: 'system',
        text: 'Commands run inside the container via Portainer. Type "help".'
      }
    ]);
  }

  focusTerm() {
    this.termInput?.nativeElement.focus();
  }

  runHint(cmd: string) {
    this.termCmd = cmd;
    this.submitTerm();
  }

  /** Console shortcut chips — tailored to DB engine or app container. */
  terminalHints(): { label: string; cmd: string }[] {
    const svc = this.service();
    if (!svc) return [];
    if (svc.sourceType === 'DATABASE') {
      const dbType = String((svc.sourceDetails as unknown as Record<string, unknown>)['dbType'] ?? '');
      switch (dbType) {
        case 'MYSQL':
          return [
            { label: 'help', cmd: 'help' },
            { label: 'databases', cmd: `mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -e 'SHOW DATABASES;'` },
            { label: 'tables', cmd: `mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e 'SHOW TABLES;'` },
            { label: 'version', cmd: `mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -e 'SELECT VERSION();'` },
            { label: 'status', cmd: `mysqladmin -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" status` },
            { label: 'mysql env', cmd: `printenv | grep -E '^MYSQL_|^HOSTNAME='` }
          ];
        case 'POSTGRESQL':
          return [
            { label: 'help', cmd: 'help' },
            { label: 'databases', cmd: `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\\l'` },
            { label: 'tables', cmd: `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\\dt'` },
            { label: 'version', cmd: `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'SELECT version();'` },
            { label: 'roles', cmd: `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\\du'` },
            { label: 'pg env', cmd: `printenv | grep -E '^POSTGRES_|^HOSTNAME='` }
          ];
        case 'REDIS':
          return [
            { label: 'help', cmd: 'help' },
            { label: 'ping', cmd: `redis-cli -a "$REDIS_PASSWORD" --no-auth-warning PING` },
            { label: 'info', cmd: `redis-cli -a "$REDIS_PASSWORD" --no-auth-warning INFO server` },
            { label: 'keys', cmd: `redis-cli -a "$REDIS_PASSWORD" --no-auth-warning DBSIZE` },
            { label: 'clients', cmd: `redis-cli -a "$REDIS_PASSWORD" --no-auth-warning CLIENT LIST` },
            { label: 'redis env', cmd: `printenv | grep -E '^REDIS_|^HOSTNAME='` }
          ];
        case 'MONGODB':
          return [
            { label: 'help', cmd: 'help' },
            { label: 'ping', cmd: `mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --quiet --eval 'db.runCommand({ ping: 1 })'` },
            { label: 'databases', cmd: `mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --quiet --eval 'db.adminCommand({ listDatabases: 1 })'` },
            { label: 'version', cmd: `mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --quiet --eval 'db.version()'` },
            { label: 'mongo env', cmd: `printenv | grep -E '^MONGO_|^HOSTNAME='` }
          ];
        default:
          break;
      }
    }
    const port = this.serviceContainerPort();
    return [
      { label: 'help', cmd: 'help' },
      { label: 'ls', cmd: 'ls' },
      { label: 'env', cmd: 'env' },
      { label: 'top', cmd: 'top -b -n 1 | head -20' },
      { label: 'ps', cmd: 'ps aux' },
      { label: 'curl localhost', cmd: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}/ || true` }
    ];
  }

  submitTerm() {
    const cmd = this.termCmd.trim();
    if (!cmd || this.termBusy()) return;
    const svc = this.service();
    if (!svc || svc.status !== 'RUNNING') return;

    this.termLines.update(lines => [
      ...lines,
      { id: `in-${Date.now()}`, type: 'input', text: `$ ${cmd}` }
    ]);
    this.termHistory.push(cmd);
    this.termCmd = '';
    this.termBusy.set(true);
    this.shouldScrollTerm = true;

    this.projectService.runTerminal(this.serviceId, cmd).subscribe({
      next: out => {
        if (out.includes('__CLEAR__')) {
          this.bootTerminal();
        } else {
          this.termLines.update(lines => [
            ...lines,
            ...out.map((text, i) => ({
              id: `out-${Date.now()}-${i}`,
              type: (text.startsWith('error:') || text.startsWith('sh:') ? 'error' : 'output') as TerminalLine['type'],
              text
            }))
          ]);
        }
        this.termBusy.set(false);
        this.shouldScrollTerm = true;
        setTimeout(() => this.focusTerm(), 20);
      },
      error: e => {
        this.termLines.update(lines => [
          ...lines,
          { id: `err-${Date.now()}`, type: 'error', text: friendlyApiMessage(e, 'Shell unavailable. Deploy the service first.') }
        ]);
        this.termBusy.set(false);
        this.shouldScrollTerm = true;
      }
    });
  }

  deploy() {
    if (this.busy() || this.activeDeploy()) {
      this.message.set('A deploy is already running. Wait until it finishes or fails.');
      this.messageTone.set('error');
      return;
    }
    if (!this.canManage()) {
      this.message.set('Deploy access is locked.');
      this.messageTone.set('error');
      return;
    }
    const u = this.usage();
    const p = this.plan();
    if (u && p && !this.auth.canStartDeploy(u, p)) {
      this.message.set('Free plan deploy limit reached for this month. See Billing.');
      this.messageTone.set('error');
      return;
    }
    this.busy.set(true);
    this.clearDeployPolls();
    this.message.set('');
    this.projectService.deploy(this.serviceId).subscribe({
      next: () => {
        this.service.update(s => s ? { ...s, status: 'PENDING' } : s);
        this.setTab('deployments');
        this.loadDeployments();
        this.refreshLogs();
        this.pollDeployProgress();
        this.auth.usage().subscribe({ next: u => this.usage.set(u) });
      },
      error: e => {
        this.message.set(friendlyApiMessage(e, 'Deploy failed'));
        this.messageTone.set('error');
        this.busy.set(false);
        this.loadDeployments();
      }
    });
  }

  private pollDeployProgress() {
    this.clearDeployPolls();
    let ticks = 0;
    const maxTicks = 90;
    const tick = () => {
      ticks++;
      this.projectService.getService(this.projectId, this.serviceId).subscribe({
        next: ({ service }) => {
          this.applyService(service);
          this.loadDeployments();
          this.refreshLogs();
          if (service.status === 'RUNNING') {
            this.message.set('Deploy succeeded');
            this.messageTone.set('ok');
            this.busy.set(false);
            this.clearDeployPolls();
            return;
          }
          if (service.status === 'FAILED') {
            const latest = this.deployments()[0];
            const reason = latest?.errorMessage
              || latest?.logs?.split('\n').filter(Boolean).at(-1)
              || 'see Logs for the stage that failed';
            this.message.set('Deploy failed — ' + reason);
            this.messageTone.set('error');
            this.busy.set(false);
            this.setTab('logs');
            this.clearDeployPolls();
            return;
          }
          if (ticks >= maxTicks) {
            this.busy.set(false);
            return;
          }
          const t = setTimeout(tick, 2000);
          this.deployPollTimers.push(t);
        },
        error: () => {
          if (ticks >= maxTicks) {
            this.busy.set(false);
            return;
          }
          const t = setTimeout(tick, 2000);
          this.deployPollTimers.push(t);
        }
      });
    };
    tick();
  }

  private clearDeployPolls() {
    this.deployPollTimers.forEach(clearTimeout);
    this.deployPollTimers = [];
  }

  stop() {
    if (!this.canManage()) return;
    this.busy.set(true);
    this.clearDeployPolls();
    this.projectService.stopService(this.serviceId).subscribe({
      next: svc => {
        this.applyService(svc);
        this.busy.set(false);
        this.message.set('Service stopped');
        this.messageTone.set('ok');
        this.stopLiveLogs();
        this.loadDeployments();
      },
      error: e => {
        this.message.set(friendlyApiMessage(e, 'Stop failed'));
        this.messageTone.set('error');
        this.busy.set(false);
      }
    });
  }

  restart() {
    if (!this.canManage()) return;
    this.busy.set(true);
    this.projectService.restartService(this.serviceId).subscribe({
      next: svc => {
        this.applyService(svc);
        this.message.set('Restarting…');
        this.messageTone.set('ok');
        setTimeout(() => {
          this.projectService.getService(this.projectId, this.serviceId).subscribe({
            next: ({ service }) => {
              this.applyService(service);
              this.busy.set(false);
              this.message.set('Service restarted');
            }
          });
        }, 1300);
      },
      error: e => {
        this.message.set(friendlyApiMessage(e, 'Restart failed'));
        this.messageTone.set('error');
        this.busy.set(false);
      }
    });
  }

  copyText(value: string) {
    navigator.clipboard?.writeText(value).then(
      () => {
        this.message.set('Copied to clipboard');
        this.messageTone.set('ok');
      },
      () => {
        this.message.set('Copy failed');
        this.messageTone.set('error');
      }
    );
  }

  dbConnKeys(): string[] {
    return Object.keys(this.dbConn() ?? {});
  }

  addVar() {
    this.envDraft.push({ key: '', value: '', isSecret: false });
    this.showSecrets.push(false);
    this.refInsertIndex.set(this.envDraft.length - 1);
    this.markVarsDirty();
  }

  removeVar(i: number) {
    this.envDraft.splice(i, 1);
    this.showSecrets.splice(i, 1);
    this.markVarsDirty();
  }

  onSettingsRuntimeChange(runtime: ServiceRuntime) {
    this.runtimeDraft = runtime;
    if (!this.startCommandTouched) {
      this.startCommandDraft = defaultStartCommand(runtime);
    }
  }

  saveIdentity() {
    const svc = this.service();
    if (!svc || !this.canManage() || !this.nameDraft.trim()) return;

    let sourceDetails = svc.sourceDetails;
    if (svc.sourceType === 'GITHUB') {
      sourceDetails = {
        repositoryUrl: this.sourceDraft.repoUrl.trim(),
        branch: this.sourceDraft.branch.trim() || 'main',
        autoDeploy: this.sourceDraft.autoDeploy,
        runtime: this.runtimeDraft,
        startCommand: (this.startCommandDraft || defaultStartCommand(this.runtimeDraft)).trim(),
        ...(this.sourceDraft.rootDirectory.trim() ? { rootDirectory: this.sourceDraft.rootDirectory.trim() } : { rootDirectory: '' }),
        ...(this.sourceDraft.buildCommand.trim() ? { buildCommand: this.sourceDraft.buildCommand.trim() } : { buildCommand: '' }),
        ...(this.sourceDraft.healthcheckPath.trim() ? { healthcheckPath: this.sourceDraft.healthcheckPath.trim() } : { healthcheckPath: '' }),
        restartPolicy: this.sourceDraft.restartPolicy,
        restartRetries: Number(this.sourceDraft.restartRetries) || 10
      };
    } else if (svc.sourceType === 'DOCKER') {
      sourceDetails = {
        imageName: this.sourceDraft.imageName.trim(),
        imageTag: this.sourceDraft.imageTag.trim() || 'latest',
        containerPort: Number(this.sourceDraft.containerPort) || guessContainerPort(this.sourceDraft.imageName),
        ...(this.startCommandDraft.trim() ? { startCommand: this.startCommandDraft.trim() } : {})
      };
    } else {
      // DB engine + port are immutable after create — only sync display name.
      const existing = (svc.sourceDetails || {}) as unknown as Record<string, unknown>;
      const lockedType = (existing['dbType'] as DatabaseType) || this.sourceDraft.dbType;
      sourceDetails = {
        ...existing,
        dbType: lockedType,
        serviceName: this.nameDraft.trim(),
        containerPort: DB_PRESETS[lockedType].port
      };
    }

    this.saving.set(true);
    this.projectService.updateService(svc.id, {
      name: this.nameDraft.trim(),
      sourceDetails,
      runtime: svc.sourceType === 'DATABASE' || svc.sourceType === 'DOCKER' ? 'other' : this.runtimeDraft
    }).subscribe({
      next: updated => {
        this.applyService(updated);
        this.saving.set(false);
        this.message.set('Service updated');
        this.messageTone.set('ok');
      },
      error: e => {
        this.message.set(friendlyApiMessage(e, 'Failed to update service'));
        this.messageTone.set('error');
        this.saving.set(false);
      }
    });
  }

  cancelDeploy(deploymentId: string) {
    if (!this.canManage()) return;
    this.projectService.cancelDeployment(deploymentId, this.serviceId).subscribe({
      next: () => {
        this.loadDeployments();
        this.projectService.getService(this.projectId, this.serviceId).subscribe({
          next: ({ service }) => this.applyService(service)
        });
        this.message.set('Deployment cancelled');
        this.messageTone.set('ok');
      },
      error: e => {
        this.message.set(friendlyApiMessage(e, 'Cancel failed'));
        this.messageTone.set('error');
      }
    });
  }

  saveVars() {
    if (!this.canManage()) return;
    this.saving.set(true);
    this.projectService.updateEnvVars(this.serviceId, this.envDraft).subscribe({
      next: svc => {
        this.applyService(svc);
        this.saving.set(false);
        this.message.set('Variables saved');
        this.messageTone.set('ok');
      },
      error: e => {
        this.message.set(friendlyApiMessage(e, 'Save failed'));
        this.messageTone.set('error');
        this.saving.set(false);
      }
    });
  }

  onDomainDraftChange(_value: string) {
    this.domainCheck.set(null);
    if (this.domainCheckTimer) clearTimeout(this.domainCheckTimer);
    const trimmed = this.domainDraft.trim();
    if (!trimmed) return;
    this.domainCheckTimer = setTimeout(() => this.checkDomain(), 450);
  }

  loadVanityStatus() {
    if (this.service()?.sourceType === 'DATABASE') {
      this.vanityStatus.set(null);
      return;
    }
    this.projectService.vanityStatus(this.serviceId).subscribe({
      next: s => {
        this.vanityStatus.set(s);
        if (s.thisServiceHoldsVanity && s.claimedSlug) {
          this.vanityDraft = s.claimedSlug;
        } else if (!this.vanityDraft && s.claimedSlug && !s.thisServiceHoldsVanity) {
          // leave draft empty so user must type same slug to move
        }
      },
      error: () => this.vanityStatus.set(null)
    });
  }

  onVanityDraftChange(_value: string) {
    this.vanityCheck.set(null);
    if (this.vanityCheckTimer) clearTimeout(this.vanityCheckTimer);
    const trimmed = this.vanityDraft.trim();
    if (!trimmed) return;
    this.vanityCheckTimer = setTimeout(() => this.checkVanity(), 450);
  }

  vanityClaimBlocked(): boolean {
    const draft = this.vanityDraft.trim().toLowerCase();
    if (!draft) return true;
    const status = this.vanityStatus();
    if (status?.thisServiceHoldsVanity && (status.claimedSlug || '').toLowerCase() === draft) {
      return false; // already claimed — Update/no-op allowed without Check
    }
    const check = this.vanityCheck();
    if (!check || (check.domain || '').split('.')[0].toLowerCase() !== draft) return true;
    return !check.available;
  }

  checkVanity() {
    if (!this.canManage()) return;
    if (this.service()?.sourceType === 'DATABASE') return;
    const draft = this.vanityDraft.trim();
    if (!draft) {
      this.vanityCheck.set({ domain: '', available: false, reason: 'Enter a subdomain slug (3–30 characters)' });
      return;
    }
    const seq = ++this.vanityCheckSeq;
    this.checkingVanity.set(true);
    this.projectService.checkVanitySubdomain(this.serviceId, draft).subscribe({
      next: result => {
        if (seq !== this.vanityCheckSeq) return;
        this.vanityCheck.set(result);
        this.checkingVanity.set(false);
      },
      error: e => {
        if (seq !== this.vanityCheckSeq) return;
        this.vanityCheck.set({
          domain: draft,
          available: false,
          reason: friendlyApiMessage(e, 'Could not check subdomain')
        });
        this.checkingVanity.set(false);
      }
    });
  }

  claimVanity() {
    if (!this.canManage() || this.vanityClaimBlocked()) return;
    this.saving.set(true);
    this.projectService.setVanitySubdomain(this.serviceId, this.vanityDraft.trim()).subscribe({
      next: svc => {
        this.applyService(svc);
        this.loadVanityStatus();
        this.saving.set(false);
        this.message.set('Vanity subdomain claimed');
        this.messageTone.set('ok');
      },
      error: e => {
        this.message.set(friendlyApiMessage(e, 'Claim failed'));
        this.messageTone.set('error');
        this.saving.set(false);
        this.checkVanity();
      }
    });
  }

  releaseVanity() {
    if (!this.canManage()) return;
    if (!confirm('Release vanity subdomain? This service will get a new random platform URL.')) return;
    this.saving.set(true);
    this.projectService.clearVanitySubdomain(this.serviceId).subscribe({
      next: svc => {
        this.applyService(svc);
        this.vanityDraft = '';
        this.vanityCheck.set(null);
        this.loadVanityStatus();
        this.saving.set(false);
        this.message.set('Vanity released — random URL assigned');
        this.messageTone.set('ok');
      },
      error: e => {
        this.message.set(friendlyApiMessage(e, 'Release failed'));
        this.messageTone.set('error');
        this.saving.set(false);
      }
    });
  }

  domainSaveBlocked(): boolean {
    const draft = this.domainDraft.trim().toLowerCase();
    if (!draft) return false; // clearing is always ok
    const current = (this.service()?.customDomain ?? '').trim().toLowerCase();
    if (draft === current) return false; // unchanged
    const check = this.domainCheck();
    if (!check || (check.domain || '').toLowerCase() !== draft) return true; // must check first
    return !check.available;
  }

  checkDomain() {
    if (!this.canManage()) return;
    if (this.service()?.sourceType === 'DATABASE') return;
    const draft = this.domainDraft.trim();
    if (!draft) {
      this.domainCheck.set({ domain: '', available: true, reason: 'Empty value clears the custom domain' });
      return;
    }
    const seq = ++this.domainCheckSeq;
    this.checkingDomain.set(true);
    this.projectService.checkCustomDomain(this.serviceId, draft).subscribe({
      next: result => {
        if (seq !== this.domainCheckSeq) return;
        this.domainCheck.set(result);
        this.checkingDomain.set(false);
      },
      error: e => {
        if (seq !== this.domainCheckSeq) return;
        this.domainCheck.set({
          domain: draft,
          available: false,
          reason: friendlyApiMessage(e, 'Could not check domain')
        });
        this.checkingDomain.set(false);
      }
    });
  }

  saveDomain() {
    if (!this.canManage()) return;
    if (this.service()?.sourceType === 'DATABASE') return;
    if (this.domainSaveBlocked()) return;
    this.saving.set(true);
    this.projectService.setCustomDomain(this.serviceId, this.domainDraft.trim()).subscribe({
      next: svc => {
        this.applyService(svc);
        this.saving.set(false);
        this.message.set(this.domainDraft.trim() ? 'Custom domain saved' : 'Custom domain cleared');
        this.messageTone.set('ok');
      },
      error: e => {
        this.message.set(friendlyApiMessage(e, 'Domain update failed'));
        this.messageTone.set('error');
        this.saving.set(false);
        this.checkDomain();
      }
    });
  }

  clearCustomDomain() {
    if (!this.canManage()) return;
    this.domainDraft = '';
    this.domainCheck.set(null);
    this.saveDomain();
  }

  readonly publicHost = publicHost;
  readonly publicUrl = publicUrl;

  saveSettings() {
    if (!this.canManage()) return;
    this.saving.set(true);
    const volume = this.useVolume
      ? { mountPath: this.volumePath || '/data', sizeGb: this.volumeSize || 1 }
      : undefined;
    this.projectService.updateService(this.serviceId, {
      quota: this.quotaDraft,
      volume,
      removeVolume: !this.useVolume
    }).subscribe({
      next: svc => {
        this.applyService(svc);
        this.saving.set(false);
        this.message.set('Settings saved');
        this.messageTone.set('ok');
      },
      error: e => {
        this.message.set(friendlyApiMessage(e, 'Settings failed'));
        this.messageTone.set('error');
        this.saving.set(false);
      }
    });
  }

  openDeleteService() {
    const svc = this.service();
    if (!svc || !this.canManage()) return;
    this.deleteError.set(null);
    this.deleting.set(false);
    this.deleteTarget.set(svc);
  }

  closeDeleteDialog() {
    if (this.deleting()) return;
    this.deleteTarget.set(null);
    this.deleteError.set(null);
  }

  executeDeleteService() {
    const svc = this.deleteTarget();
    if (!svc || this.deleting()) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    this.projectService.deleteService(svc.id).subscribe({
      next: () => this.router.navigate(['/projects', this.projectId]),
      error: e => {
        this.deleting.set(false);
        this.deleteError.set(
          friendlyApiMessage(e, 'Delete failed. Service kept because Portainer did not confirm removal.')
        );
      }
    });
  }

  noop() {}
}
