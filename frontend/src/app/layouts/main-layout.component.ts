import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ButtonModule } from 'primeng/button';
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
    ButtonModule,
    HasRoleDirective,
    PressableDirective
  ],
  template: `
    <header class="navbar">
      <div class="container navbar-inner">
        <span *appHasRole="'ADMIN'" class="navbar-brand navbar-brand-static">
          <app-icon name="cloud" tone="violet" size="sm"></app-icon>
          CloudBase
        </span>
        <a *appHasRole="'GUEST'" routerLink="/" class="navbar-brand" appPressable (click)="closeMenu()">
          <app-icon name="cloud" tone="violet" size="sm"></app-icon>
          CloudBase
        </a>
        <a *appHasRole="'USER'" routerLink="/" class="navbar-brand" appPressable (click)="closeMenu()">
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
          <nav class="navbar-links">
            <a *appHasRole="'USER'" routerLink="/dashboard" routerLinkActive="active" class="nav-link" (click)="closeMenu()">Dashboard</a>
            <a *appHasRole="'USER'" routerLink="/billing" routerLinkActive="active" class="nav-link" (click)="closeMenu()">Billing</a>
            <a *appHasRole="'USER'" routerLink="/help" routerLinkActive="active" class="nav-link" (click)="closeMenu()">Help</a>
            <a *appHasRole="'USER'" routerLink="/account" routerLinkActive="active" class="nav-link" (click)="closeMenu()">Account</a>
          </nav>

          <div class="navbar-actions">
            <ng-container *appHasRole="'GUEST'">
              <a routerLink="/auth" [queryParams]="{ mode: 'login' }" class="btn btn-ghost btn-sm" appPressable (click)="closeMenu()">Login</a>
              <p-button label="Sign Up" styleClass="p-button-sm" (onClick)="goRegister()" />
            </ng-container>
            <ng-container *appHasRole="'AUTH'">
              <app-notification-bell *appHasRole="'USER'"></app-notification-bell>
              <a *appHasRole="'USER'" routerLink="/account" class="pill pill-indigo navbar-user" (click)="closeMenu()">{{ auth.user()?.name }}</a>
              <a *appHasRole="'ADMIN'" routerLink="/admin" class="pill pill-red navbar-user" (click)="closeMenu()">{{ auth.user()?.name }}</a>
              <p-button label="Logout" severity="secondary" [outlined]="true" styleClass="p-button-sm" (onClick)="logout()" />
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
  `
})
export class MainLayoutComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly menuOpen = signal(false);

  readonly contactEmail = 'eid.rawwaf@gmail.com';
  readonly contactPhone = '+966 56 962 9218';
  readonly contactPhoneHref = '+966569629218';
  readonly linkedInUrl = 'https://www.linkedin.com/in/eid-rawaf-alrashidi-09b260256';

  constructor() {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.closeMenu());
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
