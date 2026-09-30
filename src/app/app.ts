import { LocationStrategy } from '@angular/common';
import { Component, DOCUMENT, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { CopyPipe } from './core/copy/copy';
import { SiteFooter } from './layout/site-footer/site-footer';
import { SiteHeader } from './layout/site-header/site-header';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SiteHeader, SiteFooter, CopyPipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly router = inject(Router);
  private readonly locationStrategy = inject(LocationStrategy);
  private readonly document = inject(DOCUMENT);

  /** `#main` on the current page: a bare `#main` would resolve against `<base href="/">`. */
  protected readonly mainHref = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.skipHref()),
    ),
    { initialValue: this.skipHref() },
  );

  protected skipToMain(event: Event): void {
    event.preventDefault();
    this.document.getElementById('main')?.focus();
  }

  private skipHref(): string {
    const path = this.router.url.split(/[?#]/)[0] ?? '/';
    // The 404 page is served as /404.html (tools/postbuild) for every unknown URL.
    if (path === '/404') return '/404.html#main';
    return `${this.locationStrategy.prepareExternalUrl(path)}#main`;
  }
}
