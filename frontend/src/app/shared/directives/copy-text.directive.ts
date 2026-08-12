import { Directive, HostBinding, HostListener, Input } from '@angular/core';

/** Attribute directive — copies text on click; HostBinding updates title/aria. */
@Directive({
  selector: '[appCopyText]',
  standalone: true
})
export class CopyTextDirective {
  @Input({ required: true }) appCopyText = '';

  @HostBinding('attr.title')
  get title(): string {
    return this.copied ? 'Copied!' : 'Click to copy';
  }

  @HostBinding('attr.role')
  readonly role = 'button';

  @HostBinding('attr.tabindex')
  readonly tabIndex = 0;

  @HostBinding('class.app-copy-text')
  readonly hostClass = true;

  @HostBinding('class.is-copied')
  copied = false;

  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  @HostListener('click')
  @HostListener('keydown.enter')
  async copy(): Promise<void> {
    const text = this.appCopyText?.trim();
    if (!text || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      this.copied = true;
      if (this.resetTimer) clearTimeout(this.resetTimer);
      this.resetTimer = setTimeout(() => (this.copied = false), 1600);
    } catch {
      this.copied = false;
    }
  }
}
