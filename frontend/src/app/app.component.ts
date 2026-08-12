import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NgxSpinnerModule } from 'ngx-spinner';
import { ToastModule } from 'primeng/toast';

/**
 * Application root: global overlays only.
 * Page chrome lives in layout components loaded by the router.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, NgxSpinnerModule, ToastModule],
  template: `
    <p-toast position="top-right" [breakpoints]="{ '920px': { width: '92vw' } }" />
    <ngx-spinner
      name="api"
      bdColor="rgba(2,6,23,0.72)"
      color="#9bb8d4"
      size="medium"
      [fullScreen]="true"
    >
      <p class="spinner-caption">
        Waiting for backend<span class="spinner-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
      </p>
    </ngx-spinner>
    <router-outlet />
  `
})
export class AppComponent {}
