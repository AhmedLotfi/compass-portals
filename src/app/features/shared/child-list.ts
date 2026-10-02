import { AutoLang } from '../../core/i18n/auto-lang';
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { MediaRef, RouteCard } from '@schema/content';
import { MediaImage } from '../../core/media/media-image';
import { Icon, isIconName, type IconName } from '../../layout/icon/icon';
import { Reveal } from '../../shared/reveal';

/** Child pages of an index page (e.g. a category's products), as cards with their picture or icon. */
@Component({
  selector: 'app-child-list',
  imports: [AutoLang, RouterLink, Icon, MediaImage, Reveal],
  template: `
    <section class="rail-section" appReveal [attr.aria-label]="label()">
      <div aria-hidden="true"></div>
      <ul class="children">
        @for (child of items(); track child.id; let first = $first) {
          @let image = child.media ? media()[child.media] : undefined;
          <li class="children__item card card--link reveal-item" [style.--i]="$index">
            @if (image) {
              <a class="children__plate" [routerLink]="child.path" tabindex="-1" aria-hidden="true">
                <!-- The first plate is often the largest thing in view on phones. -->
                <app-media-image
                  [media]="image"
                  sizes="(min-width: 64rem) 22rem, (min-width: 40rem) 45vw, 100vw"
                  alt=""
                  [priority]="first"
                />
              </a>
            } @else if (iconFor(child.icon); as icon) {
              <span class="icon-tile" aria-hidden="true"><app-icon [name]="icon" /></span>
            } @else {
              <span class="children__marker" aria-hidden="true"></span>
            }
            <div class="children__body">
              <h2 class="children__title">
                <a [routerLink]="child.path" [appAutoLang]="child.title">{{ child.title }}</a>
              </h2>
              @if (child.summary) {
                <p class="children__summary" [appAutoLang]="child.summary">{{ child.summary }}</p>
              }
            </div>
          </li>
        }
      </ul>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .children {
      display: grid;
      gap: 1.25rem;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    @media (min-width: 40rem) {
      .children {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    .children__item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1.25rem;
      padding: 1.5rem;
      min-inline-size: 0;
    }
    .children__marker {
      inline-size: 0.6rem;
      block-size: 0.6rem;
      margin: 0.75rem 0 0 0.25rem;
      background: var(--color-accent);
      transform: rotate(45deg);
    }
    .children__plate {
      display: block;
      inline-size: 100%;
      padding: 0.35rem;
      box-sizing: border-box;
      border: var(--hairline);
      border-radius: var(--radius-sm);
      background: var(--color-paper);
    }
    .children__plate app-media-image {
      margin-inline: auto;
    }
    .children__title {
      font-size: var(--text-xl);
      line-height: var(--text-xl--line-height);
    }
    .children__title a {
      text-decoration: none;
    }
    .children__title a:hover {
      text-decoration: underline;
      text-decoration-color: var(--color-accent);
    }
    .children__summary {
      margin-top: 0.6rem;
      max-inline-size: 62ch;
      color: var(--color-ink-2);
    }
  `,
})
export class ChildList {
  readonly items = input.required<RouteCard[]>();
  readonly media = input.required<Record<string, MediaRef>>();
  readonly label = input.required<string>();

  protected iconFor(name: string | undefined): IconName | undefined {
    return name && isIconName(name) ? name : undefined;
  }
}
