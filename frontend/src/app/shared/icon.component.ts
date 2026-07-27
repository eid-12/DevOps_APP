import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type IconName =
  | 'github-link'
  | 'shield-check'
  | 'rocket'
  | 'pipeline'
  | 'lock-shield'
  | 'terminal-live'
  | 'cloud'
  | 'container'
  | 'package'
  | 'activity'
  | 'discord'
  | 'check-circle'
  | 'folder'
  | 'mail'
  | 'phone'
  | 'linkedin'
  | 'home';

export type IconTone = 'indigo' | 'violet' | 'emerald' | 'sky' | 'amber';

@Component({
  selector: 'app-icon',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span
      class="icon-wrap"
      [class]="'icon-wrap icon-' + tone"
      [class.icon-sm]="size === 'sm'"
      [class.icon-lg]="size === 'lg'"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <ng-container [ngSwitch]="name">
          <!-- GitHub link -->
          <g *ngSwitchCase="'github-link'">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 18 4.77 5.07 5.07 0 0 0 17.91 1S16.73.65 13 2.48a13.38 13.38 0 0 0-7 0C2.27.65 1.09 1 1.09 1A5.07 5.07 0 0 0 1 4.77 5.44 5.44 0 0 0 3.5 8.58c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
            <path d="M12 8v8M8 12h8" />
          </g>

          <!-- Admin approval -->
          <g *ngSwitchCase="'shield-check'">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="m9 12 2 2 4-4" />
          </g>

          <!-- Deploy -->
          <g *ngSwitchCase="'rocket'">
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
            <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
          </g>

          <!-- CI/CD pipeline -->
          <g *ngSwitchCase="'pipeline'">
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
          </g>

          <!-- Isolation -->
          <g *ngSwitchCase="'lock-shield'">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <rect x="9" y="10" width="6" height="5" rx="1" />
            <path d="M12 10V8a2 2 0 1 1 4 0v2" />
          </g>

          <!-- Live terminal -->
          <g *ngSwitchCase="'terminal-live'">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m6 9 3 3-3 3M11 15h5" />
            <circle cx="18" cy="7" r="2" fill="currentColor" stroke="none" class="pulse-dot" />
          </g>

          <!-- Brand cloud -->
          <g *ngSwitchCase="'cloud'">
            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
          </g>

          <!-- Docker container -->
          <g *ngSwitchCase="'container'">
            <path d="M22 12H2" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            <path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01" />
          </g>

          <!-- Package / images -->
          <g *ngSwitchCase="'package'">
            <path d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
            <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
          </g>

          <!-- Health activity -->
          <g *ngSwitchCase="'activity'">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </g>

          <!-- Discord -->
          <g *ngSwitchCase="'discord'">
            <path d="M20.3 4.4A17.7 17.7 0 0 0 15.5 3c-.2.4-.5 1-.7 1.4a16.4 16.4 0 0 0-4.6 0C10 4 9.7 3.4 9.5 3a17.7 17.7 0 0 0-4.8 1.4C2.6 8.2 1.9 11.8 2.2 15.3a17.8 17.8 0 0 0 5.4 2.7c.4-.6.8-1.2 1.1-1.8-.6-.2-1.2-.5-1.7-.9.1-.1.2-.2.3-.3 3.3 1.5 6.9 1.5 10.2 0 .1.1.2.2.3.3-.5.4-1.1.7-1.7.9.3.6.7 1.2 1.1 1.8a17.8 17.8 0 0 0 5.4-2.7c.4-4.1-.6-7.6-2.6-10.9ZM8.6 13.4c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.8 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" fill="currentColor" stroke="none" />
          </g>

          <!-- Success -->
          <g *ngSwitchCase="'check-circle'">
            <circle cx="12" cy="12" r="10" />
            <path d="m9 12 2 2 4-4" />
          </g>

          <!-- Empty folder -->
          <g *ngSwitchCase="'folder'">
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
          </g>

          <!-- Email -->
          <g *ngSwitchCase="'mail'">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </g>

          <!-- Phone -->
          <g *ngSwitchCase="'phone'">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
          </g>

          <!-- LinkedIn -->
          <g *ngSwitchCase="'linkedin'">
            <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-12h4v2" />
            <rect x="2" y="9" width="4" height="12" />
            <circle cx="4" cy="4" r="2" />
          </g>

          <!-- Home -->
          <g *ngSwitchCase="'home'">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M9 22V12h6v10" />
          </g>
        </ng-container>
      </svg>
    </span>
  `,
  styles: [`
    .icon-wrap {
      display: inline-grid;
      place-items: center;
      width: 52px;
      height: 52px;
      border-radius: 14px;
      border: 1px solid rgba(99, 102, 241, 0.22);
      background: linear-gradient(145deg, rgba(99, 102, 241, 0.14), rgba(15, 23, 42, 0.6));
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
      color: #c7d2fe;
    }

    .icon-wrap.icon-sm {
      width: 34px;
      height: 34px;
      border-radius: 10px;
    }

    .icon-wrap.icon-lg {
      width: 58px;
      height: 58px;
      border-radius: 16px;
    }

    .icon-wrap svg {
      width: 26px;
      height: 26px;
    }

    .icon-wrap.icon-sm svg {
      width: 18px;
      height: 18px;
    }

    .icon-wrap.icon-lg svg {
      width: 28px;
      height: 28px;
    }

    .icon-indigo { color: #a5b4fc; border-color: rgba(99, 102, 241, 0.28); background: linear-gradient(145deg, rgba(99,102,241,0.18), rgba(15,23,42,0.55)); }
    .icon-violet { color: #c4b5fd; border-color: rgba(139, 92, 246, 0.28); background: linear-gradient(145deg, rgba(139,92,246,0.18), rgba(15,23,42,0.55)); }
    .icon-emerald { color: #6ee7b7; border-color: rgba(16, 185, 129, 0.28); background: linear-gradient(145deg, rgba(16,185,129,0.16), rgba(15,23,42,0.55)); }
    .icon-sky { color: #7dd3fc; border-color: rgba(14, 165, 233, 0.28); background: linear-gradient(145deg, rgba(14,165,233,0.16), rgba(15,23,42,0.55)); }
    .icon-amber { color: #fcd34d; border-color: rgba(245, 158, 11, 0.28); background: linear-gradient(145deg, rgba(245,158,11,0.16), rgba(15,23,42,0.55)); }

    .pulse-dot {
      animation: iconPulse 1.8s ease-in-out infinite;
    }

    @keyframes iconPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }
  `]
})
export class IconComponent {
  @Input({ required: true }) name!: IconName;
  @Input() tone: IconTone = 'indigo';
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
}
