import { Component, computed, input } from '@angular/core';
import type { PageDoc } from '@schema/content';
import { MediaImage } from '../../core/media/media-image';
import { Breadcrumbs } from '../../layout/breadcrumbs/breadcrumbs';
import { SmartLink } from '../../shared/smart-link/smart-link';

/** The heading area of inner pages: breadcrumbs, the page's H1 and lede, its CTAs and hero plate. */
@Component({
  selector: 'app-page-hero',
  imports: [Breadcrumbs, MediaImage, SmartLink],
  template: `
    @let p = page();
    <header class="page-hero chart-grid">
      <div class="frame page-hero__inner" [class.page-hero__inner--media]="media()">
        <div class="page-hero__copy">
          @if (p.breadcrumbs.length > 1) {
            <app-breadcrumbs [items]="p.breadcrumbs" />
          }
          <h1 class="page-hero__title">{{ p.hero.title }}</h1>
          @if (p.hero.lede) {
            <p class="page-hero__lede">{{ p.hero.lede }}</p>
          }
          @if (p.hero.ctas.length) {
            <div class="page-hero__ctas">
              @for (cta of p.hero.ctas; track cta.href + cta.label; let first = $first) {
                <app-smart-link
                  [href]="cta.href"
                  [linkClass]="first ? 'btn btn--ink' : 'btn btn--outline'"
                >
                  {{ cta.label }}
                </app-smart-link>
              }
            </div>
          }
        </div>
        @if (media(); as image) {
          <figure class="plate page-hero__plate">
            <span class="plate__frame">
              <app-media-image
                [media]="image"
                sizes="(min-width: 64rem) 36rem, 100vw"
                [priority]="true"
              />
            </span>
          </figure>
        }
      </div>
    </header>
  `,
  styles: `
    :host {
      display: block;
    }
    .page-hero {
      border-bottom: var(--hairline);
    }
    .page-hero__inner {
      display: grid;
      gap: 2rem;
      align-items: end;
      padding-block: clamp(2.5rem, 1.5rem + 4vw, 5rem);
    }
    @media (min-width: 64rem) {
      .page-hero__inner--media {
        grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
        align-items: center;
      }
    }
    .page-hero__copy {
      display: grid;
      gap: 1.25rem;
    }
    .page-hero__title {
      /* 20ch of the display serif, in em so a font swap can't rewrap the headline. */
      max-inline-size: 10.6em;
    }
    .page-hero__lede {
      max-inline-size: 32.5em; /* 58ch of the text face, font-independent */
      font-size: var(--text-lg);
      line-height: var(--text-lg--line-height);
      color: var(--color-ink-2);
    }
    .page-hero__ctas {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
  `,
})
export class PageHero {
  readonly page = input.required<PageDoc>();
  protected readonly media = computed(() => {
    const p = this.page();
    return p.hero.media ? p.media[p.hero.media] : undefined;
  });
}
