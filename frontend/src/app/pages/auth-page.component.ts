import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { AuthService } from '../core/auth.service';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset' | 'verify';
type FieldName = 'name' | 'email' | 'password' | 'confirmPassword' | 'code';

interface DemoAccount {
  id: 'admin' | 'developer';
  label: string;
  email: string;
  password: string;
  pill: string;
}

/** Stricter than Angular's default email validator. */
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/** Min 8, upper, lower, digit, special — matches demo passwords like Admin@2026. */
const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#._-]).{8,}$/;

function passwordMatchValidator(passwordKey: string, confirmKey: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const password = group.get(passwordKey);
    const confirm = group.get(confirmKey);
    if (!password || !confirm) return null;
    if (!confirm.value) return null;
    if (password.value !== confirm.value) {
      confirm.setErrors({ ...(confirm.errors ?? {}), mismatch: true });
      return { mismatch: true };
    }
    if (confirm.hasError('mismatch')) {
      const { mismatch: _removed, ...rest } = confirm.errors ?? {};
      confirm.setErrors(Object.keys(rest).length ? rest : null);
    }
    return null;
  };
}

@Component({
  selector: 'app-auth-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="page">
      <div class="container auth-layout">
        <aside class="panel auth-side">
          <p class="section-label">Secure Access</p>
          <h1 class="section-title">Welcome to CloudBase</h1>
          <p class="section-desc">
            Sign in to manage deployments, monitor containers, and access your private cloud dashboard.
          </p>

          <div class="auth-demo-list">
            <p class="field-label">Demo accounts</p>
            @for (account of demos; track account.id) {
              <button type="button" class="auth-demo-row" (click)="fillDemo(account)">
                <span class="pill" [class]="account.pill">{{ account.label }}</span>
                <span class="auth-demo-creds">
                  <code>{{ account.email }}</code>
                  <span class="muted"> / </span>
                  <code>{{ account.password }}</code>
                </span>
              </button>
            }
          </div>
        </aside>

        <section class="panel auth-form-panel">
          <nav class="auth-tabs" role="tablist" aria-label="Auth mode">
            @for (item of modes; track item.id) {
              <button
                type="button"
                role="tab"
                class="auth-tab"
                [class.is-active]="mode() === item.id"
                [attr.aria-selected]="mode() === item.id"
                (click)="setMode(item.id)"
              >
                {{ item.label }}
              </button>
            }
          </nav>

          <h2 class="auth-form-title">{{ copy().title }}</h2>
          <p class="muted auth-form-sub">{{ copy().subtitle }}</p>

          <form class="auth-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
            @if (mode() === 'register') {
              <div class="field">
                <label for="auth-name">Full name</label>
                <input id="auth-name" formControlName="name" autocomplete="name" placeholder="Eid Alrashidi" />
                @if (showError('name')) {
                  <small class="auth-error">{{ fieldError('name') }}</small>
                }
              </div>
            }

            @if (mode() !== 'reset') {
              <div class="field">
                <label for="auth-email">Email</label>
                <input
                  id="auth-email"
                  type="email"
                  formControlName="email"
                  autocomplete="email"
                  placeholder="you@company.com"
                  [readonly]="mode() === 'verify'"
                />
                @if (showError('email')) {
                  <small class="auth-error">{{ fieldError('email') }}</small>
                }
              </div>
            }

            @if (mode() === 'verify') {
              <div class="field">
                <label for="auth-code">Verification code</label>
                <input
                  id="auth-code"
                  formControlName="code"
                  inputmode="numeric"
                  maxlength="6"
                  placeholder="123456"
                  autocomplete="one-time-code"
                />
                @if (showError('code')) {
                  <small class="auth-error">{{ fieldError('code') }}</small>
                }
              </div>
            }

            @if (mode() !== 'forgot' && mode() !== 'verify') {
              <div class="field">
                <div class="auth-label-row">
                  <label for="auth-password">{{ mode() === 'reset' ? 'New password' : 'Password' }}</label>
                  @if (mode() === 'login') {
                    <button type="button" class="auth-link" (click)="setMode('forgot')">Forgot?</button>
                  }
                </div>
                <div class="password-wrap">
                  <input
                    id="auth-password"
                    [type]="showPassword() ? 'text' : 'password'"
                    formControlName="password"
                    [attr.autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    class="password-toggle"
                    (click)="toggleShowPassword()"
                    [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'"
                  >
                    @if (showPassword()) {
                      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">
                        <path d="M3 3l18 18" />
                        <path d="M10.6 10.6a2 2 0 002.8 2.8" />
                        <path d="M9.9 5.1A9.8 9.8 0 0112 5c5 0 9.3 3.1 11 7-0.6 1.4-1.5 2.7-2.7 3.7" />
                        <path d="M6.1 6.1C4.2 7.4 2.7 9.2 1.5 12c1.7 3.9 6 7 10.5 7 1.4 0 2.8-.3 4-.8" />
                      </svg>
                    } @else {
                      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">
                        <path d="M1.5 12C3.2 8.1 7.5 5 12 5s8.8 3.1 10.5 7c-1.7 3.9-6 7-10.5 7S3.2 15.9 1.5 12z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    }
                  </button>
                </div>
                @if (showError('password')) {
                  <small class="auth-error">{{ fieldError('password') }}</small>
                }
                @if (mode() === 'register' || mode() === 'reset') {
                  <ul class="password-rules" aria-label="Password requirements">
                    <li [class.ok]="liveRules.length">At least 8 characters</li>
                    <li [class.ok]="liveRules.upper">One uppercase letter</li>
                    <li [class.ok]="liveRules.lower">One lowercase letter</li>
                    <li [class.ok]="liveRules.digit">One number</li>
                    <li [class.ok]="liveRules.special">One special character (&#64; $ ! % * ? # . _ -)</li>
                  </ul>
                }
              </div>
            }

            @if (mode() === 'register' || mode() === 'reset') {
              <div class="field">
                <label for="auth-confirm">Confirm password</label>
                <div class="password-wrap">
                  <input
                    id="auth-confirm"
                    [type]="showConfirmPassword() ? 'text' : 'password'"
                    formControlName="confirmPassword"
                    autocomplete="new-password"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    class="password-toggle"
                    (click)="toggleShowConfirmPassword()"
                    [attr.aria-label]="showConfirmPassword() ? 'Hide confirm password' : 'Show confirm password'"
                  >
                    @if (showConfirmPassword()) {
                      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">
                        <path d="M3 3l18 18" />
                        <path d="M10.6 10.6a2 2 0 002.8 2.8" />
                        <path d="M9.9 5.1A9.8 9.8 0 0112 5c5 0 9.3 3.1 11 7-0.6 1.4-1.5 2.7-2.7 3.7" />
                        <path d="M6.1 6.1C4.2 7.4 2.7 9.2 1.5 12c1.7 3.9 6 7 10.5 7 1.4 0 2.8-.3 4-.8" />
                      </svg>
                    } @else {
                      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">
                        <path d="M1.5 12C3.2 8.1 7.5 5 12 5s8.8 3.1 10.5 7c-1.7 3.9-6 7-10.5 7S3.2 15.9 1.5 12z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    }
                  </button>
                </div>
                @if (showError('confirmPassword')) {
                  <small class="auth-error">{{ fieldError('confirmPassword') }}</small>
                }
              </div>
            }

            @if (feedback()) {
              <div
                class="pill"
                [class.pill-emerald]="feedback()!.kind === 'success'"
                [class.pill-red]="feedback()!.kind === 'error'"
              >
                {{ feedback()!.text }}
              </div>
            }

            <button type="submit" class="btn btn-primary auth-submit" [disabled]="loading()">
              {{ submitLabel() }}
            </button>

            @if (mode() === 'verify') {
              <button
                type="button"
                class="btn btn-ghost auth-submit"
                [disabled]="loading()"
                (click)="resendCode()"
              >
                Resend code
              </button>
            }
          </form>

          <p class="auth-switch muted">
            @if (mode() === 'login') {
              New here?
              <button type="button" class="auth-link" (click)="setMode('register')">Create account</button>
            } @else if (mode() === 'register') {
              Already have access?
              <button type="button" class="auth-link" (click)="setMode('login')">Sign in</button>
            } @else if (mode() === 'verify') {
              Wrong email?
              <button type="button" class="auth-link" (click)="setMode('register')">Register again</button>
            } @else {
              Remembered it?
              <button type="button" class="auth-link" (click)="setMode('login')">Back to sign in</button>
            }
          </p>
        </section>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .auth-demo-list {
      display: grid;
      gap: 10px;
      margin-top: 28px;
    }

    .field-label {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted-light);
      letter-spacing: 0.04em;
    }

    .auth-demo-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      width: 100%;
      text-align: left;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid rgba(148, 163, 184, 0.14);
      background: rgba(2, 6, 23, 0.35);
      color: inherit;
      cursor: pointer;
      transition: border-color 0.15s ease, background 0.15s ease;
    }

    .auth-demo-row:hover {
      border-color: rgba(99, 102, 241, 0.35);
      background: rgba(99, 102, 241, 0.06);
    }

    .auth-demo-creds {
      font-size: 12px;
      color: var(--muted-light);
    }

    .auth-tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 22px;
      padding: 4px;
      border-radius: 12px;
      background: rgba(2, 6, 23, 0.45);
      border: 1px solid rgba(148, 163, 184, 0.1);
    }

    .auth-tab {
      flex: 1;
      border: 0;
      background: transparent;
      color: var(--muted-light);
      font-size: 13px;
      font-weight: 600;
      padding: 9px 8px;
      border-radius: 9px;
      cursor: pointer;
    }

    .auth-tab.is-active {
      background: rgba(99, 102, 241, 0.2);
      color: #e2e8f0;
    }

    .auth-form-title {
      margin: 0 0 6px;
      font-size: 1.35rem;
      letter-spacing: -0.02em;
    }

    .auth-form-sub {
      margin: 0 0 22px;
      font-size: 0.92rem;
    }

    .auth-form {
      display: grid;
      gap: 16px;
    }

    .auth-label-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .auth-label-row label { margin: 0; }

    .password-wrap {
      position: relative;
      display: block;
    }

    .password-wrap input {
      width: 100%;
      padding-right: 44px;
    }

    .password-toggle {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      border: 0;
      background: transparent;
      color: var(--muted-light);
      cursor: pointer;
      padding: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .password-toggle:hover { color: var(--text); }

    .password-rules {
      list-style: none;
      margin: 4px 0 0;
      padding: 0;
      display: grid;
      gap: 4px;
      font-size: 11px;
      color: #64748b;
    }

    .password-rules li.ok { color: #34d399; }

    .auth-link {
      border: 0;
      background: transparent;
      color: var(--primary-light);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      padding: 0;
    }

    .auth-link:hover { text-decoration: underline; }

    .auth-error {
      color: #fca5a5;
      font-size: 12px;
    }

    .auth-submit {
      width: 100%;
      margin-top: 4px;
    }

    .auth-switch {
      margin: 20px 0 0;
      text-align: center;
      font-size: 0.88rem;
    }
  `]
})
export class AuthPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly modes: ReadonlyArray<{ id: AuthMode; label: string }> = [
    { id: 'login', label: 'Sign in' },
    { id: 'register', label: 'Sign up' },
    { id: 'forgot', label: 'Reset' }
  ];

  readonly demos: ReadonlyArray<DemoAccount> = [
    {
      id: 'admin',
      label: 'Admin',
      email: 'admin@cloudbase.dev',
      password: 'Admin@2026',
      pill: 'pill-violet'
    },
    {
      id: 'developer',
      label: 'Developer',
      email: 'dev@cloudbase.dev',
      password: 'Dev@2026',
      pill: 'pill-emerald'
    }
  ];

  readonly mode = signal<AuthMode>('login');
  readonly loading = signal(false);
  readonly feedback = signal<{ kind: 'success' | 'error'; text: string } | null>(null);
  readonly submitted = signal(false);
  readonly resetToken = signal('');
  readonly showPassword = signal(false);
  readonly showConfirmPassword = signal(false);

  readonly form = this.fb.nonNullable.group(
    {
      name: [''],
      email: ['', [Validators.required, Validators.pattern(EMAIL_PATTERN)]],
      password: ['', [Validators.required]],
      confirmPassword: [''],
      code: ['']
    },
    { validators: passwordMatchValidator('password', 'confirmPassword') }
  );

  readonly copy = computed(() => {
    switch (this.mode()) {
      case 'register':
        return {
          title: 'Create your account',
          subtitle: 'We’ll email a 6-digit code to verify your address.'
        };
      case 'verify':
        return {
          title: 'Verify your email',
          subtitle: 'Enter the 6-digit code we sent to confirm this inbox is yours.'
        };
      case 'forgot':
        return {
          title: 'Reset your password',
          subtitle: 'We’ll email a secure reset link if the account exists.'
        };
      case 'reset':
        return {
          title: 'Choose a new password',
          subtitle: 'Enter a strong password, then confirm it.'
        };
      default:
        return {
          title: 'Sign in to your account',
          subtitle: 'Enter your credentials to access the platform.'
        };
    }
  });

  readonly submitLabel = computed(() => {
    if (this.loading()) return 'Please wait…';
    switch (this.mode()) {
      case 'register':
        return 'Create account';
      case 'verify':
        return 'Verify email';
      case 'forgot':
        return 'Send reset link';
      case 'reset':
        return 'Update password';
      default:
        return 'Sign in';
    }
  });

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const token = params.get('token') ?? '';
      const requested = params.get('mode');
      if (requested === 'reset' || token) {
        this.resetToken.set(token);
        this.applyMode('reset', false);
        return;
      }
      if (requested === 'verify') {
        const email = params.get('email');
        if (email) this.form.patchValue({ email });
        this.applyMode('verify', false);
        return;
      }
      if (requested === 'login' || requested === 'register' || requested === 'forgot') {
        this.applyMode(requested, false);
      } else {
        this.syncValidators('login');
      }
    });
  }

  passwordRules(value: string) {
    return {
      length: value.length >= 8,
      upper: /[A-Z]/.test(value),
      lower: /[a-z]/.test(value),
      digit: /\d/.test(value),
      special: /[@$!%*?&#._-]/.test(value)
    };
  }

  /** Live checklist bound to current password control. */
  get liveRules() {
    return this.passwordRules(this.form.controls.password.value ?? '');
  }

  setMode(mode: AuthMode): void {
    this.applyMode(mode, true);
  }

  toggleShowPassword(): void {
    this.showPassword.update((v) => !v);
  }

  toggleShowConfirmPassword(): void {
    this.showConfirmPassword.update((v) => !v);
  }

  fillDemo(account: DemoAccount): void {
    this.applyMode('login', true);
    this.form.patchValue({
      email: account.email,
      password: account.password,
      confirmPassword: account.password
    });
    this.form.markAsPristine();
    this.submitted.set(false);
    this.feedback.set(null);
  }

  showError(controlName: FieldName): boolean {
    const control = this.form.controls[controlName];
    return control.invalid && (control.touched || this.submitted());
  }

  fieldError(controlName: FieldName): string {
    const control = this.form.controls[controlName];
    const errors = control.errors;
    if (!errors) return '';

    if (controlName === 'name') {
      if (errors['required']) return 'Full name is required.';
      if (errors['minlength']) return 'Name must be at least 2 characters.';
    }
    if (controlName === 'email') {
      if (errors['required']) return 'Email is required.';
      if (errors['pattern'] || errors['email']) return 'Enter a valid email like name@domain.com.';
    }
    if (controlName === 'password') {
      if (errors['required']) return 'Password is required.';
      if (errors['minlength']) return 'Password must be at least 8 characters.';
      if (errors['pattern']) {
        return 'Password needs upper, lower, number, and special character.';
      }
    }
    if (controlName === 'confirmPassword') {
      if (errors['required']) return 'Please confirm your password.';
      if (errors['mismatch']) return 'Passwords do not match.';
    }
    if (controlName === 'code') {
      if (errors['required']) return 'Verification code is required.';
      if (errors['pattern']) return 'Enter the 6-digit code from your email.';
    }
    return 'Invalid value.';
  }

  resendCode(): void {
    const email = this.form.controls.email.value;
    if (!email) return;
    this.loading.set(true);
    this.feedback.set(null);
    this.auth
      .resendVerification(email)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false))
      )
      .subscribe({
        next: (res) => this.feedback.set({ kind: 'success', text: res.message }),
        error: (err) => this.feedback.set({ kind: 'error', text: this.readError(err) })
      });
  }

  submit(): void {
    this.submitted.set(true);
    this.feedback.set(null);
    this.syncValidators(this.mode());
    this.form.updateValueAndValidity();

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { name, email, password, code } = this.form.getRawValue();
    this.loading.set(true);

    if (this.mode() === 'forgot') {
      this.auth
        .forgotPassword(email)
        .pipe(
          takeUntilDestroyed(this.destroyRef),
          finalize(() => this.loading.set(false))
        )
        .subscribe({
          next: (res) => this.feedback.set({ kind: 'success', text: res.message }),
          error: (err) => this.feedback.set({ kind: 'error', text: this.readError(err) })
        });
      return;
    }

    if (this.mode() === 'reset') {
      const token = this.resetToken();
      if (!token) {
        this.loading.set(false);
        this.feedback.set({ kind: 'error', text: 'Missing reset token. Open the link from your email.' });
        return;
      }
      this.auth
        .resetPassword(token, password)
        .pipe(
          takeUntilDestroyed(this.destroyRef),
          finalize(() => this.loading.set(false))
        )
        .subscribe({
          next: (res) => {
            this.feedback.set({ kind: 'success', text: res.message });
            this.applyMode('login', true);
          },
          error: (err) => this.feedback.set({ kind: 'error', text: this.readError(err) })
        });
      return;
    }

    if (this.mode() === 'verify') {
      this.auth
        .verifyEmail(email, code.trim())
        .pipe(
          takeUntilDestroyed(this.destroyRef),
          finalize(() => this.loading.set(false))
        )
        .subscribe({
          next: (res) => {
            this.feedback.set({ kind: 'success', text: res.message });
            this.applyMode('login', true);
          },
          error: (err) => this.feedback.set({ kind: 'error', text: this.readError(err) })
        });
      return;
    }

    const request$ =
      this.mode() === 'login'
        ? this.auth.login({ email, password })
        : this.auth.register({ name: name.trim(), email, password });

    request$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false))
      )
      .subscribe({
        next: (response) => {
          this.feedback.set({ kind: 'success', text: response.message });
          if (response.token) {
            const target = response.user.role === 'ADMIN' ? '/admin' : '/dashboard';
            window.setTimeout(() => this.router.navigateByUrl(target), 400);
          } else if (this.mode() === 'register') {
            this.form.patchValue({ code: '' });
            this.applyMode('verify', true);
          } else {
            this.applyMode('login', true);
          }
        },
        error: (err) => this.feedback.set({ kind: 'error', text: this.readError(err) })
      });
  }

  private applyMode(mode: AuthMode, navigate: boolean): void {
    this.mode.set(mode);
    this.submitted.set(false);
    this.showPassword.set(false);
    this.showConfirmPassword.set(false);
    if (mode !== 'verify') {
      this.feedback.set(null);
    }
    this.syncValidators(mode);

    if (navigate) {
      const queryParams: Record<string, string> = { mode };
      if (mode === 'reset' && this.resetToken()) {
        queryParams['token'] = this.resetToken();
      }
      if (mode === 'verify' && this.form.controls.email.value) {
        queryParams['email'] = this.form.controls.email.value;
      }
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams,
        replaceUrl: true
      });
    }
  }

  private syncValidators(mode: AuthMode): void {
    const name = this.form.controls.name;
    const email = this.form.controls.email;
    const password = this.form.controls.password;
    const confirm = this.form.controls.confirmPassword;
    const code = this.form.controls.code;

    name.clearValidators();
    email.clearValidators();
    password.clearValidators();
    confirm.clearValidators();
    code.clearValidators();

    if (mode === 'register') {
      name.setValidators([Validators.required, Validators.minLength(2)]);
      email.setValidators([Validators.required, Validators.pattern(EMAIL_PATTERN)]);
      password.setValidators([Validators.required, Validators.pattern(STRONG_PASSWORD)]);
      confirm.setValidators([Validators.required]);
    } else if (mode === 'verify') {
      email.setValidators([Validators.required, Validators.pattern(EMAIL_PATTERN)]);
      code.setValidators([Validators.required, Validators.pattern(/^\d{6}$/)]);
    } else if (mode === 'reset') {
      password.setValidators([Validators.required, Validators.pattern(STRONG_PASSWORD)]);
      confirm.setValidators([Validators.required]);
    } else if (mode === 'forgot') {
      email.setValidators([Validators.required, Validators.pattern(EMAIL_PATTERN)]);
      password.setValue('');
      confirm.setValue('');
    } else {
      email.setValidators([Validators.required, Validators.pattern(EMAIL_PATTERN)]);
      password.setValidators([Validators.required, Validators.minLength(6)]);
    }

    name.updateValueAndValidity({ emitEvent: false });
    email.updateValueAndValidity({ emitEvent: false });
    password.updateValueAndValidity({ emitEvent: false });
    confirm.updateValueAndValidity({ emitEvent: false });
    code.updateValueAndValidity({ emitEvent: false });
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  private readError(error: unknown): string {
    const err = error as { error?: { message?: string }; message?: string };
    return err?.error?.message ?? err?.message ?? 'Request failed';
  }
}
