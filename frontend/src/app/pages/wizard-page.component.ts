import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ProjectService } from '../core/project.service';
import { Project } from '../core/models';

type WizardStep = 1 | 2 | 3;

@Component({
  selector: 'app-wizard-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page">
      <div class="container container-narrow wizard-shell">
        <p class="section-label">New Project</p>
        <h1 class="section-title">Create a Project</h1>
        <p class="section-desc wizard-intro">
          A project is a canvas for your services. After creating it, you can add
          GitHub deployments, Docker images, and databases.
        </p>

        <div class="wizard-topbar">
          <div class="wizard-topbar-step" [class.done]="step() > 1" [class.active]="step() === 1">
            <span class="wizard-topbar-dot">{{ step() > 1 ? '✓' : '1' }}</span>
            <span>Details</span>
          </div>
          <div class="wizard-topbar-line"></div>
          <div class="wizard-topbar-step" [class.done]="step() > 2" [class.active]="step() === 2">
            <span class="wizard-topbar-dot">{{ step() > 2 ? '✓' : '2' }}</span>
            <span>Review</span>
          </div>
          <div class="wizard-topbar-line"></div>
          <div class="wizard-topbar-step" [class.done]="step() === 3" [class.active]="step() === 3">
            <span class="wizard-topbar-dot">{{ step() === 3 ? '✓' : '3' }}</span>
            <span>Done</span>
          </div>
        </div>

        <article class="panel wizard-panel">
          @if (feedback()) {
            <div
              class="pill"
              [class.pill-red]="feedbackKind() === 'error'"
              [class.pill-emerald]="feedbackKind() === 'success'"
              style="padding: 12px 16px; margin-bottom: 20px; border-radius: 12px;"
            >
              {{ feedback() }}
            </div>
          }

          @if (step() === 1) {
            <h3 class="wizard-section-title">Project Details</h3>
            <p class="wizard-section-desc">Give your project a name and optional description.</p>

            <div class="field" style="margin-bottom: 16px;">
              <label for="proj-name">Project Name <span class="required">*</span></label>
              <input
                id="proj-name"
                [(ngModel)]="draft.name"
                placeholder="maps-backend"
                autocomplete="off"
                (keydown.enter)="goStep2()"
              />
            </div>

            <div class="field" style="margin-bottom: 24px;">
              <label for="proj-desc">Description (optional)</label>
              <input
                id="proj-desc"
                [(ngModel)]="draft.description"
                placeholder="What does this project do?"
                (keydown.enter)="goStep2()"
              />
            </div>

            <div class="wizard-actions">
              <button type="button" class="btn btn-ghost" (click)="router.navigate(['/dashboard'])">Cancel</button>
              <button type="button" class="btn btn-primary" (click)="goStep2()" [disabled]="!draft.name.trim()">
                Continue →
              </button>
            </div>
          }

          @if (step() === 2) {
            <h3 class="wizard-section-title">Review &amp; Create</h3>

            <div class="review-list">
              <div class="review-item">
                <span class="review-label">Project Name</span>
                <span class="review-value">{{ draft.name }}</span>
              </div>
              @if (draft.description) {
                <div class="review-item">
                  <span class="review-label">Description</span>
                  <span class="review-value">{{ draft.description }}</span>
                </div>
              }
            </div>

            <p class="wizard-section-desc" style="margin-top:16px">
              Next you’ll open the project canvas and add your first service.
            </p>

            <div class="wizard-actions">
              <button type="button" class="btn btn-ghost" (click)="step.set(1)" [disabled]="loading()">← Back</button>
              <button type="button" class="btn btn-primary" (click)="submit()" [disabled]="loading()">
                {{ loading() ? 'Creating…' : 'Create Project' }}
              </button>
            </div>
          }

          @if (step() === 3) {
            <div class="wizard-success">
              <div class="wizard-success-icon">✓</div>
              <h3>Project Created</h3>
              <p><strong>{{ createdProject()?.name }}</strong> is ready.</p>
              <p class="empty-sub">Add a GitHub repo, Docker image, or database next.</p>

              <div class="wizard-actions" style="justify-content: center; margin-top: 24px">
                <button type="button" class="btn btn-primary" (click)="goToProject()">
                  Open Project →
                </button>
                <button type="button" class="btn btn-ghost" (click)="router.navigate(['/dashboard'])">
                  Dashboard
                </button>
              </div>
            </div>
          }
        </article>
      </div>
    </div>
  `,
})
export class WizardPageComponent {
  readonly router = inject(Router);
  private readonly projectService = inject(ProjectService);
  private readonly auth = inject(AuthService);

  step = signal<WizardStep>(1);
  loading = signal(false);
  feedback = signal('');
  feedbackKind = signal<'error' | 'success'>('error');
  createdProject = signal<Project | null>(null);

  draft = { name: '', description: '' };

  goStep2() {
    if (!this.draft.name.trim()) return;
    const user = this.auth.user();
    if (!user || user.accountStatus !== 'ACTIVE' || !user.deploymentEnabled) {
      this.feedback.set('Deployment access is required to create projects.');
      this.feedbackKind.set('error');
      return;
    }
    this.feedback.set('');
    this.step.set(2);
  }

  submit() {
    this.loading.set(true);
    this.feedback.set('');

    this.projectService.create({
      name: this.draft.name.trim(),
      description: this.draft.description.trim(),
    }).subscribe({
      next: project => {
        this.createdProject.set(project);
        this.loading.set(false);
        this.step.set(3);
      },
      error: err => {
        this.feedback.set(err?.error?.message ?? 'Failed to create project. Please try again.');
        this.feedbackKind.set('error');
        this.loading.set(false);
      }
    });
  }

  goToProject() {
    const p = this.createdProject();
    if (p) this.router.navigate(['/projects', p.id]);
  }
}
