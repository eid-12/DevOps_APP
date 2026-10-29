import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  computed,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export type CreatePickerOptionId =
  | 'github'
  | 'database'
  | 'docker'
  | 'empty';

export type PromptDetectKind = 'github' | 'docker' | 'name' | 'empty';

@Component({
  selector: 'app-create-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="create-picker" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
      <div class="create-picker-input-wrap" [class.is-focused]="focused()" [class.has-value]="!!prompt.trim()">
        <span class="create-picker-spark" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l1.4 6.1L19 9.5l-5.6 1.4L12 17l-1.4-6.1L5 9.5l5.6-1.4L12 2z"/>
            <path d="M19 14l.7 2.8L22 17.5l-2.3.7L19 21l-.7-2.8L16 17.5l2.3-.7L19 14z" opacity=".7"/>
          </svg>
        </span>
        <input
          #promptInput
          class="create-picker-input"
          [ngModel]="prompt"
          (ngModelChange)="onPrompt($event)"
          [placeholder]="placeholder"
          autocomplete="off"
          spellcheck="false"
          (focus)="focused.set(true)"
          (blur)="focused.set(false)"
          (keydown.enter)="enter.emit()"
        />
        @if (detect(); as d) {
          <span class="create-picker-detect" [attr.data-kind]="d.kind">{{ d.label }}</span>
        }
        <kbd class="create-picker-enter">Enter</kbd>
      </div>

      <p class="create-picker-hint">
        Accepts a <strong>GitHub URL</strong>, a <strong>Docker image:tag</strong>, or a <strong>project name</strong>.
        Press Enter to continue, or pick a type below.
      </p>

      <div class="create-picker-list">
        <button
          type="button"
          class="create-picker-item"
          [class.is-suggested]="detect()?.kind === 'github'"
          (click)="select.emit('github')"
        >
          <span class="create-picker-item-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.26c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.48 0-.24-.01-.87-.01-1.7-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 6.8c.85 0 1.7.12 2.5.34 1.9-1.32 2.74-1.05 2.74-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.8 0 .27.18.59.69.48A10.27 10.27 0 0 0 22 12.26C22 6.58 17.52 2 12 2z"/></svg>
          </span>
          <span class="create-picker-item-body">
            <span class="create-picker-item-label">GitHub Repository</span>
            <span class="create-picker-item-sub">{{ githubConnected ? 'https://github.com/org/repo' : 'Connect GitHub to continue' }}</span>
          </span>
          <span class="create-picker-chevron">›</span>
        </button>

        <button
          type="button"
          class="create-picker-item"
          [class.is-suggested]="detect()?.kind === 'docker'"
          (click)="select.emit('docker')"
        >
          <span class="create-picker-item-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M4.6 11.2h2.1v2.1H4.6zm2.6 0h2.1v2.1H7.2zm2.6 0h2.1v2.1H9.8zm2.6 0h2.1v2.1h-2.1zM7.2 8.6h2.1v2.1H7.2zm2.6 0h2.1v2.1H9.8zm2.6 0h2.1v2.1h-2.1zM9.8 6h2.1v2.1H9.8zm8.3 5.7c-.2-.14-.6-.16-.9-.1-.05-.5-.3-1-.7-1.35l-.3-.2-.2.3c-.4.55-.5 1.35-.14 2 .25.4.7.7 1.4.85-.1.3-.3.55-.55.75-.6.45-1.5.55-2.35.45H3.2l-.15.75c-.15.8-.05 1.7.4 2.45C4 18.9 5.1 19.7 7 19.7c2.5 0 4.4-1.15 5.55-3.2.85.05 1.75-.1 2.45-.55.5-.35.9-.85 1.05-1.45.55.05 1.1-.05 1.5-.35.45-.35.7-.85.7-1.35 0-.05 0-.1-.05-.15z"/></svg>
          </span>
          <span class="create-picker-item-body">
            <span class="create-picker-item-label">Docker Image</span>
            <span class="create-picker-item-sub">nginx:alpine · ghcr.io/org/app:latest</span>
          </span>
          <span class="create-picker-chevron">›</span>
        </button>

        <button type="button" class="create-picker-item" (click)="select.emit('database')">
          <span class="create-picker-item-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>
          </span>
          <span class="create-picker-item-body">
            <span class="create-picker-item-label">Database</span>
            <span class="create-picker-item-sub">Postgres · MySQL · Redis · Mongo</span>
          </span>
          <span class="create-picker-chevron">›</span>
        </button>
      </div>

      @if (showEmpty) {
        <button
          type="button"
          class="create-picker-empty"
          [class.is-suggested]="detect()?.kind === 'name'"
          (click)="select.emit('empty')"
        >
          <span class="create-picker-item-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 8l5 4-5 4"/><path d="M11 16h8"/></svg>
          </span>
          <span class="create-picker-item-body">
            <span class="create-picker-item-label">Empty Project</span>
            <span class="create-picker-item-sub">Blank canvas — add services later</span>
          </span>
        </button>
      }

      @if (error) {
        <div class="create-picker-error">{{ error }}</div>
      }
    </div>
  `
})
export class CreatePickerComponent implements AfterViewInit {
  @ViewChild('promptInput') promptInput?: ElementRef<HTMLInputElement>;

  @Input() prompt = '';
  @Input() placeholder = 'GitHub URL, docker image:tag, or project name…';
  @Input() showEmpty = true;
  @Input() error = '';
  /** When false, GitHub row hints that OAuth connect is required. */
  @Input() githubConnected = true;

  @Output() promptChange = new EventEmitter<string>();
  @Output() select = new EventEmitter<CreatePickerOptionId>();
  @Output() enter = new EventEmitter<void>();

  readonly focused = signal(false);
  private readonly livePrompt = signal('');

  readonly detect = computed(() => {
    const value = (this.livePrompt() || this.prompt).trim();
    if (!value) return null;
    if (value.includes('github.com') || /^https?:\/\/.+/.test(value)) {
      return { kind: 'github' as PromptDetectKind, label: 'GitHub' };
    }
    if (/^[a-z0-9._/-]+:[a-z0-9._-]+$/i.test(value) || /^[a-z0-9._/-]+\/[a-z0-9._/-]+(?::[a-z0-9._-]+)?$/i.test(value)) {
      return { kind: 'docker' as PromptDetectKind, label: 'Docker' };
    }
    return { kind: 'name' as PromptDetectKind, label: 'Name' };
  });

  ngAfterViewInit(): void {
    this.livePrompt.set(this.prompt);
    queueMicrotask(() => this.promptInput?.nativeElement.focus());
  }

  onPrompt(value: string): void {
    this.livePrompt.set(value);
    this.promptChange.emit(value);
  }
}
