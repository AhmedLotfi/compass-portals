/**
 * Generates a synthetic content snapshot from the fake WordPress test site into .cache/fixture/, so the
 * app can be developed and tested before the real site can be synced. It never ships: production
 * builds read src/content/ only; the `fixture` build configuration points `@content/*` here instead.
 *
 *   node tools/content-sync/fixture.ts [--if-missing]
 */
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { buildMedia } from '../media/build.ts';
import { ROOT, SITE_ORIGIN } from './config.ts';
import { discover } from './discover.ts';
import { fetchAssets, writeAssetManifest } from './fetch.ts';
import { HttpClient } from './http.ts';
import { runSync, writeSnapshot } from './sync.ts';
import { startFakeWordPress } from './testing/fake-wordpress.ts';

export const FIXTURE_DIR = path.join(ROOT, '.cache/fixture');

export async function buildFixture(): Promise<void> {
  const archiveDir = path.join(FIXTURE_DIR, 'archive');
  const contentDir = path.join(FIXTURE_DIR, 'content');
  const publicDir = path.join(FIXTURE_DIR, 'public');
  await rm(FIXTURE_DIR, { recursive: true, force: true });
  await mkdir(archiveDir, { recursive: true });

  const site = await startFakeWordPress();
  try {
    const online = new HttpClient({ archiveDir, gapMs: 0, retries: 0 });
    const inventory = await discover({ origin: site.origin, siteHosts: [site.host], http: online });
    const assets = await fetchAssets(inventory, online, { siteHosts: [site.host] });
    await online.save();
    const manifest = path.join(archiveDir, 'assets.json');
    await writeAssetManifest(assets, manifest);

    const result = await runSync({
      inventory,
      assets,
      http: new HttpClient({ archiveDir, offline: true }),
      siteHosts: [site.host],
      origin: SITE_ORIGIN,
      source: site.origin,
      outDir: contentDir,
      archiveDir,
      syncedAt: '2026-01-01T00:00:00.000Z',
    });
    await writeSnapshot(contentDir, result.files);
    await buildMedia({
      contentDir,
      httpArchiveDir: archiveDir,
      assetManifest: manifest,
      publicDir,
      log: () => undefined,
    });
    console.error(
      `[fixture] Synthetic snapshot in .cache/fixture: ${result.docs.length} pages, ${result.media.length} images.`,
    );
  } finally {
    await site.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ifMissing = process.argv.includes('--if-missing');
  const exists = await stat(path.join(FIXTURE_DIR, 'content/site.json')).then(
    () => true,
    () => false,
  );
  if (!(ifMissing && exists)) await buildFixture();
}
