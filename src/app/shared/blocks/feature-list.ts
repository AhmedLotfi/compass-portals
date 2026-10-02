import { AutoLang } from '../../core/i18n/auto-lang';
import { Component, input } from '@angular/core';
import type { Block } from '@schema/content';
import { Icon, type IconName } from '../../layout/icon/icon';
import { InternalLinks } from './internal-links';

/** The site's icon names (Font Awesome) that have a matching line icon; others use the legend diamond. */
const ICONS: Record<string, IconName> = {
  check: 'check',
  'check-circle': 'check',
  'circle-check': 'check',
  'check-square': 'check',
  'check-double': 'check',
  phone: 'phone',
  'phone-alt': 'phone',
  envelope: 'mail',
  'map-marker': 'pin',
  'map-marker-alt': 'pin',
  'location-dot': 'pin',
  download: 'download',
};

@Component({
  selector: 'app-feature-list',
  imports: [AutoLang, Icon, InternalLinks],
  template: `
    @let list = block();
    @if (list.title) {
      <h3 class="feature-list__title" [appAutoLang]="list.title">{{ list.title }}</h3>
    }
    <ul class="feature-list" appInternalLinks>
      @for (item of list.items; track $index) {
        <li class="feature-list__item">
          @let icon = iconFor(item.icon);
          @if (icon) {
            <app-icon class="feature-list__icon" [name]="icon" />
          } @else {
            <span class="feature-list__marker" aria-hidden="true"></span>
          }
          <div class="feature-list__text">
            @if (item.title) {
              <strong class="feature-list__name" [appAutoLang]="item.title">{{
                item.title
              }}</strong>
            }
            @if (item.html) {
              <div class="feature-list__body" [innerHTML]="item.html"></div>
            }
          </div>
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: block;
    }
    .feature-list__title {
      margin-bottom: 1rem;
    }
    .feature-list {
      display: grid;
      gap: 0.75rem 2.5rem;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    @media (min-width: 48rem) {
      .feature-list {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    .feature-list__item {
      display: grid;
      grid-template-columns: 1.5rem minmax(0, 1fr);
      gap: 0.75rem;
      align-items: start;
      padding-block: 0.8rem;
      border-top: var(--hairline);
    }
    .feature-list__name {
      display: block;
    }
    /* Site text can be several paragraphs (an office's address, phone and email). */
    .feature-list__body > :is(p, ul, ol) {
      margin: 0;
    }
    .feature-list__body > * + * {
      margin-top: 0.35rem;
    }
    .feature-list__icon {
      margin-top: 0.1rem;
      color: var(--color-accent-deep);
    }
    .feature-list__marker {
      inline-size: 0.55rem;
      block-size: 0.55rem;
      margin: 0.55rem 0 0 0.35rem;
      background: var(--color-accent);
      transform: rotate(45deg);
    }
    .feature-list__text strong {
      display: block;
    }
  `,
})
export class FeatureList {
  readonly block = input.required<Extract<Block, { type: 'featureList' }>>();

  protected iconFor(name: string | undefined): IconName | undefined {
    return name ? ICONS[name] : undefined;
  }
}
