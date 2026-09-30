/**
 * Runs the whole sync against the fake WordPress site and writes the snapshot, for tests and the
 * development fixture.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { discover } from '../discover.ts';
import { fetchAssets, writeAssetManifest } from '../fetch.ts';
import { HttpClient } from '../http.ts';
import { runSync, writeSnapshot, type SyncResult } from '../sync.ts';
import { startFakeWordPress } from './fake-wordpress.ts';

export interface FakeSnapshotOptions {
  archiveDir: string;
  contentDir: string;
  /** Canonical origin of the new site. */
  origin: string;
}

export async function buildFakeSnapshot(
  options: FakeSnapshotOptions,
): Promise<SyncResult & { assetManifest: string }> {
  const { archiveDir, contentDir, origin } = options;
  await mkdir(archiveDir, { recursive: true });
  const site = await startFakeWordPress();
  try {
    const online = new HttpClient({ archiveDir, gapMs: 0, retries: 0 });
    const inventory = await discover({ origin: site.origin, siteHosts: [site.host], http: online });
    const assets = await fetchAssets(inventory, online, { siteHosts: [site.host] });
    await online.save();
    const assetManifest = path.join(archiveDir, 'assets.json');
    await writeAssetManifest(assets, assetManifest);
    const result = await runSync({
      inventory,
      assets,
      http: new HttpClient({ archiveDir, offline: true }),
      siteHosts: [site.host],
      origin,
      source: site.origin,
      outDir: contentDir,
      archiveDir,
      syncedAt: '2026-01-01T00:00:00.000Z',
    });
    await writeSnapshot(contentDir, result.files);
    return { ...result, assetManifest };
  } finally {
    await site.close();
  }
}
