/**
 * Captures full-page screenshots of routes at mobile, tablet and desktop widths into reports/screens/.
 *
 *   node tools/screens.ts [baseUrl] [route ...] [--reduced-motion] [--wait=ms]
 *   node tools/screens.ts http://localhost:4200 /design-lab
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { ROOT } from './content-sync/config.ts';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));
const baseUrl = positional[0] ?? 'http://localhost:4200';
const routes = positional.length > 1 ? positional.slice(1) : ['/'];
const reducedMotion = flags.includes('--reduced-motion');
const wait = Number(flags.find((f) => f.startsWith('--wait='))?.split('=')[1] ?? 3000);

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
];

const outDir = path.join(ROOT, 'reports/screens');
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning')
        problems.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    for (const route of routes) {
      await page.goto(new URL(route, baseUrl).href, { waitUntil: 'networkidle' });
      await page.waitForTimeout(wait);
      const slug = route.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'home';
      const file = path.join(
        outDir,
        `${slug}-${viewport.name}${reducedMotion ? '-reduced' : ''}.png`,
      );
      await page.screenshot({ path: file, fullPage: true });
      console.error(`[screens] ${path.relative(ROOT, file)}`);
    }
    if (problems.length)
      console.error(`[screens] ${viewport.name} console:\n  ${problems.join('\n  ')}`);
    await context.close();
  }
} finally {
  await browser.close();
}
