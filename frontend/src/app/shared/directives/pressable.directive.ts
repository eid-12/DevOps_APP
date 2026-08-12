import { Directive, HostBinding, HostListener } from '@angular/core';

/**
 * Attribute directive demo of @HostBinding + @HostListener:
 * toggles pressed/focus-visible classes on the host element.
 */
@Directive({
  selector: '[appPressable]',
  standalone: true
})
export class PressableDirective {
  @HostBinding('class.app-pressable')
  readonly hostClass = true;

  @HostBinding('class.is-pressed')
  pressed = false;

  @HostBinding('class.is-focused')
  focused = false;

  @HostListener('pointerdown')
  onPointerDown(): void {
    this.pressed = true;
  }

  @HostListener('pointerup')
  @HostListener('pointerleave')
  @HostListener('pointercancel')
  onPointerRelease(): void {
    this.pressed = false;
  }

  @HostListener('focus')
  onFocus(): void {
    this.focused = true;
  }

  @HostListener('blur')
  onBlur(): void {
    this.focused = false;
    this.pressed = false;
  }
}
