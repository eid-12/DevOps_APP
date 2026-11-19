import { Injectable, computed, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { publicCopy } from './public-copy';
import homeSeo from './public-home.json';

@Injectable({ providedIn: 'root' })
export class PublicLocaleService {
  private readonly document = inject(DOCUMENT);
  readonly language = signal<'en' | 'ar'>('en');
  readonly isHome = signal(false);
  readonly copy = computed(() => publicCopy[this.language()]);
  readonly seo = computed(() => homeSeo[this.language()]);
  readonly homeUrl = computed(() => this.language() === 'ar' ? '/ar/' : '/');
  constructor() { this.setPath(this.document.location?.pathname || '/'); }
  setPath(url: string) {
    const path = url.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    this.isHome.set(path === '/' || path === '/ar');
    this.language.set(path === '/ar' ? 'ar' : 'en');
  }
}
