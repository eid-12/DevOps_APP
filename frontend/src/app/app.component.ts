import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from './core/auth.service';
import { IconComponent } from './shared/icon.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  template: `
    <header class="navbar">
      <div class="container navbar-inner">
        <a *ngIf="auth.isAdmin(); else publicBrand" routerLink="/admin" class="navbar-brand" (click)="closeMenu()">
          <app-icon name="cloud" tone="violet" size="sm"></app-icon>
          CloudBase
        </a>
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
            <a *ngIf="!auth.isAdmin()" routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" class="nav-link nav-home" (click)="closeMenu()">
              <app-icon name="home" tone="indigo" size="sm"></app-icon>
              Home
            </a>
            <a *ngIf="!auth.isAdmin()" class="nav-link nav-contact" href="#contact" (click)="scrollToContact($event)">
              <app-icon name="mail" tone="sky" size="sm"></app-icon>
              Contact
            </a>

            <a *ngIf="auth.isAuthenticated() && !auth.isAdmin()" routerLink="/wizard" routerLinkActive="active" class="nav-link" (click)="closeMenu()">Deploy</a>
            <a *ngIf="auth.isAuthenticated() && !auth.isAdmin()" routerLink="/dashboard" routerLinkActive="active" class="nav-link" (click)="closeMenu()">Dashboard</a>
          </nav>

          <div class="navbar-actions">
            <ng-container *ngIf="!auth.isAuthenticated(); else loggedIn">
              <a routerLink="/auth" [queryParams]="{ mode: 'login' }" class="btn btn-ghost btn-sm" (click)="closeMenu()">Login</a>
              <a routerLink="/auth" [queryParams]="{ mode: 'register' }" class="btn btn-primary btn-sm" (click)="closeMenu()">Sign Up</a>
            </ng-container>
            <ng-template #loggedIn>
              <span class="pill pill-indigo navbar-user">{{ auth.user()?.name }}</span>
              <button class="btn btn-logout btn-sm" (click)="logout()">Logout</button>
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

  scrollToContact(event: Event) {
    event.preventDefault();
    this.closeMenu();
    document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  logout() {
    this.auth.logout();
    this.closeMenu();
    this.router.navigateByUrl('/');
  }
}
