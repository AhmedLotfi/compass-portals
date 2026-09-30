/// <reference lib="dom" />
/**
 * compassint.org is a client-rendered Angular app: its HTML is an empty <app-root>, and every word and
 * image arrives through JavaScript. This stage opens the site in headless Chromium, one page at a
 * time, and archives what a visitor's browser ends up with:
 * - the rendered HTML of every page reachable by links (source-archive/rendered/)
 * - every response the app loads, API data and images included, in the HTTP archive
 *   (source-archive/http/, same manifest as the other stages, so they can use it offline)
 * - a screenshot of each page, for side-by-side review (source-archive/rendered/screens/)
 * - reports/rendered.md: pages, API calls and third-party hosts
 *
 *   node tools/content-sync/render.ts [--max-pages=300]
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Page, type Response } from '@playwright/test';
import { HTTP_ARCHIVE_DIR, RENDER_DIR, REPORTS_DIR, SITE_HOSTS, SOURCE_ORIGIN } from './config.ts';
import { archiveFileName, type ArchiveEntry } from './http.ts';

export interface RenderOptions {
  origin?: string;
  hosts?: string[];
  /** The archive root (default source-archive/); pages go to rendered/, responses to http/. */
  archiveDir?: string;
  reportsDir?: string;
  maxPages?: number;
}
const PAGE_GAP_MS = 500;
const KEPT_HEADERS = [
  'content-type',
  'content-language',
  'etag',
  'last-modified',
  'location',
  'server',
];
const FILE_LINK = /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|jpe?g|png|gif|webp|svg|mp4|webm)$/i;

export interface RenderedPage {
  /** The URL that was opened. */
  url: string;
  /** Where the app ended up (client-side redirects included). */
  finalUrl: string;
  /** Status of the HTML document (a client-rendered app answers 200 for every path). */
  status: number | null;
  title: string;
  h1: string[];
  /** Rendered HTML, relative to source-archive/rendered/. */
  file: string;
  screenshot: string | null;
  /** Same-site pages and files it links to, and external links. */
  links: string[];
  files: string[];
  external: string[];
  renderedAt: string;
}

export interface RenderManifest {
  origin: string;
  generatedAt: string;
  userAgent: string;
  pages: RenderedPage[];
  /** Requests that aren't archived bodies (non-GET, failed, third-party scripts), for review. */
  requests: { method: string; url: string; status: number | null; type: string }[];
}

/** One key per page: no fragment (unless it is a hash route), no trailing slash, one host form. */
export function pageKey(href: string, origin: string, hosts: string[]): string | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (!/^https?:$/.test(url.protocol) || !hosts.includes(url.hostname.toLowerCase()))
    return undefined;
  const hashRoute = url.hash.startsWith('#/') ? url.hash : '';
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  return `${new URL(origin).origin}${pathname}${url.search}${hashRoute}`;
}

function slugFor(url: string): string {
  const parsed = new URL(url);
  const base =
    (parsed.pathname + parsed.search + parsed.hash)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'home';
  return `${base}--${createHash('sha1').update(url).digest('hex').slice(0, 8)}`;
}

async function readManifest(httpDir: string): Promise<Map<string, ArchiveEntry>> {
  try {
    const entries = JSON.parse(
      await readFile(path.join(httpDir, 'manifest.json'), 'utf8'),
    ) as ArchiveEntry[];
    return new Map(entries.map((entry) => [entry.url, entry]));
  } catch {
    return new Map();
  }
}

/** Loads everything the page will load: waits for the app, scrolls through it, waits again. */
async function settle(page: Page): Promise<void> {
  await page
    .waitForFunction(() => (document.querySelector('app-root')?.children.length ?? 1) > 0, null, {
      timeout: 15_000,
    })
    .catch(() => undefined);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.evaluate(async () => {
    const step = Math.max(300, Math.round(innerHeight * 0.75));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(400);
}

export async function renderSite(options: RenderOptions = {}): Promise<RenderManifest> {
  const origin = options.origin ?? SOURCE_ORIGIN;
  const hosts = (options.hosts ?? SITE_HOSTS).map((host) => host.toLowerCase());
  const httpDir = options.archiveDir ? path.join(options.archiveDir, 'http') : HTTP_ARCHIVE_DIR;
  const renderDir = options.archiveDir ? path.join(options.archiveDir, 'rendered') : RENDER_DIR;
  const reportsDir = options.reportsDir ?? REPORTS_DIR;
  const maxPages = options.maxPages ?? 300;
  const isSiteHost = (url: URL) => hosts.includes(url.hostname.toLowerCase());
  const keyOf = (href: string) => pageKey(href, origin, hosts);
  const archive = await readManifest(httpDir);
  const requests: RenderManifest['requests'] = [];
  const pending: Promise<void>[] = [];
  await mkdir(path.join(renderDir, 'screens'), { recursive: true });

  const browser = await chromium.launch();
  const probe = await browser.newPage();
  const defaultAgent = await probe.evaluate(() => navigator.userAgent);
  await probe.close();
  const userAgent = `${defaultAgent.replace('HeadlessChrome', 'Chrome')} CompassPortalSync/1.0 (+https://github.com/AhmedLotfi/compass-portals)`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent });

  const capture = async (response: Response) => {
    const request = response.request();
    const url = response.url();
    if (!/^https?:/.test(url)) return;
    const parsed = new URL(url);
    const type = request.resourceType();
    const status = response.status();
    const contentType = response.headers()['content-type'] ?? '';
    const content = /^(?:image|font)\//.test(contentType) || /json|css|xml|svg/.test(contentType);
    if (request.method() !== 'GET' || (!isSiteHost(parsed) && !content)) {
      requests.push({ method: request.method(), url, status, type });
      return;
    }
    const headers = Object.fromEntries(
      Object.entries(response.headers()).filter(([name]) => KEPT_HEADERS.includes(name)),
    );
    let body: Buffer = Buffer.alloc(0);
    if (status < 300 || status >= 400) {
      try {
        body = await response.body();
      } catch {
        requests.push({ method: 'GET', url, status, type: `${type} (no body)` });
        return;
      }
    }
    const file = body.length ? archiveFileName(url, contentType) : null;
    if (file) {
      await mkdir(path.dirname(path.join(httpDir, file)), { recursive: true });
      await writeFile(path.join(httpDir, file), body);
    }
    archive.set(url, {
      url,
      status,
      headers,
      file,
      sha256: body.length ? createHash('sha256').update(body).digest('hex') : null,
      bytes: body.length,
      fetchedAt: new Date().toISOString(),
    });
  };
  context.on('response', (response) => void pending.push(capture(response)));
  context.on('requestfailed', (request) =>
    requests.push({ method: request.method(), url: request.url(), status: null, type: 'failed' }),
  );

  const start = keyOf(new URL('/', origin).href)!;
  const queue = [start];
  const seen = new Set(queue);
  const pages: RenderedPage[] = [];
  const page = await context.newPage();
  try {
    while (queue.length && pages.length < maxPages) {
      const url = queue.shift()!;
      console.error(`[render] ${url}`);
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await settle(page);
      const html = await page.content();
      const slug = slugFor(url);
      const file = `${new URL(url).host}/${slug}.html`;
      await mkdir(path.join(renderDir, new URL(url).host), { recursive: true });
      await writeFile(path.join(renderDir, file), html);
      const screenshot = `screens/${slug}.jpg`;
      const shot = await page
        .screenshot({
          path: path.join(renderDir, screenshot),
          fullPage: true,
          type: 'jpeg',
          quality: 55,
        })
        .then(
          () => screenshot,
          () => null,
        );
      const found = await page.$$eval('a[href], [routerlink]', (elements) =>
        elements.map((el) =>
          el instanceof HTMLAnchorElement
            ? el.href
            : new URL(el.getAttribute('routerlink') ?? '', location.href).href,
        ),
      );
      const links = new Set<string>();
      const files = new Set<string>();
      const external = new Set<string>();
      for (const href of found) {
        const key = keyOf(href);
        if (!key) {
          if (/^https?:/.test(href)) external.add(href);
          continue;
        }
        if (FILE_LINK.test(new URL(key).pathname)) {
          files.add(key);
          continue;
        }
        links.add(key);
        if (!seen.has(key)) {
          seen.add(key);
          queue.push(key);
        }
      }
      pages.push({
        url,
        finalUrl: page.url(),
        status: response?.status() ?? null,
        title: await page.title(),
        h1: await page.$$eval('h1', (els) => els.map((el) => el.textContent?.trim() ?? '')),
        file,
        screenshot: shot,
        links: [...links].sort(),
        files: [...files].sort(),
        external: [...external].sort(),
        renderedAt: new Date().toISOString(),
      });
      await page.waitForTimeout(PAGE_GAP_MS);
    }
    // Linked documents the app never loaded itself (PDFs and the like).
    const linkedFiles = [...new Set(pages.flatMap((p) => p.files))].filter(
      (url) => !archive.has(url),
    );
    for (const url of linkedFiles) {
      const response = await context.request.get(url).catch(() => undefined);
      if (!response) continue;
      const body = await response.body();
      const contentType = response.headers()['content-type'] ?? '';
      const file = body.length ? archiveFileName(url, contentType) : null;
      if (file) {
        await mkdir(path.dirname(path.join(httpDir, file)), { recursive: true });
        await writeFile(path.join(httpDir, file), body);
      }
      archive.set(url, {
        url,
        status: response.status(),
        headers: { 'content-type': contentType },
        file,
        sha256: body.length ? createHash('sha256').update(body).digest('hex') : null,
        bytes: body.length,
        fetchedAt: new Date().toISOString(),
      });
    }
  } finally {
    await Promise.allSettled(pending);
    await browser.close();
  }

  const entries = [...archive.values()].sort((a, b) => a.url.localeCompare(b.url));
  await writeFile(path.join(httpDir, 'manifest.json'), JSON.stringify(entries, null, 2) + '\n');
  const manifest: RenderManifest = {
    origin,
    generatedAt: new Date().toISOString(),
    userAgent,
    pages: pages.sort((a, b) => a.url.localeCompare(b.url)),
    requests: [...new Map(requests.map((r) => [`${r.method} ${r.url}`, r])).values()].sort((a, b) =>
      a.url.localeCompare(b.url),
    ),
  };
  await writeFile(path.join(renderDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await mkdir(reportsDir, { recursive: true });
  await writeFile(path.join(reportsDir, 'rendered.md'), renderedMarkdown(manifest, entries));
  return manifest;
}

export function renderedMarkdown(manifest: RenderManifest, entries: ArchiveEntry[]): string {
  const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  const pathOf = (url: string) => {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname + parsed.search + parsed.hash);
  };
  const byType = new Map<string, number>();
  for (const entry of entries) {
    const type = (entry.headers['content-type'] ?? 'none').split(';')[0]!;
    byType.set(type, (byType.get(type) ?? 0) + 1);
  }
  const hosts = new Map<string, number>();
  for (const url of [...entries.map((e) => e.url), ...manifest.requests.map((r) => r.url)]) {
    const host = new URL(url).host;
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
  }
  const json = entries.filter((e) => /json/.test(e.headers['content-type'] ?? ''));
  return [
    `# Rendered crawl: ${manifest.origin}`,
    '',
    `Generated ${manifest.generatedAt} with headless Chromium (\`${manifest.userAgent}\`).`,
    '',
    '## Summary',
    '',
    `- Pages rendered: **${manifest.pages.length}**`,
    `- Responses archived: **${entries.length}** (${[...byType.entries()].map(([t, n]) => `${t}: ${n}`).join(', ')})`,
    `- JSON responses (API data): **${json.length}**`,
    `- Hosts: ${[...hosts.entries()].map(([h, n]) => `${h} (${n})`).join(', ')}`,
    '',
    '## Pages',
    '',
    '| Path | Status | Title | H1 | Links | Files | Screenshot |',
    '|---|---|---|---|---|---|---|',
    ...manifest.pages.map(
      (p) =>
        `| ${cell(pathOf(p.url))}${p.finalUrl !== p.url ? ` → ${cell(pathOf(p.finalUrl))}` : ''} | ${p.status ?? ''} | ${cell(p.title)} | ${cell(p.h1.join(' / '))} | ${p.links.length} | ${p.files.length} | ${p.screenshot ?? ''} |`,
    ),
    '',
    '## API data',
    '',
    ...(json.length ? json.map((e) => `- ${e.status} ${e.url} (${e.bytes} bytes)`) : ['- none']),
    '',
    '## Other requests (not archived)',
    '',
    ...(manifest.requests.length
      ? manifest.requests.map((r) => `- ${r.method} ${r.url} → ${r.status ?? 'failed'} (${r.type})`)
      : ['- none']),
    '',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const max = process.argv.find((a) => a.startsWith('--max-pages='))?.split('=')[1];
  const manifest = await renderSite(max ? { maxPages: Number(max) } : {});
  console.error(`[render] ${manifest.pages.length} pages rendered; see reports/rendered.md`);
}
