import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ProjectService } from '../core/project.service';
import { IconComponent } from '../shared/icon.component';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, IconComponent],
  template: `
    <div class="page">
      <div class="container container-narrow">
        <p class="section-label">Deployment Wizard</p>
        <h1 class="section-title">Create a New Project</h1>
        <p class="section-desc" style="margin-bottom: 32px;">
          Connect your repository, choose a framework, and submit for admin approval.
          Once approved, your stack will be provisioned automatically.
        </p>

        <!-- Step indicators -->
        <div class="wizard-steps">
          <div class="wizard-step" [class.active]="step() === 1" [class.done]="step() > 1">
            <span class="step-num">1</span> Connect Repo
          </div>
          <div class="wizard-step" [class.active]="step() === 2" [class.done]="step() > 2">
            <span class="step-num">2</span> Configure
          </div>
          <div class="wizard-step" [class.active]="step() === 3" [class.done]="step() > 3">
            <span class="step-num">3</span> Review
          </div>
          <div class="wizard-step" [class.active]="step() === 4" [class.done]="submitted()">
            <span class="step-num">4</span> Submit
          </div>
        </div>

        <article class="panel panel-glow" style="padding: 36px;">
          <!-- Step 1 -->
          <div *ngIf="step() === 1">
            <h3 style="margin: 0 0 8px;">Repository Details</h3>
            <p class="muted" style="margin: 0 0 24px; font-size: 14px;">Enter your GitHub repository information.</p>
            <div class="grid grid-2">
              <div class="field">
                <label>Project Name</label>
                <input [(ngModel)]="draft.name" [ngModelOptions]="{standalone: true}" placeholder="portfolio-website">
              </div>
              <div class="field">
                <label>Repository URL</label>
                <input [(ngModel)]="draft.repository" [ngModelOptions]="{standalone: true}" placeholder="github.com/user/repo">
              </div>
            </div>
            <button class="btn btn-primary" style="margin-top: 24px;" (click)="nextStep()">Continue →</button>
          </div>

          <!-- Step 2 -->
          <div *ngIf="step() === 2">
            <h3 style="margin: 0 0 8px;">Framework & Branch</h3>
            <p class="muted" style="margin: 0 0 24px; font-size: 14px;">Select your application stack and deployment branch.</p>
            <div class="grid grid-2">
              <div class="field">
                <label>Framework</label>
                <select [(ngModel)]="draft.framework" [ngModelOptions]="{standalone: true}">
                  <option value="angular">Angular 18+</option>
                  <option value="react">React 18</option>
                  <option value="vue">Vue.js 3</option>
                  <option value="node">Node.js 20</option>
                </select>
              </div>
              <div class="field">
                <label>Branch</label>
                <input [(ngModel)]="draft.branch" [ngModelOptions]="{standalone: true}" placeholder="main">
              </div>
              <div class="field" style="grid-column: 1 / -1;">
                <label>Subdomain</label>
                <input [(ngModel)]="draft.subdomain" [ngModelOptions]="{standalone: true}" placeholder="my-app.cloudbase.website">
              </div>
            </div>
            <div style="display: flex; gap: 12px; margin-top: 24px;">
              <button class="btn btn-ghost" (click)="step.set(1)">← Back</button>
              <button class="btn btn-primary" (click)="nextStep()">Continue →</button>
            </div>
          </div>

          <!-- Step 3 -->
          <div *ngIf="step() === 3">
            <h3 style="margin: 0 0 8px;">Review Configuration</h3>
            <p class="muted" style="margin: 0 0 24px; font-size: 14px;">Confirm your project settings before submitting.</p>
            <div class="grid grid-2">
              <div class="meta-box" *ngFor="let item of reviewItems">
                <strong>{{ item.label }}</strong>
                <span>{{ item.value }}</span>
              </div>
            </div>
            <div class="panel" style="padding: 16px; margin-top: 20px; background: rgba(245,158,11,0.06); border-color: rgba(245,158,11,0.2);">
              <span class="pill pill-amber">Pending Admin Approval</span>
              <p class="muted" style="margin: 10px 0 0; font-size: 13px;">
                Your project will enter <strong>PENDING_APPROVAL</strong> status until an admin assigns CPU & RAM quotas.
              </p>
            </div>
            <div style="display: flex; gap: 12px; margin-top: 24px;">
              <button class="btn btn-ghost" (click)="step.set(2)">← Back</button>
              <button class="btn btn-primary btn-with-icon" (click)="submitProject()" [disabled]="loading()">
                <app-icon *ngIf="!loading()" name="rocket" tone="violet" size="sm"></app-icon>
                {{ loading() ? 'Submitting...' : 'Submit Project Request' }}
              </button>
            </div>
          </div>

          <!-- Step 4 - Success -->
          <div *ngIf="step() === 4" style="text-align: center; padding: 20px 0;">
            <div class="empty-state-icon">
              <app-icon name="check-circle" tone="emerald" size="lg"></app-icon>
            </div>
            <h3 style="margin: 0 0 8px;">Project Submitted Successfully</h3>
            <p class="muted" style="margin: 0 0 8px;">{{ feedback() }}</p>
            <span class="pill pill-amber">Status: PENDING_ADMIN_APPROVAL</span>
            <p class="muted" style="margin: 20px 0 0; font-size: 13px;">
              An admin will review your request and assign resource quotas shortly.
            </p>
          </div>
        </article>
      </div>
    </div>
  `
})
export class WizardPageComponent {
  private readonly projectService = inject(ProjectService);

  readonly step = signal(1);
  readonly loading = signal(false);
  readonly submitted = signal(false);
  readonly feedback = signal('');

  draft = {
    name: 'portfolio-website',
    repository: 'github.com/dev/portfolio-website',
    framework: 'angular',
    branch: 'main',
    subdomain: 'portfolio.cloudbase.website'
  };

  get reviewItems() {
    return [
      { label: 'Project Name', value: this.draft.name },
      { label: 'Repository', value: this.draft.repository },
      { label: 'Framework', value: this.draft.framework },
      { label: 'Branch', value: this.draft.branch },
      { label: 'Subdomain', value: this.draft.subdomain },
      { label: 'Initial Quota', value: '512 MB / 0.5 vCPU (assigned by admin)' }
    ];
  }

  nextStep() {
    if (this.step() < 3) this.step.update(s => s + 1);
  }

  submitProject() {
    this.loading.set(true);
    this.projectService.create(this.draft).subscribe({
      next: (project) => {
        this.loading.set(false);
        this.submitted.set(true);
        this.feedback.set(`Created "${project.name}" — awaiting admin approval.`);
        this.step.set(4);
      },
      error: (error) => {
        this.loading.set(false);
        this.feedback.set(error.error?.message ?? error.message ?? 'Request failed');
      }
    });
  }
}
