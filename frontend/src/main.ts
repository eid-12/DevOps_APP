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

// Lara, always dark, with the same lavender primary as the app's own buttons (--primary: #c4b5fd = violet.300),
// so PrimeNG controls and CloudBase buttons read as one design instead of two competing blues/purples.
const LaraIndigo = definePreset(Lara, {
  semantic: {
    primary: {
      50: '{violet.50}', 100: '{violet.100}', 200: '{violet.200}', 300: '{violet.300}', 400: '{violet.400}',
      500: '{violet.500}', 600: '{violet.600}', 700: '{violet.700}', 800: '{violet.800}', 900: '{violet.900}', 950: '{violet.950}'
    },
    colorScheme: {
      dark: {
        primary: {
          color: '{primary.300}',
          contrastColor: '#0b0d10',
          hoverColor: '{primary.200}',
          activeColor: '{primary.100}'
        }
      }
    }
  }
});

bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideAnimations(),
    providePrimeNG({ theme: { preset: LaraIndigo, options: { darkModeSelector: '.cb-dark' } } }),
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
