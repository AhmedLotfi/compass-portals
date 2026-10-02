import { AutoLang } from '../../core/i18n/auto-lang';
import { Component, computed, input } from '@angular/core';
import type { Block, MediaRef } from '@schema/content';
import { MediaImage } from '../../core/media/media-image';
import { SmartLink } from '../smart-link/smart-link';
import { LogoStrip } from './logo-strip';

interface MediaItem {
  media: string;
  caption?: string;
  href?: string;
}

/** Logo rows this long run as the old site's drifting client strip; shorter ones stand still. */
const STRIP_MIN = 6;

/**
 * One image or a gallery, each presented as an atlas plate with its caption; a long row of logos
 * (the site's clients) as the drifting strip of the old home page.
 */
@Component({
  selector: 'app-media-block',
  imports: [AutoLang, LogoStrip, MediaImage, SmartLink],
  template: `
    @if (strip()) {
      <app-logo-strip [items]="items()" [media]="media()" />
    } @else {
    <div
      class="plates"
      [class.plates--gallery]="items().length > 1"
      [class.plates--logos]="logos()"
    >
      @for (item of items(); track item.media) {
        @let image = media()[item.media];
        @if (image) {
          <figure class="plate">
            @if (item.href) {
              <app-smart-link [href]="item.href" linkClass="plate__frame">
                <app-media-image [media]="image" [sizes]="sizes()" />
              </app-smart-link>
            } @else {
              <span class="plate__frame"
                ><app-media-image [media]="image" [sizes]="sizes()"
              /></span>
            }
            @if (item.caption) {
              <figcaption [appAutoLang]="item.caption">{{ item.caption }}</figcaption>
            }
          </figure>
        }
      }
    </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .plates {
      display: grid;
      gap: 1.5rem;
      max-inline-size: 48rem;
    }
    .plates--gallery {
      max-inline-size: none;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
    }
    /* Logos: even cells on a hairline grid, each mark centred and scaled to fit, like a legend. */
    .plates--logos {
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 10rem), 1fr));
      gap: 0;
      border-block-start: var(--hairline);
      border-inline-start: var(--hairline);
    }
    .plates--logos .plate {
      display: grid;
      place-items: center;
      aspect-ratio: 3 / 2;
      padding: 1rem 1.25rem;
      border-block-end: var(--hairline);
      border-inline-end: var(--hairline);
      background: var(--color-paper);
    }
  `,
})
export class MediaBlock {
  readonly block = input.required<Extract<Block, { type: 'media' | 'gallery' }>>();
  readonly media = input.required<Record<string, MediaRef>>();

  protected readonly items = computed<MediaItem[]>(() => {
    const block = this.block();
    return block.type === 'gallery' ? block.items : [block];
  });
  protected readonly logos = computed(() => {
    const block = this.block();
    return block.type === 'gallery' && block.variant === 'logos';
  });
  protected readonly strip = computed(() => this.logos() && this.items().length >= STRIP_MIN);
  protected readonly sizes = computed(() =>
    this.logos()
      ? '10rem'
      : this.items().length > 1
        ? '(min-width: 64rem) 18rem, 50vw'
        : '(min-width: 64rem) 48rem, 100vw',
  );
}
