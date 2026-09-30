import { Component, input } from '@angular/core';
import type { Block, MediaRef } from '@schema/content';
import { MediaImage } from '../../core/media/media-image';
import { SmartLink } from '../smart-link/smart-link';
import { InternalLinks } from './internal-links';

/** Repeated cards from the site (products, modules), laid out as a map legend rather than a card kit. */
@Component({
  selector: 'app-module-grid',
  imports: [MediaImage, SmartLink, InternalLinks],
  template: `
    @let grid = block();
    @if (grid.title) {
      <h3 class="module-grid__title">{{ grid.title }}</h3>
    }
    <ul class="module-grid" [class.module-grid--media]="hasMedia()">
      @for (item of grid.items; track $index) {
        <li class="module-grid__item">
          @if (item.media && media()[item.media]) {
            <span class="module-grid__plate">
              <app-media-image
                [media]="media()[item.media]!"
                sizes="(min-width: 64rem) 12rem, 30vw"
              />
            </span>
          } @else {
            <span class="module-grid__marker" aria-hidden="true"></span>
          }
          <div class="module-grid__body">
            <h3 class="module-grid__name">
              @if (item.href) {
                <app-smart-link [href]="item.href" linkClass="module-grid__link">{{
                  item.title
                }}</app-smart-link>
              } @else {
                {{ item.title }}
              }
            </h3>
            @if (item.html) {
              <div
                class="module-grid__text prose-chart"
                appInternalLinks
                [innerHTML]="item.html"
              ></div>
            }
            @if (item.href && item.linkLabel) {
              <!-- The card's title completes generic link text ("Read more") for screen readers. -->
              <app-smart-link [href]="item.href" linkClass="module-grid__more"
                >{{ item.linkLabel
                }}<span class="visually-hidden">: {{ item.title }}</span></app-smart-link
              >
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
    .module-grid__title {
      margin-bottom: 1rem;
    }
    .module-grid {
      display: grid;
      gap: 0 2.5rem;
      list-style: none;
      margin: 0;
      padding: 0;
      border-top: var(--ink-line);
    }
    @media (min-width: 48rem) {
      .module-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    .module-grid__item {
      display: grid;
      grid-template-columns: 1.25rem minmax(0, 1fr);
      gap: 0.9rem;
      align-items: start;
      padding-block: 1.25rem;
      border-bottom: var(--hairline);
    }
    .module-grid--media .module-grid__item {
      grid-template-columns: 6.5rem minmax(0, 1fr);
      gap: 1.25rem;
    }
    .module-grid__marker {
      inline-size: 0.6rem;
      block-size: 0.6rem;
      margin: 0.65rem 0 0 0.25rem;
      background: var(--color-brass);
      transform: rotate(45deg);
    }
    .module-grid__plate {
      display: block;
      padding: 0.25rem;
      border: var(--ink-line);
      background: var(--color-white);
    }
    .module-grid__name {
      font-size: var(--text-lg);
      line-height: var(--text-lg--line-height);
    }
    .module-grid__text {
      margin-top: 0.4rem;
      color: var(--color-ink-2);
    }
  `,
})
export class ModuleGrid {
  readonly block = input.required<Extract<Block, { type: 'moduleGrid' }>>();
  readonly media = input.required<Record<string, MediaRef>>();

  protected hasMedia(): boolean {
    return this.block().items.some((item) => item.media && this.media()[item.media]);
  }
}
