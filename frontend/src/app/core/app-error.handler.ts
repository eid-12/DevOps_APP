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
    const text = error instanceof Error
      ? error.message
      : 'An unexpected error occurred';
    this.messages.add({
      severity: 'error',
      summary: 'Application error',
      detail: text.slice(0, 240),
      life: 6000
    });
  }
}
