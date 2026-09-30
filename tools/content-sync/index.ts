/**
 * Content sync CLI.
 *
 *   node tools/content-sync/index.ts probe      Fingerprint the site (platform, REST API, permalinks)
 *   node tools/content-sync/index.ts discover   Full inventory: every page, menu, image, document, contact detail
 *
 * Options: --offline (rebuild from source-archive/ only), --max-pages=N
 */
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REPORTS_DIR, SITE_HOSTS, SOURCE_ORIGIN } from './config.ts';
import { discover } from './discover.ts';
import { HttpClient, NetworkPolicyError } from './http.ts';
import { inventoryMarkdown } from './report.ts';

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
const maxPagesFlag = flags.find((f) => f.startsWith('--max-pages='));
const maxPages = maxPagesFlag ? Number(maxPagesFlag.split('=')[1]) : undefined;
const log = (message: string) => console.error(`[content-sync] ${message}`);

async function main(): Promise<void> {
  switch (stage) {
    case 'probe':
    case 'discover': {
      const http = new HttpClient({ offline });
      await http.load();
      try {
        const inventory = await discover({
          origin: SOURCE_ORIGIN,
          siteHosts: SITE_HOSTS,
          http,
          probeOnly: stage === 'probe',
          log,
          ...(maxPages ? { maxPages } : {}),
        });
        await mkdir(REPORTS_DIR, { recursive: true });
        if (stage === 'probe') {
          await writeJson(path.join(REPORTS_DIR, 'probe.json'), inventory.probe);
          log(`Wrote reports/probe.json`);
        } else {
          await writeJson(path.join(REPORTS_DIR, 'probe.json'), inventory.probe);
          await writeJson(path.join(REPORTS_DIR, 'inventory.json'), inventory);
          await writeFile(path.join(REPORTS_DIR, 'inventory.md'), inventoryMarkdown(inventory));
          log(
            `Wrote reports/inventory.{json,md}: ${inventory.pages.length} pages, ` +
              `${inventory.media.length} images, ${inventory.anomalies.length} anomalies`,
          );
        }
      } finally {
        await http.save();
      }
      return;
    }
    default:
      console.error(
        'Usage: node tools/content-sync/index.ts <probe|discover> [--offline] [--max-pages=N]',
      );
      process.exitCode = stage === 'help' ? 0 : 1;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
}

main().catch((error: unknown) => {
  if (error instanceof NetworkPolicyError) {
    console.error(`[content-sync] ${error.message}`);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
