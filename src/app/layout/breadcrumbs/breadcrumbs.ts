import { AutoLang } from '../../core/i18n/auto-lang';
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CopyPipe } from '../../core/copy/copy';

export interface Crumb {
  label: string;
  path: string;
}

@Component({
  selector: 'app-breadcrumbs',
  imports: [AutoLang, RouterLink, CopyPipe],
  template: `
    <nav class="breadcrumbs" [attr.aria-label]="'breadcrumb' | copy">
      <ol>
        @for (crumb of items(); track crumb.path; let last = $last) {
          <li>
            @if (last) {
              <span aria-current="page" [appAutoLang]="crumb.label">{{ crumb.label }}</span>
            } @else {
              <a [routerLink]="crumb.path" [appAutoLang]="crumb.label">{{ crumb.label }}</a>
            }
          </li>
        }
      </ol>
    </nav>
  `,
  styles: `
    ol {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.6rem;
      list-style: none;
      margin: 0;
      padding: 0;
      font-size: var(--text-sm);
      color: var(--color-ink-2);
    }
    li + li::before {
      content: '/';
      margin-inline-end: 0.6rem;
      color: var(--color-rule);
    }
    a {
      color: var(--color-ink-2);
      text-decoration-color: var(--color-rule);
    }
    a:hover {
      color: var(--color-ink);
      text-decoration-color: var(--color-brass);
    }
    [aria-current] {
      color: var(--color-ink);
    }
  `,
})
export class Breadcrumbs {
  readonly items = input.required<Crumb[]>();
}
