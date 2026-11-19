import { Injectable, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

/** Consistent browser titles: "Page · CloudBase". */
@Injectable()
export class CloudBaseTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const page = this.buildTitle(snapshot);
    this.title.setTitle(page ? `${page}` : 'CloudBase — Private Cloud Platform');
    const homepage = snapshot.url.split(/[?#]/)[0] === '/';
    this.meta.updateTag({ name: 'robots', content: homepage ? 'index, follow' : 'noindex, follow' });
    let canonical = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (homepage) {
      if (!canonical) {
        canonical = this.document.createElement('link');
        canonical.rel = 'canonical';
        this.document.head.appendChild(canonical);
      }
      canonical.href = 'https://www.cloudbase.website/';
    } else {
      canonical?.remove();
    }
  }
}
