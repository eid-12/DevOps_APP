import { APP_INITIALIZER, ErrorHandler, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withPreloading,
  withRouterConfig
} from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { NgxSpinnerModule } from 'ngx-spinner';
import { MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { definePreset } from '@primeuix/themes';
import Lara from '@primeuix/themes/lara';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { authInterceptor } from './app/core/auth.interceptor';
import { apiErrorInterceptor } from './app/core/api-error.interceptor';
import { loadingInterceptor } from './app/core/loading.interceptor';
import { SelectivePreloadStrategy } from './app/core/selective-preload.strategy';
import { CloudBaseTitleStrategy } from './app/core/title.strategy';
import { AppErrorHandler } from './app/core/app-error.handler';
import { initializeAuthSession } from './app/core/app-init';

// Lara with indigo primary, always dark: the PrimeNG 18+ equivalent of the old lara-dark-indigo CSS theme.
const LaraIndigo = definePreset(Lara, {
  semantic: {
    primary: {
      50: '{indigo.50}', 100: '{indigo.100}', 200: '{indigo.200}', 300: '{indigo.300}', 400: '{indigo.400}',
      500: '{indigo.500}', 600: '{indigo.600}', 700: '{indigo.700}', 800: '{indigo.800}', 900: '{indigo.900}', 950: '{indigo.950}'
    }
  }
});

bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideAnimations(),
    providePrimeNG({ theme: { preset: LaraIndigo, options: { darkModeSelector: ':root' } } }),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({
        scrollPositionRestoration: 'enabled',
        anchorScrolling: 'enabled'
      }),
      withPreloading(SelectivePreloadStrategy),
      withRouterConfig({
        paramsInheritanceStrategy: 'always',
        onSameUrlNavigation: 'reload'
      })
    ),
    provideHttpClient(
      withFetch(),
      withInterceptors([authInterceptor, loadingInterceptor, apiErrorInterceptor])
    ),
    importProvidersFrom(
      NgxSpinnerModule.forRoot({
        type: 'ball-scale-multiple'
      })
    ),
    MessageService,
    { provide: TitleStrategy, useClass: CloudBaseTitleStrategy },
    { provide: ErrorHandler, useClass: AppErrorHandler },
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAuthSession,
      multi: true
    }
  ]
}).catch((err) => console.error(err));
