import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of, timer } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

/**
 * Preloads only routes marked with data.preload = true, after a short idle delay.
 * Keeps first paint light while warming authenticated pages in the background.
 */
@Injectable({ providedIn: 'root' })
export class SelectivePreloadStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (route.data?.['preload']) {
      return timer(1200).pipe(mergeMap(() => load()));
    }
    return of(null);
  }
}
