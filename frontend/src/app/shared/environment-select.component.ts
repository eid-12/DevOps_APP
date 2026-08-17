import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DropdownModule } from 'primeng/dropdown';
import { TagModule } from 'primeng/tag';
import { ProjectEnvironment } from '../core/models';

interface EnvOption {
  label: string;
  value: ProjectEnvironment;
  short: string;
  hint: string;
  icon: string;
  severity: 'success' | 'warning' | 'info' | 'danger' | 'secondary' | 'contrast';
}

@Component({
  selector: 'app-environment-select',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownModule, TagModule],
  template: `
    <p-dropdown
      [options]="options"
      [ngModel]="value"
      (ngModelChange)="onChange($event)"
      optionLabel="label"
      optionValue="value"
      [style]="{ width: '100%' }"
      styleClass="cb-env-dropdown w-full"
      panelStyleClass="cb-env-panel"
      appendTo="body"
      [placeholder]="placeholder"
      [disabled]="disabled"
      [showClear]="false"
    >
      <ng-template pTemplate="selectedItem" let-sel>
        @if (optionFor(sel); as item) {
          <div class="cb-env-selected flex align-items-center gap-2">
            <i [class]="item.icon" aria-hidden="true"></i>
            <span class="cb-env-selected-label">{{ item.label }}</span>
            <p-tag [value]="item.short" [severity]="item.severity" styleClass="cb-env-tag" />
          </div>
        } @else {
          <span class="cb-env-selected-label">{{ placeholder }}</span>
        }
      </ng-template>
      <ng-template pTemplate="item" let-item>
        <div class="cb-env-option flex align-items-center justify-content-between gap-3 w-full">
          <div class="flex align-items-center gap-2">
            <span class="cb-env-icon-wrap flex align-items-center justify-content-center">
              <i [class]="item.icon" aria-hidden="true"></i>
            </span>
            <div class="flex flex-column">
              <span class="cb-env-option-title">{{ item.label }}</span>
              <small class="cb-env-option-hint">{{ item.hint }}</small>
            </div>
          </div>
          <p-tag [value]="item.short" [severity]="item.severity" styleClass="cb-env-tag" />
        </div>
      </ng-template>
    </p-dropdown>
  `
})
export class EnvironmentSelectComponent {
  @Input() value: ProjectEnvironment = 'production';
  @Input() disabled = false;
  @Input() placeholder = 'Select environment';
  @Output() valueChange = new EventEmitter<ProjectEnvironment>();

  readonly options: EnvOption[] = [
    {
      label: 'Production',
      value: 'production',
      short: 'PROD',
      hint: 'Live traffic · highest care',
      icon: 'pi pi-globe',
      severity: 'danger'
    },
    {
      label: 'Staging',
      value: 'staging',
      short: 'STG',
      hint: 'Pre-release / QA',
      icon: 'pi pi-server',
      severity: 'warning'
    },
    {
      label: 'Development',
      value: 'development',
      short: 'DEV',
      hint: 'Local experiments',
      icon: 'pi pi-code',
      severity: 'info'
    }
  ];

  optionFor(value: ProjectEnvironment | EnvOption | null | undefined): EnvOption | undefined {
    if (!value) return undefined;
    if (typeof value === 'object' && 'value' in value) return value;
    return this.options.find(o => o.value === value);
  }

  onChange(next: ProjectEnvironment) {
    this.value = next;
    this.valueChange.emit(next);
  }
}
