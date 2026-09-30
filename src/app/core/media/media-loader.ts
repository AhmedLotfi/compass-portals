import type { ImageLoaderConfig } from '@angular/common';

/**
 * NgOptimizedImage loader for synced images: `ngSrc` is the media id, and `loaderParams.widths`
 * lists the variant widths that exist, so every requested width maps to a real file.
 */
export function mediaLoader(config: ImageLoaderConfig): string {
  if (config.loaderParams?.['svg']) return `/media/${config.src}.svg`;
  const widths = (config.loaderParams?.['widths'] as number[] | undefined) ?? [];
  const requested = config.width ?? widths[widths.length - 1];
  const width =
    widths.find((w) => requested !== undefined && w >= requested) ?? widths[widths.length - 1];
  return width ? `/media/${config.src}-${width}.webp` : `/media/${config.src}.webp`;
}
