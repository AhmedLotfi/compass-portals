import { Component, computed, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import type { NavItem } from '@schema/content';
import { CopyPipe } from '../../core/copy/copy';
import { AutoLang } from '../../core/i18n/auto-lang';

/** Splits an internal href into a router path and fragment. */
export function splitHref(href: string): { path: string; fragment?: string } {
  const [path = '/', fragment] = href.split('#');
  return fragment ? { path, fragment } : { path };
}

/** A navigation link: router link for internal paths, new-tab link for external URLs. */
@Component({
  selector: 'app-nav-link',
  imports: [RouterLink, RouterLinkActive, CopyPipe, AutoLang],
  template: `
    @let link = item();
    @if (link.external) {
      <a
        [class]="linkClass()"
        [href]="link.href"
        target="_blank"
        rel="noopener"
        [appAutoLang]="link.label"
      >
        {{ link.label }}<span class="visually-hidden"> {{ 'opensInNewTab' | copy }}</span>
      </a>
    } @else {
      <a
        [class]="linkClass()"
        [routerLink]="target().path"
        [fragment]="target().fragment"
        routerLinkActive="is-active"
        [routerLinkActiveOptions]="{ exact: target().path === '/' }"
        ariaCurrentWhenActive="page"
        [appAutoLang]="link.label"
        >{{ link.label }}</a
      >
    }
  `,
  host: { style: 'display: contents' },
})
export class NavLink {
  readonly item = input.required<NavItem>();
  readonly linkClass = input('');
  protected readonly target = computed(() => splitHref(this.item().href));
}
