/**
 * Builds the site's static media from the synced snapshot (runs before `ng build` / `ng serve`):
 * - responsive AVIF + WebP variants per image (public/media/<id>-<width>.<ext>), never upscaled
 * - a full-size WebP per image (public/media/<id>.webp) for links and redirects
 * - 1200×630 social-share crops for hero and SEO images (public/media/<id>-og.jpg)
 * - cleaned SVGs (public/media/<id>.svg)
 * - documents (public/files/<name>)
 * - favicons and the web manifest from the site's own icon (or logo)
 *
 * Existing outputs are skipped, so re-runs only process new files.
 *
 *   node tools/media/build.ts [--force]
 */
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { availableParallelism } from 'node:os';
import pLimit from 'p-limit';
import sharp from 'sharp';
import subsetFont from 'subset-font';
import { optimize } from 'svgo';
import type { Media, PageDoc, Site } from '../../schema/content.ts';
import { ARCHIVE_DIR, CONTENT_DIR, HTTP_ARCHIVE_DIR, ROOT } from '../content-sync/config.ts';
import type { AssetManifest } from '../content-sync/fetch.ts';

export interface MediaBuildOptions {
  contentDir?: string;
  httpArchiveDir?: string;
  assetManifest?: string;
  publicDir?: string;
  force?: boolean;
  log?: (message: string) => void;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export async function buildMedia(options: MediaBuildOptions = {}): Promise<void> {
  const contentDir = options.contentDir ?? CONTENT_DIR;
  const archive = options.httpArchiveDir ?? HTTP_ARCHIVE_DIR;
  const publicDir = options.publicDir ?? path.join(ROOT, 'public');
  const force = options.force ?? false;
  const log = options.log ?? ((message: string) => console.error(`[media] ${message}`));
  const MEDIA_OUT = path.join(publicDir, 'media');
  const FILES_OUT = path.join(publicDir, 'files');
  const ICONS_OUT = path.join(publicDir, 'icons');
  const build = async (target: string, make: () => Promise<Buffer>): Promise<boolean> => {
    if (!force && (await exists(target))) return false;
    await writeFile(target, await make());
    return true;
  };

  const mediaIndex = await readJson<{ media: Media[] }>(path.join(contentDir, 'media.json'));
  const site = await readJson<Site>(path.join(contentDir, 'site.json'));
  if (!mediaIndex || !site) {
    log('No content snapshot yet (run the content sync); nothing to build.');
    return;
  }
  await mkdir(MEDIA_OUT, { recursive: true });

  // Social-share crops are made for images that pages use as their hero or SEO image.
  const shareIds = new Set<string>();
  for (const file of await readdir(path.join(contentDir, 'pages'))) {
    const page = await readJson<PageDoc>(path.join(contentDir, 'pages', file));
    if (page?.seo.image) shareIds.add(page.seo.image);
    if (page?.hero.media) shareIds.add(page.hero.media);
  }

  let made = 0;
  // One image per core: encoding (AVIF above all) is CPU-bound and sharp works per call.
  const limit = pLimit(availableParallelism());
  await Promise.all(
    mediaIndex.media.map((item) =>
      limit(async () => {
        const source = await readFile(path.join(archive, item.archiveFile));
        if (item.svg) {
          const cleaned = optimize(source.toString('utf8'), {
            multipass: true,
            plugins: [
              'preset-default',
              'removeScripts',
              { name: 'prefixIds', params: { prefix: item.id } },
            ],
          }).data;
          if (await build(path.join(MEDIA_OUT, `${item.id}.svg`), async () => Buffer.from(cleaned)))
            made++;
          return;
        }
        const graphic = item.mime === 'image/png' || item.mime === 'image/gif';
        for (const width of item.widths) {
          const resized = () => sharp(source).rotate().resize({ width, withoutEnlargement: true });
          if (
            await build(path.join(MEDIA_OUT, `${item.id}-${width}.webp`), () =>
              resized()
                .webp({ quality: graphic ? 90 : 76, effort: 5 })
                .toBuffer(),
            )
          )
            made++;
          if (
            await build(path.join(MEDIA_OUT, `${item.id}-${width}.avif`), () =>
              resized()
                .avif({ quality: graphic ? 70 : 52, effort: 4 })
                .toBuffer(),
            )
          )
            made++;
        }
        const top = item.widths[item.widths.length - 1]!;
        if (
          await build(path.join(MEDIA_OUT, `${item.id}.webp`), () =>
            readFile(path.join(MEDIA_OUT, `${item.id}-${top}.webp`)),
          )
        )
          made++;
        if (shareIds.has(item.id)) {
          const og = () =>
            sharp(source)
              .rotate()
              .resize(1200, 630, { fit: 'cover', position: 'attention' })
              .flatten({ background: '#f3f6f8' })
              .jpeg({ quality: 82, mozjpeg: true })
              .toBuffer();
          if (await build(path.join(MEDIA_OUT, `${item.id}-og.jpg`), og)) made++;
        }
      }),
    ),
  );

  // Documents linked from pages move to /files/.
  const assets = await readJson<AssetManifest>(
    options.assetManifest ?? path.join(ARCHIVE_DIR, 'assets.json'),
  );
  let files = 0;
  for (const asset of assets?.assets.filter(
    (a) => a.kind === 'document' && a.status === 200 && a.file,
  ) ?? []) {
    await mkdir(FILES_OUT, { recursive: true });
    const name = decodeURIComponent(new URL(asset.url).pathname.split('/').pop() ?? '');
    const target = path.join(FILES_OUT, name);
    if (force || !(await exists(target))) {
      await copyFile(path.join(archive, asset.file!), target);
      files++;
    }
  }

  // Favicons and the manifest from the site's own icon, else its logo.
  const iconMedia = mediaIndex.media.find((m) => m.id === (site.icon ?? site.logo));
  if (iconMedia) {
    await mkdir(ICONS_OUT, { recursive: true });
    const source = await readFile(path.join(archive, iconMedia.archiveFile));
    const square = (size: number) =>
      sharp(source, { density: 300 })
        .resize(size, size, { fit: 'contain', background: '#f3f6f8' })
        .png()
        .toBuffer();
    for (const [name, size] of [
      ['favicon-32.png', 32],
      ['apple-touch-icon.png', 180],
      ['icon-192.png', 192],
      ['icon-512.png', 512],
    ] as const) {
      if (await build(path.join(ICONS_OUT, name), () => square(size))) made++;
    }
    const manifest = {
      name: site.name,
      short_name: site.name,
      start_url: '/',
      display: 'browser',
      background_color: '#f3f6f8',
      theme_color: '#1e2438',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    };
    await writeFile(
      path.join(publicDir, 'manifest.webmanifest'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
  }

  log(`${mediaIndex.media.length} images: ${made} file(s) built; ${files} document(s) copied.`);
  const arabic = await buildArabicFonts(contentDir, path.join(publicDir, 'fonts'));
  if (arabic) log(arabic);
}

/** Arabic letters and the joiners that shape them. */
const ARABIC_TEXT =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u200C-\u200F]/gu;

/** The Arabic web fonts, cut to the characters the site's Arabic pages use. */
export const ARABIC_FONTS = [
  {
    source:
      'node_modules/@fontsource-variable/noto-sans-arabic/files/noto-sans-arabic-arabic-wght-normal.woff2',
    file: 'noto-sans-arabic-site.woff2',
  },
  {
    source:
      'node_modules/@fontsource-variable/noto-naskh-arabic/files/noto-naskh-arabic-arabic-wght-normal.woff2',
    file: 'noto-naskh-arabic-site.woff2',
  },
] as const;

/**
 * The full Arabic faces are 94 KB and 166 KB; the site's Arabic text uses a few dozen letters.
 * The subsets (HarfBuzz, so the shaping tables for joined forms stay) are about a sixth of that.
 * They are cut from the snapshot on every build, so new content brings its letters along.
 */
export async function buildArabicFonts(
  contentDir: string,
  outDir: string,
): Promise<string | undefined> {
  const texts = [
    await readFile(path.join(contentDir, 'site.json'), 'utf8'),
    await readFile(path.join(ROOT, 'src/app/core/copy/microcopy.ar.json'), 'utf8'),
  ];
  for (const file of await readdir(path.join(contentDir, 'pages'))) {
    if (file.startsWith('ar--'))
      texts.push(await readFile(path.join(contentDir, 'pages', file), 'utf8'));
  }
  const letters = [...new Set(texts.join('').match(ARABIC_TEXT) ?? [])].sort().join('');
  if (!letters) return undefined;
  await mkdir(outDir, { recursive: true });
  const sizes: string[] = [];
  for (const font of ARABIC_FONTS) {
    const subset = await subsetFont(await readFile(path.join(ROOT, font.source)), letters, {
      targetFormat: 'woff2',
    });
    await writeFile(path.join(outDir, font.file), subset);
    sizes.push(`${font.file} ${Math.round(subset.length / 1024)} KB`);
  }
  return `Arabic fonts for ${letters.length} letters: ${sizes.join(', ')}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildMedia({ force: process.argv.includes('--force') });
}
