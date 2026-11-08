import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../shared/icon.component';
import { NotificationBellComponent } from '../shared/notification-bell.component';
import { HasRoleDirective } from '../shared/directives/has-role.directive';
import { PressableDirective } from '../shared/directives/pressable.directive';

/**
 * Shell for marketing + authenticated developer pages (navbar + footer + page outlet).
 * Uses structural (*appHasRole) + attribute (appPressable) directives.
 */
@Component({
  selector: 'app-main-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    IconComponent,
    NotificationBellComponent,
    HasRoleDirective,
    PressableDirective
  ],
  template: `
    <div [class.app-shell-footer-hidden]="auth.isAuthenticated()">
    <header class="navbar">
      <div class="container navbar-inner">
        <a [routerLink]="auth.isAuthenticated() ? '/dashboard' : '/'" class="navbar-brand" appPressable
           (click)="closeMenu()" aria-label="CloudBase home">
          <app-icon name="cloud" tone="violet" size="sm"></app-icon>
          CloudBase
        </a>

        <button
          type="button"
          class="navbar-toggle"
          appPressable
          (click)="toggleMenu()"
          [attr.aria-expanded]="menuOpen()"
          aria-label="Toggle navigation menu"
        >
          <span class="navbar-toggle-bar"></span>
          <span class="navbar-toggle-bar"></span>
          <span class="navbar-toggle-bar"></span>
        </button>

        <div class="navbar-menu" [class.is-open]="menuOpen()">
          <nav class="navbar-links" aria-label="Main">
            <ng-container *appHasRole="'AUTH'">
              <a routerLink="/dashboard" routerLinkActive="active" ariaCurrentWhenActive="page" class="nav-link" (click)="closeMenu()">Projects</a>
              <a routerLink="/billing" routerLinkActive="active" ariaCurrentWhenActive="page" class="nav-link" (click)="closeMenu()">Usage</a>
              <a routerLink="/help" routerLinkActive="active" ariaCurrentWhenActive="page" class="nav-link" (click)="closeMenu()">Help</a>
              <a *appHasRole="'ADMIN'" routerLink="/admin" routerLinkActive="active" ariaCurrentWhenActive="page" class="nav-link nav-link-admin" (click)="closeMenu()">Admin</a>
            </ng-container>
          </nav>

          <div class="navbar-actions">
            <ng-container *appHasRole="'GUEST'">
              <a routerLink="/auth" [queryParams]="{ mode: 'login' }" class="btn btn-ghost btn-sm" appPressable (click)="closeMenu()">Sign in</a>
              <a routerLink="/auth" [queryParams]="{ mode: 'register' }" class="btn btn-primary btn-sm" appPressable (click)="closeMenu()">Get started</a>
            </ng-container>
            <ng-container *appHasRole="'AUTH'">
              <app-notification-bell></app-notification-bell>
              <a routerLink="/account" routerLinkActive="active" class="navbar-user" (click)="closeMenu()"
                 [attr.aria-label]="'Account settings for ' + (auth.user()?.name || 'you')">
                <span class="navbar-avatar" aria-hidden="true">{{ initials() }}</span>
                <span class="navbar-user-name">{{ auth.user()?.name }}</span>
              </a>
              <button type="button" class="btn btn-ghost btn-sm" appPressable (click)="logout()">Sign out</button>
            </ng-container>
          </div>
        </div>
      </div>
    </header>

    <main class="app-main">
      <router-outlet />
    </main>

    <footer class="footer">
      <div class="container footer-inner">
        <span class="footer-copy">© 2026 CloudBase · Hosted locally on private secure hardware · All rights reserved</span>
        <div *appHasRole="'GUEST'" id="contact" class="footer-contact">
          <a class="footer-contact-link" [href]="'mailto:' + contactEmail">
            <app-icon name="mail" tone="sky" size="sm"></app-icon>
            {{ contactEmail }}
          </a>
          <a class="footer-contact-link" [href]="'tel:' + contactPhoneHref">
            <app-icon name="phone" tone="emerald" size="sm"></app-icon>
            {{ contactPhone }}
          </a>
          <a class="footer-contact-link" [href]="linkedInUrl" target="_blank" rel="noopener noreferrer">
            <app-icon name="linkedin" tone="indigo" size="sm"></app-icon>
            Eid Rawaf
          </a>
        </div>
        <div *appHasRole="'USER'" id="contact-user" class="footer-contact">
          <a class="footer-contact-link" [href]="'mailto:' + contactEmail">
            <app-icon name="mail" tone="sky" size="sm"></app-icon>
            {{ contactEmail }}
          </a>
          <a class="footer-contact-link" [href]="'tel:' + contactPhoneHref">
            <app-icon name="phone" tone="emerald" size="sm"></app-icon>
            {{ contactPhone }}
          </a>
          <a class="footer-contact-link" [href]="linkedInUrl" target="_blank" rel="noopener noreferrer">
            <app-icon name="linkedin" tone="indigo" size="sm"></app-icon>
            Eid Rawaf
          </a>
        </div>
      </div>
    </footer>
    </div>
  `
})
export class MainLayoutComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly menuOpen = signal(false);

  readonly contactEmail = 'eid.rawwaf@gmail.com';
  readonly contactPhone = '0531957455';
  readonly contactPhoneHref = '+966531957455';
  readonly linkedInUrl = 'https://www.linkedin.com/in/eid-rawaf-alrashidi-09b260256';

  constructor() {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.closeMenu());
  }

  /** Up to two initials for the account button, e.g. "Eid Rawaf" -> "ER". */
  initials(): string {
    const parts = (this.auth.user()?.name || '').trim().split(/\s+/).filter(Boolean);
    const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
    return letters.toUpperCase();
  }

  toggleMenu() {
    this.menuOpen.update((open) => !open);
  }

  closeMenu() {
    this.menuOpen.set(false);
  }

  goRegister() {
    this.closeMenu();
    this.router.navigate(['/auth'], { queryParams: { mode: 'register' } });
  }

  logout() {
    this.auth.logout();
    this.closeMenu();
    this.router.navigateByUrl('/');
  }
}
