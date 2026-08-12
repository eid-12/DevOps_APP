import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DropdownModule } from 'primeng/dropdown';
import { DOCKER_IMAGE_PRESETS } from './service-source.util';

interface DockerPresetOption {
  label: string;
  value: string;
  image: string;
  tag: string;
  hint: string;
  icon: string;
}

@Component({
  selector: 'app-docker-preset-select',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownModule],
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
      placeholder="Choose a preset…"
      [disabled]="disabled"
      [showClear]="false"
    >
      <ng-template pTemplate="selectedItem" let-sel>
        @if (optionFor(sel); as item) {
          <div class="cb-env-selected flex align-items-center gap-2">
            <i [class]="item.icon" aria-hidden="true"></i>
            <span class="cb-env-selected-label">{{ item.label }}</span>
          </div>
        }
      </ng-template>
      <ng-template pTemplate="item" let-item>
        <div class="cb-env-option flex align-items-center gap-2 w-full">
          <span class="cb-env-icon-wrap flex align-items-center justify-content-center">
            <i [class]="item.icon" aria-hidden="true"></i>
          </span>
          <div class="flex flex-column">
            <span class="cb-env-option-title">{{ item.label }}</span>
            <small class="cb-env-option-hint">{{ item.hint }}</small>
          </div>
        </div>
      </ng-template>
    </p-dropdown>
  `
})
export class DockerPresetSelectComponent {
  @Input() value = '';
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<string>();

  readonly options: DockerPresetOption[] = [
    {
      label: 'Custom image…',
      value: '',
      image: '',
      tag: '',
      hint: 'Enter any Docker Hub image manually',
      icon: 'pi pi-pencil'
    },
    ...DOCKER_IMAGE_PRESETS.map(p => ({
      label: p.label,
      value: `${p.image}:${p.tag}`,
      image: p.image,
      tag: p.tag,
      hint: `${p.image}:${p.tag} · port ${p.port}`,
      icon: 'pi pi-box'
    }))
  ];

  optionFor(value: string | DockerPresetOption | null | undefined): DockerPresetOption | undefined {
    if (value == null) return this.options[0];
    if (typeof value === 'object' && 'value' in value) return value;
    return this.options.find(o => o.value === value) ?? this.options[0];
  }

  onChange(next: string) {
    this.value = next ?? '';
    this.valueChange.emit(this.value);
  }
}
