import { AfterViewInit, Directive, ElementRef, Input, inject } from '@angular/core';

/** Attribute directive — focuses the host after view init (lifecycle hook). */
@Directive({
  selector: '[appAutofocus]',
  standalone: true
})
export class AutofocusDirective implements AfterViewInit {
  private readonly el = inject(ElementRef<HTMLElement>);

  @Input() appAutofocus = true;

  ngAfterViewInit(): void {
    if (!this.appAutofocus) return;
    queueMicrotask(() => this.el.nativeElement.focus?.());
  }
}
