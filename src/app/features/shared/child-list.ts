import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { MediaRef, RouteCard } from '@schema/content';
import { MediaImage } from '../../core/media/media-image';

/** Child pages of an index page (e.g. a category's products) as a map legend with plates. */
@Component({
  selector: 'app-child-list',
  imports: [RouterLink, MediaImage],
  template: `
    <section class="rail-section" [attr.aria-label]="label()">
      <div aria-hidden="true"></div>
      <ul class="children">
        @for (child of items(); track child.id; let first = $first) {
          @let image = child.media ? media()[child.media] : undefined;
          <li class="children__item" [class.children__item--media]="image">
            @if (image) {
              <a class="children__plate" [routerLink]="child.path" tabindex="-1" aria-hidden="true">
                <!-- The first plate is often the largest thing in view on phones. -->
                <app-media-image
                  [media]="image"
                  sizes="(min-width: 64rem) 16rem, 40vw"
                  alt=""
                  [priority]="first"
                />
              </a>
            } @else {
              <span class="children__marker" aria-hidden="true"></span>
            }
            <div class="children__body">
              <h2 class="children__title">
                <a [routerLink]="child.path">{{ child.title }}</a>
              </h2>
              @if (child.summary) {
                <p class="children__summary">{{ child.summary }}</p>
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
      list-style: none;
      margin: 0;
      padding: 0;
      border-top: var(--ink-line);
    }
    .children__item {
      display: grid;
      grid-template-columns: 1.25rem minmax(0, 1fr);
      gap: 1rem;
      padding-block: 1.5rem;
      border-bottom: var(--hairline);
    }
    .children__item--media {
      grid-template-columns: minmax(7rem, 16rem) minmax(0, 1fr);
      gap: 1.5rem;
    }
    .children__marker {
      inline-size: 0.6rem;
      block-size: 0.6rem;
      margin: 0.75rem 0 0 0.25rem;
      background: var(--color-brass);
      transform: rotate(45deg);
    }
    .children__plate {
      display: block;
      padding: 0.35rem;
      border: var(--ink-line);
      background: var(--color-white);
    }
    .children__title {
      font-size: var(--text-xl);
      line-height: var(--text-xl--line-height);
    }
    .children__title a {
      text-decoration-color: var(--color-brass);
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
}
