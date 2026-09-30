import { Component, computed, input } from '@angular/core';
import type { Block, MediaRef } from '@schema/content';
import { MediaImage } from '../../core/media/media-image';
import { SmartLink } from '../smart-link/smart-link';

interface MediaItem {
  media: string;
  caption?: string;
  href?: string;
}

/** One image or a gallery, each presented as an atlas plate with its caption. */
@Component({
  selector: 'app-media-block',
  imports: [MediaImage, SmartLink],
  template: `
    <div class="plates" [class.plates--gallery]="items().length > 1">
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
              <figcaption>{{ item.caption }}</figcaption>
            }
          </figure>
        }
      }
    </div>
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
  `,
})
export class MediaBlock {
  readonly block = input.required<Extract<Block, { type: 'media' | 'gallery' }>>();
  readonly media = input.required<Record<string, MediaRef>>();

  protected readonly items = computed<MediaItem[]>(() => {
    const block = this.block();
    return block.type === 'gallery' ? block.items : [block];
  });
  protected readonly sizes = computed(() =>
    this.items().length > 1 ? '(min-width: 64rem) 18rem, 50vw' : '(min-width: 64rem) 48rem, 100vw',
  );
}
