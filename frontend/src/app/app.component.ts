import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { NgxSpinnerModule } from 'ngx-spinner';
import { ButtonModule } from 'primeng/button';
import { AuthService } from './core/auth.service';
import { IconComponent } from './shared/icon.component';
import { NotificationBellComponent } from './shared/notification-bell.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    IconComponent,
    NotificationBellComponent,
    NgxSpinnerModule,
    ButtonModule
  ],
  template: `
    <ngx-spinner
      name="api"
      bdColor="rgba(2,6,23,0.72)"
      color="#a5b4fc"
      size="medium"
      [fullScreen]="true"
    >
      <p class="spinner-caption">Waiting for backend…</p>
    </ngx-spinner>

    <header class="navbar">
      <div class="container navbar-inner">
        <span *ngIf="auth.isAdmin(); else publicBrand" class="navbar-brand navbar-brand-static">
          <app-icon name="cloud" tone="violet" size="sm"></app-icon>
          CloudBase
        </span>
        <ng-template #publicBrand>
          <a routerLink="/" class="navbar-brand" (click)="closeMenu()">
            <app-icon name="cloud" tone="violet" size="sm"></app-icon>
            CloudBase
          </a>
        </ng-template>

        <button
          type="button"
          class="navbar-toggle"
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
            <a *ngIf="auth.isAuthenticated() && !auth.isAdmin()" routerLink="/dashboard" routerLinkActive="active" class="nav-link" (click)="closeMenu()">Dashboard</a>
            <a *ngIf="auth.isAuthenticated() && !auth.isAdmin()" routerLink="/billing" routerLinkActive="active" class="nav-link" (click)="closeMenu()">Billing</a>
            <a *ngIf="auth.isAuthenticated() && !auth.isAdmin()" routerLink="/help" routerLinkActive="active" class="nav-link" (click)="closeMenu()">Help</a>
            <a *ngIf="auth.isAuthenticated() && !auth.isAdmin()" routerLink="/account" routerLinkActive="active" class="nav-link" (click)="closeMenu()">Account</a>
          </nav>

          <div class="navbar-actions">
            <ng-container *ngIf="!auth.isAuthenticated(); else loggedIn">
              <a routerLink="/auth" [queryParams]="{ mode: 'login' }" class="btn btn-ghost btn-sm" (click)="closeMenu()">Login</a>
              <p-button label="Sign Up" styleClass="p-button-sm" (onClick)="goRegister()" />
            </ng-container>
            <ng-template #loggedIn>
              <app-notification-bell *ngIf="!auth.isAdmin()"></app-notification-bell>
              <a *ngIf="!auth.isAdmin()" routerLink="/account" class="pill pill-indigo navbar-user" (click)="closeMenu()">{{ auth.user()?.name }}</a>
              <span *ngIf="auth.isAdmin()" class="pill pill-red navbar-user">{{ auth.user()?.name }}</span>
              <p-button label="Logout" severity="secondary" [outlined]="true" styleClass="p-button-sm" (onClick)="logout()" />
            </ng-template>
          </div>
        </div>
      </div>
    </header>

    <router-outlet></router-outlet>

    <footer class="footer">
      <div class="container footer-inner">
        <span class="footer-copy">© 2026 CloudBase · Hosted locally on private secure hardware · All rights reserved</span>
        <div *ngIf="!auth.isAdmin()" id="contact" class="footer-contact">
          <a class="footer-contact-link" [href]="'mailto:' + contactEmail">
            <app-icon name="mail" tone="sky" size="sm"></app-icon>
            {{ contactEmail }}
          </a>
          <a class="footer-contact-link" [href]="'tel:' + contactPhoneHref">
            <app-icon name="phone" tone="emerald" size="sm"></app-icon>
            {{ contactPhone }}
          </a>
          <a
            class="footer-contact-link"
            [href]="linkedInUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            <app-icon name="linkedin" tone="indigo" size="sm"></app-icon>
            Eid Rawaf
          </a>
        </div>
      </div>
    </footer>
  `
})
export class AppComponent {
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
