import { NgOptimizedImage } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import type { MediaRef } from '@schema/content';

/** Narrow screens, where the CMS's phone-sized picture of a slide is shown (as on the old site). */
export const PHONE_MEDIA = '(max-width: 43.75rem)';

/**
 * A synced image: AVIF with a WebP fallback at the widths that exist, never upscaled.
 * Priority images (the LCP candidate) skip the AVIF source so the preload matches the download.
 * With `mobile`, phones get that picture instead (the home slides have one), through `<source>`.
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
        @if (phone(); as phone) {
          @if (!priority()) {
            <source
              type="image/avif"
              [media]="phoneMedia"
              [attr.srcset]="srcset(phone, 'avif')"
              [attr.sizes]="sizes()"
            />
          }
          <source
            type="image/webp"
            [media]="phoneMedia"
            [attr.srcset]="srcset(phone, 'webp')"
            [attr.sizes]="sizes()"
          />
        }
        @if (!priority()) {
          <source type="image/avif" [attr.srcset]="srcset(image, 'avif')" [attr.sizes]="sizes()" />
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
    '[style.max-inline-size.px]': 'fit() === "width" ? media().width : null',
    '[class.fit-contain]': 'fit() === "contain"',
  },
  styles: `
    :host {
      display: block;
    }
    img {
      inline-size: 100%;
      block-size: auto;
    }
    /* Contained: the picture scales to fit the box it is given, keeping its proportions. */
    :host(.fit-contain) {
      display: grid;
      place-items: center;
      inline-size: 100%;
      block-size: 100%;
    }
    :host(.fit-contain) picture {
      display: contents;
    }
    :host(.fit-contain) img {
      inline-size: 100%;
      block-size: 100%;
      object-fit: contain;
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
  /** The picture phones get instead (same alt, same place). */
  readonly mobile = input<MediaRef>();
  /** `width`: as wide as its box (default). `contain`: fitted inside the box, both ways. */
  readonly fit = input<'width' | 'contain'>('width');

  protected readonly phoneMedia = PHONE_MEDIA;
  /** The phone picture, when it is a different file from the main one. */
  protected readonly phone = computed(() => {
    const phone = this.mobile();
    return phone && phone.id !== this.media().id && !phone.svg ? phone : undefined;
  });

  protected readonly widthDescriptors = computed(() =>
    this.media()
      .widths.map((w) => `${w}w`)
      .join(', '),
  );

  protected srcset(image: MediaRef, format: 'avif' | 'webp'): string {
    return image.widths.map((w) => `/media/${image.id}-${w}.${format} ${w}w`).join(', ');
  }
}
