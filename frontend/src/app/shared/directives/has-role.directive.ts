import {
  Directive,
  Input,
  TemplateRef,
  ViewContainerRef,
  effect,
  inject
} from '@angular/core';
import { AuthService } from '../../core/auth.service';

export type AppRoleGate = 'AUTH' | 'GUEST' | 'ADMIN' | 'USER';

/**
 * Structural directive (*appHasRole) — shows/hides a template by auth role.
 * Example: <a *appHasRole="'ADMIN'" …>
 */
@Directive({
  selector: '[appHasRole]',
  standalone: true
})
export class HasRoleDirective {
  private readonly tpl = inject(TemplateRef<unknown>);
  private readonly vcr = inject(ViewContainerRef);
  private readonly auth = inject(AuthService);
  private role: AppRoleGate = 'AUTH';
  private shown = false;

  constructor() {
    effect(() => {
      // Re-evaluate when the auth user signal changes.
      this.auth.user();
      this.render();
    });
  }

  @Input()
  set appHasRole(role: AppRoleGate) {
    this.role = role;
    this.render();
  }

  private render(): void {
    const ok = this.matches(this.role);
    if (ok && !this.shown) {
      this.vcr.createEmbeddedView(this.tpl);
      this.shown = true;
    } else if (!ok && this.shown) {
      this.vcr.clear();
      this.shown = false;
    }
  }

  private matches(role: AppRoleGate): boolean {
    const user = this.auth.user();
    switch (role) {
      case 'AUTH':
        return !!user;
      case 'GUEST':
        return !user;
      case 'ADMIN':
        return user?.role === 'ADMIN';
      case 'USER':
        return !!user && user.role !== 'ADMIN';
      default:
        return false;
    }
  }
}
