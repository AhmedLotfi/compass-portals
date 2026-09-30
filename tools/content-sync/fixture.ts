/**
 * Generates a synthetic content snapshot from the fake WordPress test site into .cache/fixture/, so the
 * app can be developed and tested before the real site can be synced. It never ships: production
 * builds read src/content/ only; the `fixture` build configuration points `@content/*` here instead.
 *
 *   node tools/content-sync/fixture.ts [--if-missing]
 */
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { buildMedia } from '../media/build.ts';
import { ROOT, SITE_ORIGIN } from './config.ts';
import { buildFakeSnapshot } from './testing/fake-snapshot.ts';

export const FIXTURE_DIR = path.join(ROOT, '.cache/fixture');

export async function buildFixture(): Promise<void> {
  const archiveDir = path.join(FIXTURE_DIR, 'archive');
  const contentDir = path.join(FIXTURE_DIR, 'content');
  const publicDir = path.join(FIXTURE_DIR, 'public');
  await rm(FIXTURE_DIR, { recursive: true, force: true });
  const result = await buildFakeSnapshot({ archiveDir, contentDir, origin: SITE_ORIGIN });
  await buildMedia({
    contentDir,
    httpArchiveDir: archiveDir,
    assetManifest: result.assetManifest,
    publicDir,
    log: () => undefined,
  });
  console.error(
    `[fixture] Synthetic snapshot in .cache/fixture: ${result.docs.length} pages, ${result.media.length} images.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ifMissing = process.argv.includes('--if-missing');
  const exists = await stat(path.join(FIXTURE_DIR, 'content/site.json')).then(
    () => true,
    () => false,
  );
  if (!(ifMissing && exists)) await buildFixture();
}
