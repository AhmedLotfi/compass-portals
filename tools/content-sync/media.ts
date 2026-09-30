import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Media } from '../../schema/content.ts';
import { HTTP_ARCHIVE_DIR } from './config.ts';
import type { RestMediaSummary } from './discover.ts';
import type { AssetEntry, AssetManifest } from './fetch.ts';
import { largestFromSrcset, resolveUrl, stripSizeSuffix, unwrapJetpack } from './url.ts';

/** Responsive widths generated for photos and graphics; never larger than the original. */
export const MEDIA_WIDTHS = [320, 480, 640, 768, 960, 1280, 1600, 1920];
export const MAX_WIDTH = 1920;

export interface ImageRef {
  src: string;
  srcset?: string;
  alt: string | null;
  caption?: string;
}

interface Pending {
  id: string;
  sourceUrl: string;
  archiveFile: string;
  alt: string;
  altSource: Media['altSource'];
  caption?: string;
  usedOn: Set<string>;
}

const ALT_RANK: Record<Media['altSource'], number> = {
  wordpress: 4,
  html: 3,
  caption: 2,
  derived: 1,
  decorative: 0,
};

export class MediaRegistry {
  readonly missing: { url: string; page: string }[] = [];
  private readonly items = new Map<string, Pending>();
  private readonly assetsByUrl = new Map<string, AssetEntry>();
  private readonly restByUrl = new Map<string, RestMediaSummary>();
  private readonly resolved: Record<string, string>;
  private readonly archiveDir: string;

  constructor(options: {
    assets: AssetManifest;
    restMedia: RestMediaSummary[];
    archiveDir?: string;
  }) {
    this.resolved = options.assets.resolved;
    this.archiveDir = options.archiveDir ?? HTTP_ARCHIVE_DIR;
    for (const asset of options.assets.assets) this.assetsByUrl.set(asset.url, asset);
    for (const media of options.restMedia) {
      this.restByUrl.set(media.url, media);
      for (const size of media.sizes) this.restByUrl.set(size, media);
    }
  }

  private assetFor(url: string): AssetEntry | undefined {
    const target = this.resolved[url] ?? this.resolved[unwrapJetpack(url)];
    const asset = target ? this.assetsByUrl.get(target) : undefined;
    return asset?.sha256 && asset.file && asset.status === 200 ? asset : undefined;
  }

  /** Registers an image used on a page and returns its media id (undefined if the file is missing). */
  register(ref: ImageRef, page: { id: string; url: string }, context?: string): string | undefined {
    const candidates = [
      largestFromSrcset(ref.srcset, page.url),
      resolveUrl(ref.src, page.url)?.href,
    ].filter((u): u is string => Boolean(u));
    let asset: AssetEntry | undefined;
    let referenced = candidates[0];
    for (const candidate of candidates) {
      asset = this.assetFor(candidate);
      if (asset) {
        referenced = candidate;
        break;
      }
    }
    if (!asset || !referenced) {
      this.missing.push({ url: candidates[0] ?? ref.src, page: page.id });
      return undefined;
    }

    const id = `m-${asset.sha256!.slice(0, 10)}`;
    const rest =
      this.restByUrl.get(asset.url) ??
      this.restByUrl.get(unwrapJetpack(referenced)) ??
      this.restByUrl.get(stripSizeSuffix(unwrapJetpack(referenced)));
    const caption = ref.caption || rest?.caption || undefined;
    let alt = '';
    let altSource: Media['altSource'] = 'decorative';
    if (rest?.alt.trim()) {
      alt = rest.alt.trim();
      altSource = 'wordpress';
    } else if (ref.alt?.trim()) {
      alt = ref.alt.trim();
      altSource = 'html';
    } else if (caption) {
      alt = caption;
      altSource = 'caption';
    } else if (ref.alt === null && context) {
      // No alt attribute at all: describe it with the nearby site text, flagged for review.
      alt = context;
      altSource = 'derived';
    }

    const existing = this.items.get(id);
    if (existing) {
      existing.usedOn.add(page.id);
      if (ALT_RANK[altSource] > ALT_RANK[existing.altSource]) {
        existing.alt = alt;
        existing.altSource = altSource;
      }
      if (!existing.caption && caption) existing.caption = caption;
      return id;
    }
    this.items.set(id, {
      id,
      sourceUrl: asset.url,
      archiveFile: asset.file!,
      alt,
      altSource,
      ...(caption ? { caption } : {}),
      usedOn: new Set([page.id]),
    });
    return id;
  }

  /** The new public URL for an uploaded image (its largest variant), for links that point at files. */
  hrefFor(url: string): string | undefined {
    const asset = this.assetFor(url);
    return asset ? `/media/m-${asset.sha256!.slice(0, 10)}.webp` : undefined;
  }

  /** Reads every registered file for dimensions and placeholders. */
  async finalize(): Promise<Media[]> {
    const media: Media[] = [];
    for (const item of [...this.items.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const buffer = await readFile(path.join(this.archiveDir, item.archiveFile));
      const image = sharp(buffer, { animated: false });
      const meta = await image.metadata();
      const svg = meta.format === 'svg';
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      if (!width || !height) {
        this.missing.push({ url: item.sourceUrl, page: [...item.usedOn][0] ?? '' });
        continue;
      }
      const widths = svg ? [] : variantWidths(width);
      let placeholder: string | undefined;
      // Blurred previews suit photos only; flat graphics (PNG/GIF logos, icons) render crisp at once.
      if (!svg && !meta.hasAlpha && (meta.format === 'jpeg' || meta.format === 'webp')) {
        const tiny = await sharp(buffer).resize(16).webp({ quality: 40 }).toBuffer();
        placeholder = `data:image/webp;base64,${tiny.toString('base64')}`;
      }
      media.push({
        id: item.id,
        sourceUrl: item.sourceUrl,
        archiveFile: item.archiveFile,
        mime: svg ? 'image/svg+xml' : `image/${meta.format === 'jpeg' ? 'jpeg' : meta.format}`,
        width,
        height,
        alt: item.alt,
        altSource: item.altSource,
        ...(item.caption ? { caption: item.caption } : {}),
        widths,
        svg,
        ...(placeholder ? { placeholder } : {}),
        usedOn: [...item.usedOn].sort(),
      });
    }
    return media;
  }
}

/** Standard widths below the original, plus the original (capped at MAX_WIDTH). */
export function variantWidths(width: number): number[] {
  const top = Math.min(width, MAX_WIDTH);
  const widths = MEDIA_WIDTHS.filter((w) => w < top);
  widths.push(top);
  return widths;
}
