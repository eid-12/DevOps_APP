import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DropdownModule } from 'primeng/dropdown';
import { TagModule } from 'primeng/tag';
import { GitHubRepo } from '../core/models';

@Component({
  selector: 'app-github-repo-select',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownModule, TagModule],
  template: `
    <p-dropdown
      [options]="repos"
      [ngModel]="value"
      (ngModelChange)="onChange($event)"
      optionLabel="fullName"
      optionValue="fullName"
      [style]="{ width: '100%' }"
      styleClass="cb-env-dropdown w-full"
      panelStyleClass="cb-env-panel cb-repo-panel"
      appendTo="body"
      [placeholder]="placeholderText"
      [disabled]="disabled || loading"
      [filter]="true"
      filterBy="fullName,name"
      filterPlaceholder="Search repositories…"
      [showClear]="!!value"
      emptyFilterMessage="No matching repositories"
      emptyMessage="No repositories found"
    >
      <ng-template pTemplate="selectedItem" let-sel>
        @if (repoFor(sel); as r) {
          <div class="cb-env-selected flex align-items-center gap-2">
            <i class="pi pi-github" aria-hidden="true"></i>
            <span class="cb-env-selected-label text-overflow-ellipsis overflow-hidden white-space-nowrap">{{ r.fullName }}</span>
            @if (r.isPrivate) {
              <p-tag value="Private" severity="warning" styleClass="cb-env-tag" />
            }
          </div>
        }
      </ng-template>
      <ng-template pTemplate="item" let-r>
        <div class="cb-env-option flex align-items-center justify-content-between gap-3 w-full">
          <div class="flex align-items-center gap-2 min-w-0">
            <span class="cb-env-icon-wrap flex align-items-center justify-content-center">
              <i class="pi pi-github" aria-hidden="true"></i>
            </span>
            <div class="flex flex-column min-w-0">
              <span class="cb-env-option-title text-overflow-ellipsis overflow-hidden white-space-nowrap">{{ r.name }}</span>
              <small class="cb-env-option-hint text-overflow-ellipsis overflow-hidden white-space-nowrap">{{ r.fullName }} · {{ r.defaultBranch || 'main' }}</small>
            </div>
          </div>
          @if (r.isPrivate) {
            <p-tag value="Private" icon="pi pi-lock" severity="warning" styleClass="cb-env-tag" />
          } @else {
            <p-tag value="Public" severity="success" styleClass="cb-env-tag" />
          }
        </div>
      </ng-template>
    </p-dropdown>
  `
})
export class GithubRepoSelectComponent {
  @Input() repos: GitHubRepo[] = [];
  @Input() value = '';
  @Input() loading = false;
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<string>();

  get placeholderText(): string {
    if (this.loading) return 'Loading repositories…';
    if (!this.repos.length) return 'No repos found — paste URL below';
    return 'Select a repository…';
  }

  repoFor(value: string | GitHubRepo | null | undefined): GitHubRepo | undefined {
    if (!value) return undefined;
    if (typeof value === 'object' && 'fullName' in value) return value;
    return this.repos.find(r => r.fullName === value);
  }

  onChange(next: string) {
    this.value = next ?? '';
    this.valueChange.emit(this.value);
  }
}
