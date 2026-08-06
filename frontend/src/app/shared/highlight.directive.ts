import { Directive, ElementRef, Input, OnChanges, Renderer2, inject } from '@angular/core';

/**
 * Custom attribute directive (Angular Week 2 — Directives).
 * Usage: <div appHighlight="violet">…</div>
 */
@Directive({
  selector: '[appHighlight]',
  standalone: true
})
export class HighlightDirective implements OnChanges {
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly renderer = inject(Renderer2);

  @Input('appHighlight') tone: 'violet' | 'emerald' | 'amber' | 'sky' | '' = 'violet';

  ngOnChanges() {
    const map: Record<string, string> = {
      violet: 'rgba(139, 92, 246, 0.18)',
      emerald: 'rgba(16, 185, 129, 0.16)',
      amber: 'rgba(245, 158, 11, 0.16)',
      sky: 'rgba(56, 189, 248, 0.16)'
    };
    const bg = map[this.tone || 'violet'] ?? map['violet'];
    this.renderer.setStyle(this.el.nativeElement, 'background', bg);
    this.renderer.setStyle(this.el.nativeElement, 'border-radius', '12px');
    this.renderer.setStyle(this.el.nativeElement, 'padding', '10px 12px');
    this.renderer.setStyle(this.el.nativeElement, 'transition', 'background 180ms ease');
  }
}
