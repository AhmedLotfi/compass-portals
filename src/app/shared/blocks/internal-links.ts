import { Directive, inject } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Routes clicks on same-site links inside synced rich text (rendered with [innerHTML]) through the
 * router, so they navigate client-side like the rest of the site.
 */
@Directive({
  selector: '[appInternalLinks]',
  host: { '(click)': 'onClick($event)' },
})
export class InternalLinks {
  private readonly router = inject(Router);

  protected onClick(event: MouseEvent): void {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const anchor = (event.target as Element | null)?.closest?.('a');
    const href = anchor?.getAttribute('href');
    if (!anchor || !href || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    if (!href.startsWith('/') || href.startsWith('//') || /^\/(files|media)\//.test(href)) return;
    event.preventDefault();
    void this.router.navigateByUrl(href);
  }
}
