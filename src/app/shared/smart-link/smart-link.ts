import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { LinkKind } from '@schema/content';
import { CopyPipe } from '../../core/copy/copy';
import { splitHref } from '../../layout/nav-link/nav-link';

/** What a synced href points at. */
export function linkKind(href: string): LinkKind {
  if (/^mailto:/i.test(href)) return 'email';
  if (/^tel:/i.test(href)) return 'phone';
  if (/^\/(files|media)\//.test(href)) return 'document';
  if (href.startsWith('/') || href.startsWith('#')) return 'internal';
  return 'external';
}

/** A link to a synced href: router link, new-tab external link, download, phone or email. */
@Component({
  selector: 'app-smart-link',
  imports: [RouterLink, NgTemplateOutlet, CopyPipe],
  template: `
    <ng-template #label><ng-content /></ng-template>
    @switch (kind()) {
      @case ('internal') {
        <a [class]="linkClass()" [routerLink]="target().path" [fragment]="target().fragment">
          <ng-container [ngTemplateOutlet]="label" />
        </a>
      }
      @case ('external') {
        <a [class]="linkClass()" [href]="href()" target="_blank" rel="noopener">
          <ng-container [ngTemplateOutlet]="label" />
          <span class="visually-hidden"> {{ 'opensInNewTab' | copy }}</span>
        </a>
      }
      @default {
        <a
          [class]="linkClass()"
          [href]="href()"
          [attr.download]="kind() === 'document' ? '' : null"
        >
          <ng-container [ngTemplateOutlet]="label" />
        </a>
      }
    }
  `,
  host: { style: 'display: contents' },
})
export class SmartLink {
  readonly href = input.required<string>();
  readonly linkClass = input('');
  protected readonly kind = computed(() => linkKind(this.href()));
  protected readonly target = computed(() => splitHref(this.href()));
}
