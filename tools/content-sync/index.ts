/**
 * Content sync CLI.
 *
 *   node tools/content-sync/index.ts probe      Fingerprint the site (platform, REST API, permalinks)
 *   node tools/content-sync/index.ts discover   Inventory every page, menu, image, document, contact detail
 *   node tools/content-sync/index.ts fetch      Download every image, document and builder stylesheet
 *   node tools/content-sync/index.ts sync       Normalize → emit src/content → verify coverage (offline)
 *   node tools/content-sync/index.ts all        discover + fetch + sync
 *
 * Options: --offline (use source-archive/ only), --check (sync: report differences, write nothing),
 *          --max-pages=N (discover)
 */
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CONTENT_DIR,
  RENDER_DIR,
  REPORTS_DIR,
  SITE_HOSTS,
  SITE_ORIGIN,
  SOURCE_ORIGIN,
  ASSET_HOSTS,
  ROOT,
} from './config.ts';
import { discover, type Inventory } from './discover.ts';
import { ASSET_MANIFEST, fetchAssets, writeAssetManifest, type AssetManifest } from './fetch.ts';
import { HttpClient, NetworkPolicyError } from './http.ts';
import { inventoryMarkdown } from './report.ts';
import { coverageMarkdown, runSync, snapshotDiff, writeSnapshot, type Waiver } from './sync.ts';

// Node's built-in fetch only honours HTTPS_PROXY when NODE_USE_ENV_PROXY=1 is set at startup.
if (process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
  const result = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(result.status ?? 1);
}

const [stage = 'help', ...flags] = process.argv.slice(2);
const offline = flags.includes('--offline');
const check = flags.includes('--check');
const maxPagesFlag = flags.find((f) => f.startsWith('--max-pages='));
const maxPages = maxPagesFlag ? Number(maxPagesFlag.split('=')[1]) : undefined;
const log = (message: string) => console.error(`[content-sync] ${message}`);

const INVENTORY_FILE = path.join(REPORTS_DIR, 'inventory.json');
const WAIVERS_FILE = path.join(ROOT, 'tools/content-sync/waivers.json');

async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
}

async function readJson<T>(file: string, fallback?: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (error) {
    if (fallback !== undefined && (error as NodeJS.ErrnoException).code === 'ENOENT')
      return fallback;
    throw error;
  }
}

async function runDiscover(probeOnly: boolean): Promise<Inventory> {
  const http = new HttpClient({ offline, renderedDir: RENDER_DIR });
  await http.load();
  try {
    const inventory = await discover({
      origin: SOURCE_ORIGIN,
      siteHosts: SITE_HOSTS,
      http,
      probeOnly,
      log,
      ...(maxPages ? { maxPages } : {}),
    });
    await writeJson(path.join(REPORTS_DIR, 'probe.json'), inventory.probe);
    if (!probeOnly) {
      await writeJson(INVENTORY_FILE, inventory);
      await writeFile(path.join(REPORTS_DIR, 'inventory.md'), inventoryMarkdown(inventory));
      log(
        `Inventory: ${inventory.pages.length} pages, ${inventory.media.length} images, ${inventory.anomalies.length} anomalies`,
      );
    }
    return inventory;
  } finally {
    await http.save();
  }
}

async function runFetch(inventory: Inventory): Promise<AssetManifest> {
  const http = new HttpClient({ offline, renderedDir: RENDER_DIR });
  await http.load();
  try {
    const manifest = await fetchAssets(inventory, http, {
      siteHosts: SITE_HOSTS,
      assetHosts: ASSET_HOSTS,
      log,
    });
    await writeAssetManifest(manifest);
    log(`Assets: ${manifest.assets.length} downloaded, ${manifest.missing.length} missing`);
    return manifest;
  } finally {
    await http.save();
  }
}

async function runSyncStage(inventory: Inventory, assets: AssetManifest): Promise<number> {
  const http = new HttpClient({ offline: true, renderedDir: RENDER_DIR });
  await http.load();
  const waivers = await readJson<Waiver[]>(WAIVERS_FILE, []);
  const result = await runSync({
    inventory,
    assets,
    http,
    siteHosts: SITE_HOSTS,
    origin: SITE_ORIGIN,
    source: SOURCE_ORIGIN,
    outDir: CONTENT_DIR,
    waivers,
    log,
  });
  await writeFile(path.join(REPORTS_DIR, 'coverage.md'), coverageMarkdown(result));
  await writeJson(path.join(REPORTS_DIR, 'sync.json'), {
    gaps: result.gaps,
    missingMedia: result.missingMedia,
    unresolvedLinks: result.unresolvedLinks,
    skipped: result.skipped,
  });
  if (check) {
    const different = await snapshotDiff(CONTENT_DIR, result.files);
    log(different.length ? `Snapshot differs: ${different.join(', ')}` : 'Snapshot is up to date');
    return different.length ? 1 : 0;
  }
  const changed = await writeSnapshot(CONTENT_DIR, result.files);
  log(
    `Wrote src/content (${result.docs.length} pages, ${result.media.length} media); ${changed.length} file(s) changed`,
  );
  if (result.gaps.length) {
    log(
      `Coverage: ${result.gaps.length} source sentence(s) missing from the output. See reports/coverage.md.`,
    );
    return 1;
  }
  log('Coverage: every visible sentence of the source is in the snapshot');
  return 0;
}

async function main(): Promise<number> {
  switch (stage) {
    case 'probe':
      await runDiscover(true);
      return 0;
    case 'discover':
      await runDiscover(false);
      return 0;
    case 'fetch':
      await runFetch(await readJson<Inventory>(INVENTORY_FILE));
      return 0;
    case 'sync':
      return runSyncStage(
        await readJson<Inventory>(INVENTORY_FILE),
        await readJson<AssetManifest>(ASSET_MANIFEST),
      );
    case 'all': {
      const inventory = await runDiscover(false);
      const assets = await runFetch(inventory);
      return runSyncStage(inventory, assets);
    }
    default:
      console.error(
        'Usage: node tools/content-sync/index.ts <probe|discover|fetch|sync|all> [--offline] [--check] [--max-pages=N]',
      );
      return stage === 'help' ? 0 : 1;
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof NetworkPolicyError) {
      console.error(`[content-sync] ${error.message}`);
      process.exit(2);
    }
    console.error(error);
    process.exit(1);
  },
);
