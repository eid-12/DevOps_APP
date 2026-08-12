import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DropdownModule } from 'primeng/dropdown';
import { TagModule } from 'primeng/tag';
import { ServiceRuntime } from '../core/models';

interface RuntimeOption {
  label: string;
  value: ServiceRuntime;
  short: string;
  hint: string;
  tone: string;
}

@Component({
  selector: 'app-runtime-select',
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
      panelStyleClass="cb-env-panel cb-runtime-panel"
      appendTo="body"
      placeholder="Select runtime"
      [disabled]="disabled"
      [filter]="true"
      filterBy="label,short,hint"
      filterPlaceholder="Search languages…"
    >
      <ng-template pTemplate="selectedItem" let-sel>
        @if (optionFor(sel); as item) {
          <div class="cb-env-selected flex align-items-center gap-2">
            <span class="cb-runtime-badge" [attr.data-tone]="item.tone">{{ item.short }}</span>
            <span class="cb-env-selected-label">{{ item.label }}</span>
          </div>
        }
      </ng-template>
      <ng-template pTemplate="item" let-item>
        <div class="cb-env-option flex align-items-center justify-content-between gap-3 w-full">
          <div class="flex align-items-center gap-2 min-w-0">
            <span class="cb-runtime-badge" [attr.data-tone]="item.tone">{{ item.short }}</span>
            <div class="flex flex-column min-w-0">
              <span class="cb-env-option-title">{{ item.label }}</span>
              <small class="cb-env-option-hint">{{ item.hint }}</small>
            </div>
          </div>
          <p-tag [value]="item.short" severity="secondary" styleClass="cb-env-tag" />
        </div>
      </ng-template>
    </p-dropdown>
  `
})
export class RuntimeSelectComponent {
  @Input() value: ServiceRuntime = 'node';
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<ServiceRuntime>();

  readonly options: RuntimeOption[] = [
    { label: 'Node.js', value: 'node', short: 'JS', hint: 'npm / yarn · Express, Next, Nest', tone: 'node' },
    { label: 'Java', value: 'java', short: 'JV', hint: 'Maven / Gradle · Spring Boot', tone: 'java' },
    { label: 'Python', value: 'python', short: 'PY', hint: 'pip · FastAPI, Django, Flask', tone: 'python' },
    { label: 'Go', value: 'go', short: 'GO', hint: 'go build · Gin, Fiber, Echo', tone: 'go' },
    { label: '.NET', value: 'dotnet', short: 'NET', hint: 'dotnet publish · ASP.NET', tone: 'dotnet' },
    { label: 'PHP', value: 'php', short: 'PHP', hint: 'Composer · Laravel, Symfony', tone: 'php' },
    { label: 'Rust', value: 'rust', short: 'RS', hint: 'cargo · Axum, Actix', tone: 'rust' },
    { label: 'Other', value: 'other', short: '…', hint: 'Custom Dockerfile / image', tone: 'other' }
  ];

  optionFor(value: ServiceRuntime | RuntimeOption | null | undefined): RuntimeOption | undefined {
    if (!value) return undefined;
    if (typeof value === 'object' && 'value' in value) return value;
    return this.options.find(o => o.value === value);
  }

  onChange(next: ServiceRuntime) {
    this.value = next;
    this.valueChange.emit(next);
  }
}
