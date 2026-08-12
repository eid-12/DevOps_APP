import { APP_INITIALIZER, ErrorHandler, importProvidersFrom } from '@angular/core';
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
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { authInterceptor } from './app/core/auth.interceptor';
import { apiErrorInterceptor } from './app/core/api-error.interceptor';
import { loadingInterceptor } from './app/core/loading.interceptor';
import { SelectivePreloadStrategy } from './app/core/selective-preload.strategy';
import { CloudBaseTitleStrategy } from './app/core/title.strategy';
import { AppErrorHandler } from './app/core/app-error.handler';
import { initializeAuthSession } from './app/core/app-init';

bootstrapApplication(AppComponent, {
  providers: [
    provideAnimations(),
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
