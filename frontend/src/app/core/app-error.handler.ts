import { ErrorHandler, Injectable, inject } from '@angular/core';
import { MessageService } from 'primeng/api';

/**
 * Global uncaught error handler — surfaces unexpected failures without crashing the shell.
 */
@Injectable()
export class AppErrorHandler implements ErrorHandler {
  private readonly messages = inject(MessageService);

  handleError(error: unknown): void {
    console.error('[CloudBase]', error);
    // Ignore noisy Angular/HTTP secondary errors already toasted by the API interceptor
    const text = error instanceof Error ? error.message : '';
    if (!text || text.includes('Http failure') || text.includes('HttpErrorResponse')) {
      return;
    }
    this.messages.add({
      severity: 'error',
      summary: 'Application error',
      detail: text.slice(0, 240),
      life: 6000
    });
  }
}
