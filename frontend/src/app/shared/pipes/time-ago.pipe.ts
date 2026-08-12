import { Pipe, PipeTransform } from '@angular/core';

/** Transforms an ISO/date value into a compact relative label (e.g. "3m ago"). */
@Pipe({ name: 'timeAgo', standalone: true, pure: true })
export class TimeAgoPipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    const ms = date.getTime();
    if (Number.isNaN(ms)) return '—';

    const diffSec = Math.round((Date.now() - ms) / 1000);
    if (diffSec < 10) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;

    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;

    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;

    const diffDay = Math.round(diffHr / 24);
    if (diffDay < 30) return `${diffDay}d ago`;

    return date.toLocaleDateString();
  }
}
