import { Pipe, PipeTransform } from '@angular/core';

/** Truncates long display strings for tables and lists. */
@Pipe({ name: 'truncate', standalone: true, pure: true })
export class TruncatePipe implements PipeTransform {
  transform(value: string | null | undefined, limit = 48, ellipsis = '…'): string {
    if (!value) return '';
    if (value.length <= limit) return value;
    return `${value.slice(0, Math.max(0, limit)).trimEnd()}${ellipsis}`;
  }
}
