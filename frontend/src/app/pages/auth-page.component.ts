import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="page">
      <div class="container auth-layout">
        <!-- Left side -->
        <article class="panel panel-glow auth-side">
          <span class="pill pill-indigo">Secure Access</span>
          <h1 class="section-title" style="margin-top: 18px;">Welcome to CloudBase</h1>
          <p class="section-desc">
            Sign in to manage your deployments, monitor container resources,
            and access your private cloud dashboard.
          </p>

          <div style="margin-top: 32px;">
            <p class="section-label">Demo Accounts</p>
            <div class="panel" style="padding: 20px; margin-top: 12px;">
              <div style="margin-bottom: 16px;">
                <span class="pill pill-violet" style="margin-bottom: 8px;">Admin</span>
                <div class="muted"><code>admin&#64;cloudbase.dev</code> / <code>Admin&#64;2026</code></div>
              </div>
              <div>
                <span class="pill pill-emerald" style="margin-bottom: 8px;">Developer</span>
                <div class="muted"><code>dev&#64;cloudbase.dev</code> / <code>Dev&#64;2026</code></div>
              </div>
            </div>
            <div style="display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap;">
              <button class="btn btn-ghost btn-sm" (click)="fillAdmin()">Use Admin Account</button>
              <button class="btn btn-ghost btn-sm" (click)="fillUser()">Use Developer Account</button>
            </div>
          </div>
        </article>

        <!-- Right side - form -->
        <article class="panel auth-form-panel">
          <div class="tabs" style="max-width: 280px;">
            <button type="button" class="tab" [class.active]="mode() === 'login'" (click)="setMode('login')">Login</button>
            <button type="button" class="tab" [class.active]="mode() === 'register'" (click)="setMode('register')">Sign Up</button>
          </div>

          <h2 style="margin: 24px 0 8px; font-size: 1.5rem;">
            {{ mode() === 'login' ? 'Sign in to your account' : 'Create a new account' }}
          </h2>
          <p class="muted" style="margin: 0 0 28px; font-size: 14px;">
            {{ mode() === 'login' ? 'Enter your credentials to access the platform.' : 'Register to request deployment access from an admin.' }}
          </p>

          <form class="grid" style="gap: 18px;" [formGroup]="form" (ngSubmit)="submit()">
            <div class="field" *ngIf="mode() === 'register'">
              <label>Full Name</label>
              <input formControlName="name" placeholder="John Developer">
            </div>
            <div class="field">
              <label>Email Address</label>
              <input formControlName="email" type="email" placeholder="you&#64;example.com">
            </div>
            <div class="field">
              <label>Password</label>
              <input formControlName="password" type="password" placeholder="••••••••">
            </div>

            <div *ngIf="message()" [class]="messageKind() === 'error' ? 'pill pill-red' : 'pill pill-emerald'" style="padding: 12px 16px; border-radius: 12px;">
              {{ message() }}
            </div>

            <button class="btn btn-primary btn-lg" [disabled]="form.invalid || loading()" style="width: 100%; margin-top: 8px;">
              {{ loading() ? 'Processing...' : mode() === 'login' ? 'Sign In' : 'Create Account' }}
            </button>
          </form>
        </article>
      </div>
    </div>
  `
})
export class AuthPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly mode = signal<'login' | 'register'>('login');
  readonly loading = signal(false);
  readonly message = signal('');
  readonly messageKind = signal<'success' | 'error'>('success');

  readonly form = this.fb.group({
    name: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  ngOnInit() {
    this.route.queryParamMap.subscribe((params) => {
      const requestedMode = params.get('mode');
      if (requestedMode === 'register' || requestedMode === 'login') {
        this.mode.set(requestedMode);
      }
    });
  }

  setMode(mode: 'login' | 'register') {
    this.mode.set(mode);
    this.message.set('');
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode },
      replaceUrl: true
    });
  }

  fillAdmin() {
    this.setMode('login');
    this.form.patchValue({ email: 'admin@cloudbase.dev', password: 'Admin@2026' });
  }

  fillUser() {
    this.setMode('login');
    this.form.patchValue({ email: 'dev@cloudbase.dev', password: 'Dev@2026' });
  }

  submit() {
    this.loading.set(true);
    this.message.set('');

    const request$ = this.mode() === 'login'
      ? this.auth.login({
          email: this.form.value.email ?? '',
          password: this.form.value.password ?? ''
        })
      : this.auth.register({
          name: this.form.value.name ?? '',
          email: this.form.value.email ?? '',
          password: this.form.value.password ?? ''
        });

    request$.subscribe({
      next: (response) => {
        this.loading.set(false);
        this.messageKind.set('success');
        this.message.set(response.message);
        setTimeout(() => {
          this.router.navigateByUrl(response.user.role === 'ADMIN' ? '/admin' : '/dashboard');
        }, 600);
      },
      error: (error) => {
        this.loading.set(false);
        this.messageKind.set('error');
        this.message.set(error.error?.message ?? error.message ?? 'Request failed');
      }
    });
  }
}
