import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DropdownModule } from 'primeng/dropdown';

export interface StyledSelectOption {
  label: string;
  value: string;
  icon?: string;
  hint?: string;
}

@Component({
  selector: 'app-styled-select',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownModule],
  template: `
    <p-dropdown
      [options]="options"
      [ngModel]="value"
      (ngModelChange)="onChange($event)"
      optionLabel="label"
      optionValue="value"
      [style]="compact ? null : { width: '100%' }"
      [styleClass]="compact ? 'cb-env-dropdown cb-select-compact' : 'cb-env-dropdown w-full'"
      panelStyleClass="cb-env-panel"
      appendTo="body"
      [placeholder]="placeholder"
      [disabled]="disabled"
    >
      <ng-template pTemplate="selectedItem" let-sel>
        @if (optionFor(sel); as item) {
          <div class="cb-env-selected flex align-items-center gap-2">
            @if (item.icon) {
              <i [class]="item.icon" aria-hidden="true"></i>
            }
            <span class="cb-env-selected-label">{{ item.label }}</span>
          </div>
        }
      </ng-template>
      <ng-template pTemplate="item" let-item>
        <div class="cb-env-option flex align-items-center gap-2">
          @if (item.icon) {
            <i [class]="item.icon" aria-hidden="true"></i>
          }
          <div class="flex flex-column">
            <span class="cb-env-option-title">{{ item.label }}</span>
            @if (item.hint) {
              <small class="cb-env-option-hint">{{ item.hint }}</small>
            }
          </div>
        </div>
      </ng-template>
    </p-dropdown>
  `
})
export class StyledSelectComponent {
  @Input() options: StyledSelectOption[] = [];
  @Input() value = '';
  @Input() placeholder = 'Select…';
  @Input() disabled = false;
  @Input() compact = false;
  @Output() valueChange = new EventEmitter<string>();

  optionFor(value: string | StyledSelectOption | null | undefined): StyledSelectOption | undefined {
    if (value == null || value === '') return undefined;
    if (typeof value === 'object' && 'value' in value) return value;
    return this.options.find(o => o.value === value);
  }

  onChange(next: string) {
    this.value = next;
    this.valueChange.emit(next);
  }
}
