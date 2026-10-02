import { AutoLang } from '../../core/i18n/auto-lang';
import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import type { Block, MediaRef } from '@schema/content';
import { MediaImage } from '../../core/media/media-image';
import { Icon, isIconName, type IconName } from '../../layout/icon/icon';
import { SmartLink } from '../smart-link/smart-link';
import { InternalLinks } from './internal-links';

/**
 * Repeated cards from the site (products, modules, team members), drawn as the old site draws its
 * catalog: a card with the catalog icon or picture, the title, a line of text and the link. Cards
 * that lead somewhere lift under the pointer; in a revealed section they fade up one by one.
 */
@Component({
  selector: 'app-module-grid',
  imports: [AutoLang, Icon, MediaImage, SmartLink, InternalLinks, NgTemplateOutlet],
  template: `
    @let grid = block();
    @if (grid.title) {
      @if (level() === 2) {
        <h2 class="module-grid__title" [appAutoLang]="grid.title">{{ grid.title }}</h2>
      } @else {
        <h3 class="module-grid__title" [appAutoLang]="grid.title">{{ grid.title }}</h3>
      }
    }
    <ul class="module-grid" [class.module-grid--media]="hasMedia()">
      @for (item of grid.items; track $index) {
        <li
          class="module-grid__item card reveal-item"
          [class.card--link]="item.href"
          [style.--i]="$index"
        >
          @if (item.media && media()[item.media]) {
            <span class="module-grid__plate">
              <app-media-image
                [media]="media()[item.media]!"
                sizes="(min-width: 64rem) 18rem, (min-width: 48rem) 40vw, 100vw"
              />
            </span>
          } @else if (iconFor(item.icon); as icon) {
            <span class="icon-tile module-grid__icon" aria-hidden="true">
              <app-icon [name]="icon" />
            </span>
          } @else {
            <span class="module-grid__marker" aria-hidden="true"></span>
          }
          <div class="module-grid__body">
            <ng-template #name>
              @if (item.href) {
                <app-smart-link [href]="item.href" linkClass="module-grid__link">{{
                  item.title
                }}</app-smart-link>
              } @else {
                {{ item.title }}
              }
            </ng-template>
            @switch (itemLevel()) {
              @case (2) {
                <h2 class="module-grid__name" [appAutoLang]="item.title">
                  <ng-container [ngTemplateOutlet]="name" />
                </h2>
              }
              @case (3) {
                <h3 class="module-grid__name" [appAutoLang]="item.title">
                  <ng-container [ngTemplateOutlet]="name" />
                </h3>
              }
              @default {
                <h4 class="module-grid__name" [appAutoLang]="item.title">
                  <ng-container [ngTemplateOutlet]="name" />
                </h4>
              }
            }
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
      gap: 1.25rem;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    @media (min-width: 40rem) {
      .module-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (min-width: 72rem) {
      .module-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
    .module-grid__item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1.25rem;
      padding: 1.5rem;
      min-inline-size: 0;
    }
    .module-grid__marker {
      inline-size: 0.6rem;
      block-size: 0.6rem;
      margin: 0.65rem 0 0 0.25rem;
      background: var(--color-accent);
      transform: rotate(45deg);
    }
    .module-grid__plate {
      display: block;
      inline-size: 100%;
      padding: 0.25rem;
      box-sizing: border-box;
      border: var(--hairline);
      border-radius: var(--radius-sm);
      background: var(--color-paper);
    }
    .module-grid__plate app-media-image {
      margin-inline: auto;
    }
    .module-grid__body {
      display: flex;
      flex: 1;
      flex-direction: column;
      inline-size: 100%;
    }
    .module-grid__name {
      font-size: var(--text-lg);
      line-height: var(--text-lg--line-height);
    }
    .module-grid__link {
      text-decoration: none;
    }
    .module-grid__link:hover {
      text-decoration: underline;
      text-decoration-color: var(--color-accent);
    }
    .module-grid__text {
      margin-top: 0.5rem;
      color: var(--color-ink-2);
      font-size: var(--text-sm);
      line-height: var(--text-sm--line-height);
    }
  `,
})
export class ModuleGrid {
  readonly block = input.required<Extract<Block, { type: 'moduleGrid' }>>();
  readonly media = input.required<Record<string, MediaRef>>();
  /** Heading level for the grid's title: 2 in a section without its own title, else 3. */
  readonly level = input<2 | 3>(3);
  /** Card titles sit one level under the grid title, or at its level when there is none. */
  protected readonly itemLevel = computed(() => this.level() + (this.block().title ? 1 : 0));

  protected hasMedia(): boolean {
    return this.block().items.some((item) => item.media && this.media()[item.media]);
  }

  protected iconFor(name: string | undefined): IconName | undefined {
    return name && isIconName(name) ? name : undefined;
  }
}
