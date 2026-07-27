import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ProjectRecord } from '../core/models';
import { ProjectService } from '../core/project.service';
import { IconComponent } from '../shared/icon.component';

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent],
  template: `
    <div class="page">
      <div class="container">
        <div class="page-header">
          <div>
            <p class="section-label">Developer Portal</p>
            <h1 class="section-title">Your Projects</h1>
            <p class="section-desc">Monitor deployments, manage containers, and track resource usage in real time.</p>
          </div>
          <div class="page-header-actions">
            <button class="btn btn-ghost btn-sm" (click)="loadProjects()">↻ Refresh</button>
            <a routerLink="/wizard" class="btn btn-primary btn-sm">+ New Project</a>
          </div>
        </div>

        <div *ngIf="message()" class="pill pill-red" style="padding: 12px 16px; margin-bottom: 20px; border-radius: 12px;">
          {{ message() }}
        </div>

        <div *ngIf="projects().length === 0 && !loading()" class="panel" style="padding: 48px; text-align: center;">
          <div class="empty-state-icon">
            <app-icon name="folder" tone="sky" size="lg"></app-icon>
          </div>
          <h3 style="margin: 0 0 8px;">No projects yet</h3>
          <p class="muted" style="margin: 0 0 20px;">Deploy your first application to get started.</p>
          <a routerLink="/wizard" class="btn btn-primary">Create Project</a>
        </div>

        <div class="grid" style="gap: 20px;">
          <article class="panel panel-glow project-card" *ngFor="let project of projects()">
            <div class="project-header">
              <div>
                <h3 style="margin: 0 0 6px; font-size: 1.15rem;">{{ project.name }}</h3>
                <div class="muted" style="font-size: 13px;">{{ project.framework }} · {{ project.subdomain }}</div>
              </div>
              <span [class]="statusPill(project.status)">{{ project.status.replace('_', ' ') }}</span>
            </div>

            <div class="project-meta">
              <div class="meta-box">
                <strong>Repository</strong>
                <span style="font-size: 13px;">{{ project.repository }}</span>
              </div>
              <div class="meta-box">
                <strong>Quota</strong>
                <span style="font-size: 13px;">{{ project.quota.memory }} · {{ project.quota.cpu }} vCPU</span>
              </div>
              <div class="meta-box">
                <strong>CPU Usage</strong>
                <div style="margin-top: 6px;">
                  <div class="progress-track">
                    <div class="progress-fill progress-indigo" [style.width.%]="project.cpuUsage || 0"></div>
                  </div>
                  <span class="muted" style="font-size: 12px;">{{ project.cpuUsage }}%</span>
                </div>
              </div>
              <div class="meta-box">
                <strong>RAM Usage</strong>
                <div style="margin-top: 6px;">
                  <div class="progress-track">
                    <div class="progress-fill progress-emerald" [style.width.%]="ramPercent(project)"></div>
                  </div>
                  <span class="muted" style="font-size: 12px;">{{ project.ramUsageMb }} MB</span>
                </div>
              </div>
            </div>

            <div class="project-actions">
              <button class="btn btn-primary btn-sm" (click)="start(project)" [disabled]="project.status === 'RUNNING'">▶ Start</button>
              <button class="btn btn-danger btn-sm" (click)="stop(project)" [disabled]="project.status === 'STOPPED' || project.status === 'PENDING_APPROVAL'">■ Stop</button>
              <a *ngIf="project.status === 'RUNNING'" [href]="'https://' + project.subdomain" target="_blank" class="btn btn-ghost btn-sm">↗ Visit</a>
            </div>
          </article>
        </div>
      </div>
    </div>
  `
})
export class DashboardPageComponent implements OnInit {
  private readonly projectService = inject(ProjectService);

  readonly projects = signal<ProjectRecord[]>([]);
  readonly message = signal('');
  readonly loading = signal(true);

  ngOnInit() {
    this.loadProjects();
  }

  loadProjects() {
    this.loading.set(true);
    this.projectService.list().subscribe({
      next: (projects) => {
        this.projects.set(projects);
        this.message.set('');
        this.loading.set(false);
      },
      error: (error) => {
        this.message.set(error.error?.message ?? error.message ?? 'Failed to load projects');
        this.loading.set(false);
      }
    });
  }

  start(project: ProjectRecord) {
    this.projectService.start(project.id).subscribe({
      next: () => this.loadProjects(),
      error: (error) => this.message.set(error.error?.message ?? 'Start failed')
    });
  }

  stop(project: ProjectRecord) {
    this.projectService.stop(project.id).subscribe({
      next: () => this.loadProjects(),
      error: (error) => this.message.set(error.error?.message ?? 'Stop failed')
    });
  }

  statusPill(status: string): string {
    const map: Record<string, string> = {
      RUNNING: 'pill pill-emerald',
      STOPPED: 'pill pill-slate',
      PENDING_APPROVAL: 'pill pill-amber',
      DEPLOYING: 'pill pill-violet',
      REJECTED: 'pill pill-red'
    };
    return map[status] ?? 'pill pill-slate';
  }

  ramPercent(project: ProjectRecord): number {
    const limit = parseInt(project.quota.memory) || 512;
    return Math.min(100, (project.ramUsageMb / limit) * 100);
  }
}
