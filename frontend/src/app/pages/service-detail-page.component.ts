import {
  AfterViewChecked,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
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
  TerminalLine
} from '../core/models';
import { DB_PRESETS, guessContainerPort } from '../shared/service-source.util';
import { publicHost, publicUrl } from '../shared/public-host.util';

type ServiceTab = 'overview' | 'deployments' | 'metrics' | 'logs' | 'terminal' | 'variables' | 'network' | 'settings';

@Component({
  selector: 'app-service-detail-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
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
              <span class="service-status-badge" [class]="'badge-' + svc.status.toLowerCase()">{{ svc.status }}</span>
            }
          </div>
          @if (showDeployChrome()) {
            <div class="deploy-chrome svc-header-deploy">
              <div class="deploy-timeline" aria-label="Deployment progress">
                @for (step of deployTimelineSteps; track step; let i = $index) {
                  <span
                    class="deploy-step"
                    [class.done]="i < headerDeployStep()"
                    [class.active]="i === headerDeployStep()"
                  >{{ step }}</span>
                  @if (i < deployTimelineSteps.length - 1) {
                    <span class="deploy-step-sep">→</span>
                  }
                }
              </div>
              <div class="deploy-progress" aria-hidden="true">
                <span [style.width.%]="headerDeployProgress()"></span>
              </div>
            </div>
          }
          <p class="railway-page-sub">{{ sourceSummary() }}</p>
        </div>
      </div>

      <div class="railway-topbar-actions svc-actions">
        @if (service(); as svc) {
          @if (svc.status === 'PENDING' || svc.status === 'STOPPED' || svc.status === 'FAILED') {
            <button type="button" class="btn btn-primary btn-sm" (click)="deploy()" [disabled]="busy() || !canManage()">
              {{ busy() ? 'Deploying…' : 'Deploy' }}
            </button>
          }
          @if (svc.status === 'RUNNING') {
            <button type="button" class="btn btn-ghost btn-sm" (click)="setTab('terminal')">Terminal</button>
            <button type="button" class="btn btn-ghost btn-sm" (click)="setTab('logs')">Logs</button>
            <button type="button" class="btn btn-sm btn-ghost" (click)="restart()" [disabled]="busy() || !canManage()">
              {{ busy() ? '…' : 'Restart' }}
            </button>
            <button type="button" class="btn btn-sm btn-danger-soft" (click)="stop()" [disabled]="busy() || !canManage()">Stop</button>
            <button type="button" class="btn btn-primary btn-sm" (click)="deploy()" [disabled]="busy() || !canManage()">
              {{ busy() ? '…' : 'Redeploy' }}
            </button>
          }
        }
      </div>
    </header>

    @if (message()) {
      <div class="pill" [class]="messageTone() === 'error' ? 'pill-red' : 'pill-green'" style="margin-bottom:14px">
        {{ message() }}
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
      <div class="railway-empty panel"><p>Service not found.</p></div>
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
        <div class="svc-panel-grid">
          <section class="panel svc-panel">
            <h3>Resources</h3>
            <div class="metric-row">
              <div class="metric">
                <span class="metric-label">CPU</span>
                <strong>{{ service()!.cpuUsage | number:'1.1-1' }}%</strong>
                <div class="meter"><span [style.width.%]="cpuPct()"></span></div>
                <small>{{ service()!.quota.cpuMilli }}m limit</small>
              </div>
              <div class="metric">
                <span class="metric-label">Memory</span>
                <strong>{{ service()!.ramUsageMb }} MB</strong>
                <div class="meter"><span [style.width.%]="ramPct()"></span></div>
                <small>{{ service()!.quota.memorymb }} MB limit</small>
              </div>
              <div class="metric">
                <span class="metric-label">Storage</span>
                <strong>{{ service()!.volume?.sizeGb ?? service()!.quota.storageGb }} GB</strong>
                <div class="meter"><span [style.width.%]="service()!.volume ? 100 : 0"></span></div>
                <small>{{ service()!.volume?.mountPath || 'ephemeral (no volume)' }}</small>
              </div>
            </div>
          </section>

          <section class="panel svc-panel">
            <h3>Quick info</h3>
            <dl class="svc-dl">
              <div><dt>Source</dt><dd>{{ service()!.sourceType }}</dd></div>
              <div><dt>Runtime</dt><dd>{{ runtimeLabel(service()!.runtime) }}</dd></div>
              <div><dt>Health</dt><dd>
                <span class="pill" [class]="service()!.status === 'RUNNING' ? 'pill-green' : 'pill-amber'">
                  {{ service()!.status === 'RUNNING' ? 'Healthy' : service()!.status }}
                </span>
              </dd></div>
              <div><dt>Created</dt><dd>{{ service()!.createdAt | date:'medium' }}</dd></div>
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
            <button type="button" class="btn btn-primary btn-sm" (click)="deploy()" [disabled]="busy() || !canManage()">Deploy Now</button>
          </div>

          @if (activeDeploy(); as active) {
            <div class="deploy-active-banner deploy-chrome">
              <div class="deploy-active-spinner" aria-hidden="true"></div>
              <div class="deploy-active-body">
                <strong>
                  @if (active.rollbackOf) { Rolling back… } @else { Deploy in progress }
                </strong>
                <div class="deploy-timeline" aria-label="Deployment progress">
                  @for (step of deployTimelineSteps; track step; let i = $index) {
                    <span
                      class="deploy-step"
                      [class.done]="i < deployStepIndex(active.status)"
                      [class.active]="i === deployStepIndex(active.status)"
                    >{{ step }}</span>
                    @if (i < deployTimelineSteps.length - 1) {
                      <span class="deploy-step-sep">→</span>
                    }
                  }
                </div>
                <div class="deploy-progress" aria-hidden="true">
                  <span [style.width.%]="deployProgressPct(active.status)"></span>
                </div>
                <span class="muted" style="font-size:12px">
                  @if (active.commitSha) { #{{ active.commitSha }} · }
                  @if (active.imageTag) { {{ active.imageTag }} · }
                  {{ active.id }}
                </span>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" (click)="cancelDeploy(active.id)" [disabled]="!canManage()">Cancel</button>
            </div>
          }

          @if (!deployments().length) {
            <p class="muted">No deployments yet.</p>
          } @else {
            <div class="dep-list">
              @for (d of deployments(); track d.id) {
                <div class="dep-row" [class.dep-row-live]="isLiveDeploy(d)" [class.dep-row-active]="isActiveDeploy(d)">
                  <div class="dep-row-top">
                    <div class="dep-status-group">
                      <span class="dep-status" [class]="'dep-' + d.status.toLowerCase()">{{ d.status }}</span>
                      @if (isLiveDeploy(d)) {
                        <span class="pill pill-green dep-live-pill">Live</span>
                      }
                      @if (d.rollbackOf) {
                        <span class="pill pill-indigo dep-live-pill">Rollback</span>
                      }
                    </div>
                    <div class="dep-actions">
                      @if (d.status === 'QUEUED' || d.status === 'BUILDING' || d.status === 'DEPLOYING') {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="cancelDeploy(d.id)" [disabled]="!canManage()">Cancel</button>
                      }
                      @if (d.status === 'SUCCESS' && isLiveDeploy(d)) {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="deploy()" [disabled]="busy() || !canManage()">Redeploy</button>
                      }
                      @if (canRollback(d)) {
                        <button
                          type="button"
                          class="btn btn-ghost btn-sm"
                          (click)="openRollback(d)"
                          [disabled]="busy() || rollbackBusy()"
                        >Rollback to this deployment</button>
                      }
                    </div>
                  </div>
                  <div class="dep-meta">
                    <strong>{{ d.id }}</strong>
                    <span>{{ d.triggeredBy }} · {{ d.startedAt | date:'short' }}</span>
                    @if (d.commitSha) { <span class="mono">#{{ d.commitSha }}</span> }
                    @if (d.imageTag) { <span class="mono">{{ d.imageTag }}</span> }
                    @if (d.rollbackOf) { <span class="muted">from {{ d.rollbackOf }}</span> }
                  </div>
                  @if (d.logs) {
                    <pre class="dep-logs">{{ d.logs }}</pre>
                  }
                </div>
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
              <select [(ngModel)]="logFilter" (ngModelChange)="noop()">
                <option value="all">All levels</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
                <option value="debug">Debug</option>
              </select>
              <label class="toggle-inline">
                <input type="checkbox" [(ngModel)]="liveLogs" (ngModelChange)="toggleLiveLogs($event)" />
                Live
              </label>
              <button type="button" class="btn btn-ghost btn-sm" (click)="refreshLogs()">Refresh</button>
              <button type="button" class="btn btn-ghost btn-sm" (click)="clearLogsView()">Clear</button>
            </div>
          </div>
          <div class="logs-console" #logsBox>
            @for (line of filteredLogs(); track line.id) {
              <div class="log-line" [class]="'lvl-' + line.level">
                <span class="log-time">{{ line.timestamp | date:'HH:mm:ss' }}</span>
                <span class="log-level">{{ line.level }}</span>
                <span class="log-msg">{{ line.message }}</span>
              </div>
            } @empty {
              <div class="muted" style="padding:16px">No log lines.</div>
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
            <button type="button" class="term-chip" (click)="runHint('help')">help</button>
            <button type="button" class="term-chip" (click)="runHint('ls')">ls</button>
            <button type="button" class="term-chip" (click)="runHint('env')">env</button>
            <button type="button" class="term-chip" (click)="runHint('top')">top</button>
            <button type="button" class="term-chip" (click)="runHint('ps')">ps</button>
            <button type="button" class="term-chip" (click)="runHint('curl -s http://127.0.0.1:' + serviceContainerPort() + '/')">curl localhost</button>
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
              <button type="button" class="btn btn-ghost" (click)="deploy()" [disabled]="busy() || !canManage()">
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
            <span class="muted" style="font-size:12px">Live stats from the running container (Portainer)</span>
            <button type="button" class="btn btn-ghost btn-sm" (click)="refreshLiveMetrics()" [disabled]="metricsLoading()">
              {{ metricsLoading() ? 'Refreshing…' : 'Refresh' }}
            </button>
          </div>

          @if (metricsLoading()) {
            <div class="metrics-grid">
              @for (i of [1,2]; track i) {
                <article class="panel metrics-card skeleton-card">
                  <div class="skeleton skeleton-line w-40"></div>
                  <div class="skeleton skeleton-chart"></div>
                </article>
              }
            </div>
          } @else if (!liveMetrics()?.['available']) {
            <div class="panel svc-panel">
              <p class="muted">{{ liveMetrics()?.['error'] || 'Metrics unavailable — deploy the service and keep it RUNNING.' }}</p>
            </div>
          } @else {
            <div class="metrics-grid">
              <article class="panel metrics-card">
                <div class="metrics-card-head">
                  <h3>CPU</h3>
                  <strong>{{ liveMetrics()!['cpuPercent'] }}%</strong>
                </div>
                <div class="meter" style="height:10px;margin:18px 0 8px">
                  <span [style.width.%]="metricBarPct(liveMetrics()!['cpuPercent'])"></span>
                </div>
                <div class="metrics-legend">
                  <span class="muted">Limit {{ service()!.quota.cpuMilli }}m</span>
                </div>
              </article>
              <article class="panel metrics-card">
                <div class="metrics-card-head">
                  <h3>Memory</h3>
                  <strong>{{ liveMetrics()!['memoryUsageMb'] }} MB</strong>
                </div>
                <div class="meter" style="height:10px;margin:18px 0 8px">
                  <span [style.width.%]="metricBarPct(liveMetrics()!['memoryPercent'])"></span>
                </div>
                <div class="metrics-legend">
                  <span class="muted">Limit {{ liveMetrics()!['memoryLimitMb'] || service()!.quota.memorymb }} MB</span>
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
              <p class="muted" style="margin-top:8px;font-size:13px">Assigned automatically — cannot be renamed.</p>
            } @else {
              <p class="muted">Assigned on first deploy.</p>
            }
          </div>

          <div class="field">
            <label>Custom domain</label>
            <input [(ngModel)]="domainDraft" placeholder="app.example.com" autocomplete="off" />
            <p class="muted" style="margin-top:8px;font-size:13px">
              Point a CNAME (or ALIAS) for this hostname to <code>cloudbase.website</code>, then save.
              Leave empty and save to remove.
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
            <button type="button" class="btn btn-primary" (click)="saveDomain()" [disabled]="saving() || !canManage()">
              {{ saving() ? 'Saving…' : 'Save custom domain' }}
            </button>
            @if (service()!.customDomain) {
              <button type="button" class="btn btn-ghost" (click)="clearCustomDomain()" [disabled]="saving() || !canManage()">
                Remove
              </button>
            }
          </div>

          <div class="net-ports" style="margin-top:24px">
            <h4>Ports</h4>
            @if (service()!.sourceType === 'DATABASE') {
              <div class="port-row"><span>TCP</span><code>{{ serviceContainerPort() }}</code><span class="pill pill-amber">private network</span></div>
            } @else {
              <div class="port-row"><span>HTTP</span><code>{{ serviceContainerPort() }} → 443</code><span class="pill pill-green">public</span></div>
              <div class="port-row"><span>Container</span><code>{{ service()!.containerName || ('cb-' + service()!.id) }}</code><span class="pill pill-indigo">internal</span></div>
            }
          </div>
        </section>
      }

      <!-- SETTINGS -->
      @if (tab() === 'settings') {
        <section class="panel svc-panel">
          <h3>Service identity</h3>
          <div class="field" style="margin-bottom:14px">
            <label>Service Name</label>
            <input [(ngModel)]="nameDraft" />
          </div>

          @if (service()!.sourceType === 'GITHUB') {
            <div class="field" style="margin-bottom:14px">
              <label>Runtime / Language</label>
              <select [(ngModel)]="runtimeDraft">
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

          @if (service()!.sourceType === 'GITHUB') {
            <div class="field"><label>Repository URL</label><input [(ngModel)]="sourceDraft.repoUrl" [placeholder]="'https://github.com/' + (auth.githubUsername() || 'user') + '/repo'" /></div>
            <div class="field"><label>Branch</label><input [(ngModel)]="sourceDraft.branch" /></div>
            <label class="toggle-field"><input type="checkbox" [(ngModel)]="sourceDraft.autoDeploy" /><span>Auto deploy on push</span></label>
            @if (githubCiMessage()) {
              <div class="pill" [class.pill-emerald]="githubCiOk()" [class.pill-amber]="!githubCiOk()" style="margin-top:12px;display:block;white-space:normal;line-height:1.4">
                <strong>CI (B2):</strong> {{ githubCiMessage() }}
                @if (githubImageName()) {
                  <div style="margin-top:6px;opacity:.85">Image: <code>{{ githubImageName() }}</code></div>
                }
              </div>
            }
          }
          @if (service()!.sourceType === 'DOCKER') {
            <div class="field"><label>Image Name</label><input [(ngModel)]="sourceDraft.imageName" (ngModelChange)="onSettingsImageChange($event)" /></div>
            <div class="field"><label>Image Tag</label><input [(ngModel)]="sourceDraft.imageTag" /></div>
            <div class="field">
              <label>Container port</label>
              <input type="number" [(ngModel)]="sourceDraft.containerPort" min="1" max="65535" />
            </div>
          }
          @if (service()!.sourceType === 'DATABASE') {
            <div class="field">
              <label>Database Type</label>
              <select [(ngModel)]="sourceDraft.dbType" (ngModelChange)="onSettingsDbTypeChange($event)">
                @for (t of dbTypes; track t) {
                  <option [value]="t">{{ dbPreset(t).label }}</option>
                }
              </select>
              <p class="empty-sub" style="margin:6px 0 0">{{ dbPreset(sourceDraft.dbType).hint }}</p>
            </div>
            <div class="field">
              <label>Internal port</label>
              <input type="number" [ngModel]="dbPreset(sourceDraft.dbType).port" disabled />
            </div>
          }

          <div class="modal-actions" style="margin:16px 0 24px">
            <button type="button" class="btn btn-primary" (click)="saveIdentity()" [disabled]="saving() || !canManage() || !nameDraft.trim()">
              {{ saving() ? 'Saving…' : 'Save Service' }}
            </button>
          </div>

          <h3>Resources</h3>
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
              {{ saving() ? 'Saving…' : 'Save Resources' }}
            </button>
          </div>

          <div class="danger-zone">
            <h4>Danger zone</h4>
            <p class="muted">Deleting a service removes its container, volume config, and deployments.</p>
            <button type="button" class="btn btn-danger-soft" (click)="deleteService()" [disabled]="!canManage()">
              Delete Service
            </button>
          </div>
        </section>
      }
    }
  </div>
</div>
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
  readonly termBusy = signal(false);
  readonly tab = signal<ServiceTab>('overview');
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
  readonly deployTimelineSteps = ['Queued', 'Building', 'Deploying', 'Success'] as const;
  private metricsLoadTimer: ReturnType<typeof setTimeout> | null = null;
  private deployPollTimers: Array<ReturnType<typeof setTimeout>> = [];
  domainDraft = '';
  quotaDraft = { memorymb: 512, cpuMilli: 500, storageGb: 2 };
  useVolume = false;
  volumePath = '/data';
  volumeSize = 2;
  nameDraft = '';
  runtimeDraft: ServiceRuntime = 'node';
  sourceDraft = {
    repoUrl: '',
    branch: 'main',
    autoDeploy: true,
    imageName: '',
    imageTag: 'latest',
    containerPort: 80,
    dbType: 'POSTGRESQL' as DatabaseType
  };
  readonly dbTypes: DatabaseType[] = ['POSTGRESQL', 'MYSQL', 'REDIS', 'MONGODB'];
  logFilter: 'all' | 'info' | 'warn' | 'error' | 'debug' = 'all';
  liveLogs = false;
  termCmd = '';
  private termHistory: string[] = [];
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private shouldScrollTerm = false;
  private shouldScrollLogs = false;
  projectId = '';
  private serviceId = '';

  ngOnInit() {
    this.projectId = this.route.snapshot.paramMap.get('projectId')!;
    this.serviceId = this.route.snapshot.paramMap.get('serviceId')!;
    const tabParam = this.route.snapshot.queryParamMap.get('tab') as ServiceTab | null;
    if (tabParam && this.tabs.some(t => t.id === tabParam)) this.tab.set(tabParam);
    this.load();
  }

  ngOnDestroy() {
    this.stopLiveLogs();
    this.clearDeployPolls();
    if (this.metricsLoadTimer) clearTimeout(this.metricsLoadTimer);
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
        if (service.sourceType === 'DATABASE') {
          this.projectService.dbConnection(service.id).subscribe({
            next: info => this.dbConn.set(info),
            error: () => this.dbConn.set(null)
          });
        }
      },
      error: e => {
        this.message.set(e?.error?.message ?? 'Failed to load service');
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
    this.quotaDraft = { ...service.quota };
    this.useVolume = !!service.volume;
    this.volumePath = service.volume?.mountPath ?? '/data';
    this.volumeSize = service.volume?.sizeGb ?? 2;
    this.nameDraft = service.name;
    this.runtimeDraft = service.runtime ?? 'node';
    const d = service.sourceDetails as unknown as Record<string, unknown>;
    this.sourceDraft = {
      repoUrl: String(d['repositoryUrl'] ?? ''),
      branch: String(d['branch'] ?? 'main'),
      autoDeploy: d['autoDeploy'] !== false,
      imageName: String(d['imageName'] ?? ''),
      imageTag: String(d['imageTag'] ?? 'latest'),
      containerPort: Number(d['containerPort'] ?? service.containerPort ?? guessContainerPort(String(d['imageName'] ?? ''))) || 80,
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
    return this.deployments().find(d =>
      d.status === 'QUEUED' || d.status === 'BUILDING' || d.status === 'DEPLOYING'
    );
  }

  deployStepIndex(status: string): number {
    switch (status) {
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

  deployProgressPct(status: string): number {
    return [18, 42, 72, 100][this.deployStepIndex(status)] ?? 18;
  }

  showDeployChrome(): boolean {
    const svc = this.service();
    if (!svc) return false;
    return this.busy() || ['PENDING', 'BUILDING', 'DEPLOYING'].includes(svc.status) || !!this.activeDeploy();
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

  isActiveDeploy(d: Deployment): boolean {
    return d.status === 'QUEUED' || d.status === 'BUILDING' || d.status === 'DEPLOYING';
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
        this.message.set(e?.error?.message ?? 'Rollback failed');
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
    if (id === 'metrics' || id === 'overview') this.refreshLiveMetrics();
  }

  refreshLiveMetrics() {
    const svc = this.service();
    if (!svc) return;
    this.metricsLoading.set(true);
    this.projectService.getMetrics(svc.id).subscribe({
      next: m => {
        this.liveMetrics.set(m);
        if (m['available']) {
          const cpu = Number(m['cpuPercent'] ?? 0);
          const mem = Number(m['memoryUsageMb'] ?? 0);
          this.service.update(s => s ? { ...s, cpuUsage: cpu, ramUsageMb: Math.round(mem) } : s);
        }
        this.metricsLoading.set(false);
      },
      error: () => {
        this.liveMetrics.set({ available: false, error: 'Could not load metrics' });
        this.metricsLoading.set(false);
      }
    });
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
    const user = this.auth.user();
    return !!user && user.accountStatus === 'ACTIVE' && user.deploymentEnabled;
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
    if (svc.sourceType === 'DOCKER') return `${d['imageName']}:${d['imageTag'] ?? 'latest'}`;
    return String(d['dbType'] ?? 'DATABASE');
  }

  githubCiMessage(): string {
    const d = this.service()?.sourceDetails as unknown as Record<string, unknown> | undefined;
    return d?.['ciMessage'] ? String(d['ciMessage']) : '';
  }

  githubCiOk(): boolean {
    const d = this.service()?.sourceDetails as unknown as Record<string, unknown> | undefined;
    return d?.['ciBootstrapped'] === true;
  }

  githubImageName(): string {
    const d = this.service()?.sourceDetails as unknown as Record<string, unknown> | undefined;
    return d?.['imageName'] ? String(d['imageName']) : '';
  }

  cpuPct(): number {
    const s = this.service();
    if (!s) return 0;
    return Math.min(100, (s.cpuUsage / Math.max(1, s.quota.cpuMilli / 10)) * 100);
  }

  ramPct(): number {
    const s = this.service();
    if (!s) return 0;
    return Math.min(100, (s.ramUsageMb / Math.max(1, s.quota.memorymb)) * 100);
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
    }, 2500);
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
          { id: `err-${Date.now()}`, type: 'error', text: e?.error?.message ?? 'Shell error' }
        ]);
        this.termBusy.set(false);
        this.shouldScrollTerm = true;
      }
    });
  }

  deploy() {
    if (!this.canManage()) return;
    this.busy.set(true);
    this.clearDeployPolls();
    this.projectService.deploy(this.serviceId).subscribe({
      next: () => {
        this.service.update(s => s ? { ...s, status: 'PENDING' } : s);
        this.message.set('Deployment queued');
        this.messageTone.set('ok');
        this.loadDeployments();
        this.pollDeployProgress();
      },
      error: e => {
        this.message.set(e?.error?.message ?? 'Deploy failed');
        this.messageTone.set('error');
        this.busy.set(false);
      }
    });
  }

  private pollDeployProgress() {
    const ticks = [450, 1000, 1850, 2100];
    ticks.forEach((ms, i) => {
      const t = setTimeout(() => {
        this.projectService.getService(this.projectId, this.serviceId).subscribe({
          next: ({ service }) => {
            this.applyService(service);
            this.loadDeployments();
            if (i === ticks.length - 1 || service.status === 'RUNNING' || service.status === 'FAILED') {
              this.busy.set(false);
            }
          },
          error: () => {
            if (i === ticks.length - 1) this.busy.set(false);
          }
        });
      }, ms);
      this.deployPollTimers.push(t);
    });
  }

  private clearDeployPolls() {
    this.deployPollTimers.forEach(clearTimeout);
    this.deployPollTimers = [];
  }

  stop() {
    if (!this.canManage()) return;
    this.busy.set(true);
    this.projectService.stopService(this.serviceId).subscribe({
      next: svc => {
        this.applyService(svc);
        this.busy.set(false);
        this.message.set('Service stopped');
        this.messageTone.set('ok');
        this.stopLiveLogs();
      },
      error: e => {
        this.message.set(e?.error?.message ?? 'Stop failed');
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
        this.message.set(e?.error?.message ?? 'Restart failed');
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

  saveIdentity() {
    const svc = this.service();
    if (!svc || !this.canManage() || !this.nameDraft.trim()) return;

    let sourceDetails = svc.sourceDetails;
    if (svc.sourceType === 'GITHUB') {
      sourceDetails = {
        repositoryUrl: this.sourceDraft.repoUrl.trim(),
        branch: this.sourceDraft.branch.trim() || 'main',
        autoDeploy: this.sourceDraft.autoDeploy
      };
    } else if (svc.sourceType === 'DOCKER') {
      sourceDetails = {
        imageName: this.sourceDraft.imageName.trim(),
        imageTag: this.sourceDraft.imageTag.trim() || 'latest',
        containerPort: Number(this.sourceDraft.containerPort) || guessContainerPort(this.sourceDraft.imageName)
      };
    } else {
      sourceDetails = {
        dbType: this.sourceDraft.dbType,
        serviceName: this.nameDraft.trim(),
        containerPort: DB_PRESETS[this.sourceDraft.dbType].port
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
        this.message.set(e?.error?.message ?? 'Failed to update service');
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
        this.message.set(e?.error?.message ?? 'Cancel failed');
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
        this.message.set(e?.error?.message ?? 'Save failed');
        this.messageTone.set('error');
        this.saving.set(false);
      }
    });
  }

  saveDomain() {
    if (!this.canManage()) return;
    this.saving.set(true);
    this.projectService.setCustomDomain(this.serviceId, this.domainDraft.trim()).subscribe({
      next: svc => {
        this.applyService(svc);
        this.saving.set(false);
        this.message.set(this.domainDraft.trim() ? 'Custom domain saved' : 'Custom domain cleared');
        this.messageTone.set('ok');
      },
      error: e => {
        this.message.set(e?.error?.message ?? 'Domain update failed');
        this.messageTone.set('error');
        this.saving.set(false);
      }
    });
  }

  clearCustomDomain() {
    if (!this.canManage()) return;
    this.domainDraft = '';
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
        this.message.set(e?.error?.message ?? 'Settings failed');
        this.messageTone.set('error');
        this.saving.set(false);
      }
    });
  }

  deleteService() {
    const svc = this.service();
    if (!svc || !this.canManage()) return;
    if (!confirm(`Delete service "${svc.name}"? This cannot be undone.`)) return;
    this.projectService.deleteService(svc.id).subscribe({
      next: () => this.router.navigate(['/projects', this.projectId]),
      error: e => {
        this.message.set(e?.error?.message ?? 'Delete failed');
        this.messageTone.set('error');
      }
    });
  }

  noop() {}
}
