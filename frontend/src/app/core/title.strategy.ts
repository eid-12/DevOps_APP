import { Injectable, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { PublicLocaleService } from './public-locale.service';
import homeSeo from './public-home.json';

/** Consistent browser titles: "Page · CloudBase". */
@Injectable()
export class CloudBaseTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly locale = inject(PublicLocaleService);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.locale.setPath(snapshot.url);
    const homepage = this.locale.isHome();
    const seo = this.locale.seo();
    const page = this.buildTitle(snapshot);
    this.title.setTitle(homepage ? seo.title : (page || 'CloudBase'));
    this.document.documentElement.lang = seo.lang;
    this.document.documentElement.dir = seo.dir;
    this.meta.updateTag({ name: 'description', content: seo.description });
    this.meta.updateTag({ property: 'og:title', content: seo.title });
    this.meta.updateTag({ property: 'og:description', content: seo.description });
    this.meta.updateTag({ name: 'twitter:title', content: seo.title });
    this.meta.updateTag({ name: 'twitter:description', content: seo.description });
    this.meta.updateTag({ name: 'robots', content: homepage ? 'index, follow' : 'noindex, follow' });
    let canonical = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (homepage) {
      if (!canonical) {
        canonical = this.document.createElement('link');
        canonical.rel = 'canonical';
        this.document.head.appendChild(canonical);
      }
      canonical.href = seo.url;
    } else {
      canonical?.remove();
    }
    this.document.querySelectorAll('link[data-public-home]').forEach(link => link.remove());
    if (homepage) {
      for (const [language, href] of [['en', homeSeo.en.url], ['ar', homeSeo.ar.url], ['x-default', homeSeo.en.url]]) {
        const link = this.document.createElement('link');
        link.rel = 'alternate'; link.hreflang = language; link.href = href;
        link.dataset['publicHome'] = 'true'; this.document.head.appendChild(link);
      }
    }
  }
}
