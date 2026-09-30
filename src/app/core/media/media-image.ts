import { NgOptimizedImage } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import type { MediaRef } from '@schema/content';

/**
 * A synced image: AVIF with a WebP fallback at the widths that exist, never upscaled.
 * Priority images (the LCP candidate) skip the AVIF source so the preload matches the download.
 */
@Component({
  selector: 'app-media-image',
  imports: [NgOptimizedImage],
  template: `
    @let image = media();
    @if (image.svg) {
      <img
        [ngSrc]="image.id"
        [loaderParams]="{ svg: true }"
        [width]="image.width"
        [height]="image.height"
        [alt]="alt() ?? image.alt"
        [priority]="priority()"
        disableOptimizedSrcset
      />
    } @else {
      <picture>
        @if (!priority()) {
          <source type="image/avif" [attr.srcset]="avifSrcset()" [attr.sizes]="sizes()" />
        }
        <img
          [ngSrc]="image.id"
          [ngSrcset]="widthDescriptors()"
          [sizes]="sizes()"
          [width]="image.width"
          [height]="image.height"
          [alt]="alt() ?? image.alt"
          [priority]="priority()"
          [loaderParams]="{ widths: image.widths }"
          [placeholder]="image.placeholder ?? false"
        />
      </picture>
    }
  `,
  host: {
    // Never render wider than the file itself: synced images are not upscaled.
    '[style.max-inline-size.px]': 'media().width',
  },
  styles: `
    :host {
      display: block;
    }
    img {
      inline-size: 100%;
      block-size: auto;
    }
  `,
})
export class MediaImage {
  readonly media = input.required<MediaRef>();
  /** The `sizes` attribute: how wide the image renders at each breakpoint. */
  readonly sizes = input('100vw');
  readonly priority = input(false);
  /** Overrides the synced alt text (e.g. `''` when the image is decorative in this context). */
  readonly alt = input<string>();

  protected readonly widthDescriptors = computed(() =>
    this.media()
      .widths.map((w) => `${w}w`)
      .join(', '),
  );
  protected readonly avifSrcset = computed(() => {
    const { id, widths } = this.media();
    return widths.map((w) => `/media/${id}-${w}.avif ${w}w`).join(', ');
  });
}
