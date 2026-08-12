import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { InAppNotification } from '../core/models';
import { TimeAgoPipe } from './pipes/time-ago.pipe';
import { PressableDirective } from './directives/pressable.directive';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [CommonModule, RouterLink, TimeAgoPipe, PressableDirective],
  template: `
    <div class="notif-bell" (click)="$event.stopPropagation()">
      <button
        type="button"
        class="btn btn-ghost btn-sm notif-bell-btn"
        appPressable
        (click)="toggle()"
        aria-label="Notifications"
      >
        <i class="pi pi-bell" aria-hidden="true"></i>
        @if (unread() > 0) {
          <span class="notif-badge">{{ unread() > 9 ? '9+' : unread() }}</span>
        }
      </button>

      @if (open()) {
        <div class="notif-panel panel">
          <div class="notif-panel-head">
            <strong>Notifications</strong>
            <button type="button" class="btn btn-ghost btn-sm" appPressable (click)="markAll()">Mark all read</button>
          </div>
          <!-- @defer: load list only when the panel is open -->
          @defer (when open(); prefetch on idle) {
            <div class="notif-list">
              @for (n of items(); track n.id) {
                <button type="button" class="notif-item" [class.unread]="!n.read" appPressable (click)="openItem(n)">
                  <strong>{{ n.title }}</strong>
                  <span>{{ n.body }}</span>
                  <time [attr.title]="n.createdAt | date:'medium'">{{ n.createdAt | timeAgo }}</time>
                </button>
              } @empty {
                <p class="muted" style="padding:12px">Deployments and service alerts appear here.</p>
              }
            </div>
          } @placeholder {
            <p class="muted" style="padding:12px">Loading…</p>
          }
        </div>
      }
    </div>
  `
})
export class NotificationBellComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly open = signal(false);
  readonly items = signal<InAppNotification[]>([]);
  readonly unread = signal(0);

  ngOnInit() {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 4000);
  }

  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  @HostListener('document:click')
  onDocClick() {
    this.open.set(false);
  }

  toggle() {
    this.open.update(v => !v);
    if (this.open()) this.refresh();
  }

  refresh() {
    if (!this.auth.isAuthenticated() || this.auth.isAdmin()) {
      this.items.set([]);
      this.unread.set(0);
      return;
    }
    this.auth.refreshUnread().subscribe({
      next: n => this.unread.set(n),
      error: () => this.unread.set(0)
    });
    this.auth.listInbox().subscribe({
      next: list => this.items.set(list.slice(0, 12)),
      error: () => {}
    });
  }

  markAll() {
    this.auth.markAllNotificationsRead();
    this.refresh();
  }

  openItem(n: InAppNotification) {
    this.auth.markNotificationRead(n.id);
    this.open.set(false);
    this.refresh();
    if (n.href) {
      const [path, q] = n.href.split('?');
      const queryParams: Record<string, string> = {};
      if (q) {
        for (const part of q.split('&')) {
          const [k, v] = part.split('=');
          if (k) queryParams[k] = decodeURIComponent(v ?? '');
        }
      }
      this.router.navigate([path], Object.keys(queryParams).length ? { queryParams } : undefined);
    }
  }
}
