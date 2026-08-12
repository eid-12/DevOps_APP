import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DropdownModule } from 'primeng/dropdown';
import { TagModule } from 'primeng/tag';
import { DatabaseType } from '../core/models';
import { DB_PRESETS } from './service-source.util';

interface DbOption {
  label: string;
  value: DatabaseType;
  hint: string;
  port: number;
  icon: string;
  severity: 'success' | 'info' | 'warning' | 'danger' | 'secondary' | 'contrast';
}

@Component({
  selector: 'app-database-type-select',
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
      placeholder="Select database…"
      [disabled]="disabled"
    >
      <ng-template pTemplate="selectedItem" let-sel>
        @if (optionFor(sel); as item) {
          <div class="cb-env-selected flex align-items-center gap-2">
            <i [class]="item.icon" aria-hidden="true"></i>
            <span class="cb-env-selected-label">{{ item.label }}</span>
            <p-tag [value]="':' + item.port" severity="secondary" styleClass="cb-env-tag" />
          </div>
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
          <p-tag [value]="':' + item.port" [severity]="item.severity" styleClass="cb-env-tag" />
        </div>
      </ng-template>
    </p-dropdown>
  `
})
export class DatabaseTypeSelectComponent {
  @Input() value: DatabaseType = 'POSTGRESQL';
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<DatabaseType>();

  readonly options: DbOption[] = (Object.keys(DB_PRESETS) as DatabaseType[]).map(key => {
    const p = DB_PRESETS[key];
    return {
      label: p.label,
      value: key,
      hint: p.hint,
      port: p.port,
      icon: key === 'REDIS' ? 'pi pi-bolt' : key === 'MONGODB' ? 'pi pi-database' : 'pi pi-server',
      severity: key === 'POSTGRESQL' ? 'info' : key === 'MYSQL' ? 'warning' : key === 'REDIS' ? 'danger' : 'success'
    };
  });

  optionFor(value: DatabaseType | DbOption | null | undefined): DbOption | undefined {
    if (!value) return undefined;
    if (typeof value === 'object' && 'value' in value) return value;
    return this.options.find(o => o.value === value);
  }

  onChange(next: DatabaseType) {
    this.value = next;
    this.valueChange.emit(next);
  }
}
