import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/**
 * Railway/Vercel-style delete gate: user must type the exact resource name.
 */
@Component({
  selector: 'app-confirm-delete-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal-backdrop" (click)="onBackdrop($event)">
      <div
        class="modal-panel panel confirm-delete-panel"
        (click)="$event.stopPropagation()"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
      >
        <div class="modal-header">
          <h3 [id]="titleId">{{ title }}</h3>
          <button type="button" class="btn btn-ghost btn-sm" (click)="cancel.emit()" [disabled]="busy">✕</button>
        </div>

        <p class="confirm-delete-warn">{{ warning }}</p>
        <p class="muted confirm-delete-hint">
          Type <strong class="confirm-delete-name">{{ confirmName }}</strong> to confirm. This cannot be undone.
        </p>

        <div class="field">
          <label for="confirm-delete-input">Confirm name</label>
          <input
            id="confirm-delete-input"
            type="text"
            autocomplete="off"
            spellcheck="false"
            [ngModel]="typed()"
            (ngModelChange)="typed.set($event)"
            (keydown.enter)="tryConfirm()"
            [disabled]="busy"
            placeholder="{{ confirmName }}"
          />
        </div>

        @if (error) {
          <div class="pill pill-red railway-alert" style="margin-top:12px">{{ error }}</div>
        }

        <div class="modal-actions" style="margin-top:18px">
          <button type="button" class="btn btn-ghost" (click)="cancel.emit()" [disabled]="busy">Cancel</button>
          <button
            type="button"
            class="btn btn-danger"
            (click)="tryConfirm()"
            [disabled]="busy || !matches()"
          >
            {{ busy ? 'Deleting…' : confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  `
})
export class ConfirmDeleteDialogComponent {
  @Input({ required: true }) title = 'Delete';
  @Input({ required: true }) confirmName = '';
  @Input() warning =
    'This permanently removes infrastructure in Portainer (stack, containers, volumes) and CloudBase records.';
  @Input() confirmLabel = 'Delete permanently';
  @Input() busy = false;
  @Input() error: string | null = null;

  @Output() readonly confirm = new EventEmitter<void>();
  @Output() readonly cancel = new EventEmitter<void>();

  readonly typed = signal('');
  readonly titleId = 'confirm-delete-title-' + Math.random().toString(36).slice(2, 8);

  matches(): boolean {
    return this.typed().trim() === this.confirmName.trim();
  }

  tryConfirm() {
    if (this.busy || !this.matches()) return;
    this.confirm.emit();
  }

  onBackdrop(event: MouseEvent) {
    if (this.busy) return;
    if (event.target === event.currentTarget) this.cancel.emit();
  }
}
