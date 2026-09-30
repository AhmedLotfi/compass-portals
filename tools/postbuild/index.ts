/**
 * Post-build step for the static site (runs after `ng build`):
 * - checks that every synced page was prerendered, with the canonical URL the sitemap lists and the
 *   right robots directive, and that nothing else was
 * - moves the prerendered 404 page to /404.html and removes the client-side fallback page, so unknown
 *   URLs get a real 404 on every host
 * - writes sitemap.xml, robots.txt, llms.txt and llms-full.txt
 * - writes hosting rules: _redirects, _headers, .htaccess and web.config in the web root, and
 *   deploy/nginx.conf next to it
 *
 *   node tools/postbuild/index.ts [--content=src/content] [--dist=dist/compass-portal]
 */
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PageDoc, Redirect, RouteIndex, Site } from '../../schema/content.ts';
import { CONTENT_DIR, ROOT } from '../content-sync/config.ts';
import {
  HASHED_BUNDLE,
  htaccess,
  netlifyHeaders,
  netlifyRedirects,
  nginxConf,
  webConfig,
} from './hosting.ts';
import {
  llmsFullTxt,
  llmsTxt,
  pageUrl,
  robotsTxt,
  sitemapXml,
  type SiteContent,
} from './site-files.ts';

export const MICROCOPY = path.join(ROOT, 'src/app/core/copy/microcopy.en.json');

export interface PostbuildOptions {
  contentDir?: string;
  distDir?: string;
  microcopy?: string;
  log?: (message: string) => void;
}

export interface PostbuildResult {
  routes: number;
  /** Files written, relative to the dist directory. */
  files: string[];
}

/** A build that must not ship: the message lists every problem found. */
export class PostbuildError extends Error {}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

export async function loadContent(
  contentDir: string,
  microcopy = MICROCOPY,
): Promise<SiteContent & { redirects: Redirect[] }> {
  const read = async <T>(file: string) =>
    JSON.parse(await readFile(path.join(contentDir, file), 'utf8')) as T;
  const site = await read<Site>('site.json');
  const { routes } = await read<RouteIndex>('index.json');
  const { redirects } = await read<{ redirects: Redirect[] }>('redirects.json');
  const pages = new Map<string, PageDoc>();
  for (const route of routes) pages.set(route.id, await read<PageDoc>(`pages/${route.id}.json`));
  const copy = JSON.parse(await readFile(microcopy, 'utf8')) as Record<string, string>;
  return { site, routes, pages, copy, redirects };
}

/** Angular lists prerendered routes without the trailing slash the pages are served with. */
const routeKey = (routePath: string) => (routePath === '/' ? '/' : routePath.replace(/\/$/, ''));

async function checkPages(
  content: SiteContent,
  distDir: string,
  browser: string,
): Promise<string[]> {
  const problems: string[] = [];
  const manifest = JSON.parse(
    await readFile(path.join(distDir, 'prerendered-routes.json'), 'utf8'),
  ) as { routes: Record<string, unknown> };
  const built = new Set(Object.keys(manifest.routes));
  const expected = new Set([...content.routes.map((route) => routeKey(route.path)), '/404']);
  for (const route of built) {
    if (!expected.has(route)) problems.push(`${route} was prerendered but is not a synced page`);
  }
  for (const route of content.routes) {
    if (!built.has(routeKey(route.path))) problems.push(`${route.path} was not prerendered`);
    const html = await readFile(path.join(browser, route.path, 'index.html'), 'utf8').catch(
      () => undefined,
    );
    if (html === undefined) {
      problems.push(`${route.path} has no index.html`);
      continue;
    }
    const noindex = Boolean(content.pages.get(route.id)?.seo.noindex);
    const robots = /<meta name="robots" content="([^"]*)"/.exec(html)?.[1] ?? '';
    if (robots.includes('noindex') !== noindex) {
      problems.push(`${route.path} has robots "${robots}"`);
    }
    const canonical = /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1];
    if (!noindex && canonical !== pageUrl(content.site, route.path)) {
      problems.push(`${route.path} has canonical ${canonical ?? '(none)'}`);
    }
  }
  return problems;
}

/** /404/index.html → /404.html, which Netlify, Cloudflare Pages, GitHub Pages etc. serve for misses. */
async function placeNotFound(browser: string): Promise<string[]> {
  const prerendered = path.join(browser, '404', 'index.html');
  const target = path.join(browser, '404.html');
  if (await exists(prerendered)) {
    await rename(prerendered, target);
    await rm(path.join(browser, '404'), { recursive: true, force: true });
  }
  if (!(await exists(target))) return ['the 404 page was not prerendered'];
  const html = await readFile(target, 'utf8');
  return /<meta name="robots" content="noindex/.test(html) ? [] : ['404.html is not noindex'];
}

export async function postbuild(options: PostbuildOptions = {}): Promise<PostbuildResult> {
  const contentDir = options.contentDir ?? CONTENT_DIR;
  const distDir = options.distDir ?? path.join(ROOT, 'dist/compass-portal');
  const log = options.log ?? ((message: string) => console.error(`[postbuild] ${message}`));
  const browser = path.join(distDir, 'browser');
  const content = await loadContent(contentDir, options.microcopy);

  const problems = [
    ...(await checkPages(content, distDir, browser)),
    ...(await placeNotFound(browser)),
  ];
  if (problems.length) throw new PostbuildError(problems.map((p) => `- ${p}`).join('\n'));

  // Without the fallback page, hosts can't turn unknown URLs into client-rendered 200s.
  await rm(path.join(browser, 'index.csr.html'), { force: true });

  const bundles = (await readdir(browser)).filter((file) => HASHED_BUNDLE.test(file)).sort();
  const hosting = { redirects: content.redirects, bundles };
  const files: [string, string][] = [
    ['browser/sitemap.xml', sitemapXml(content)],
    ['browser/robots.txt', robotsTxt(content.site)],
    ['browser/llms.txt', llmsTxt(content)],
    ['browser/llms-full.txt', llmsFullTxt(content)],
    ['browser/_redirects', netlifyRedirects(hosting)],
    ['browser/_headers', netlifyHeaders(hosting)],
    ['browser/.htaccess', htaccess(hosting)],
    ['browser/web.config', webConfig(hosting)],
    ['deploy/nginx.conf', nginxConf(hosting)],
  ];
  for (const [file, text] of files) {
    await mkdir(path.dirname(path.join(distDir, file)), { recursive: true });
    await writeFile(path.join(distDir, file), text);
  }
  log(
    `${content.routes.length} pages checked; wrote 404.html, ${files.map(([f]) => path.basename(f)).join(', ')}`,
  );
  return { routes: content.routes.length, files: ['browser/404.html', ...files.map(([f]) => f)] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const flag = (name: string) =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const content = flag('content');
  const dist = flag('dist');
  try {
    await postbuild({
      ...(content ? { contentDir: path.resolve(ROOT, content) } : {}),
      ...(dist ? { distDir: path.resolve(ROOT, dist) } : {}),
    });
  } catch (error) {
    if (!(error instanceof PostbuildError)) throw error;
    console.error(`[postbuild] The build must not ship:\n${error.message}`);
    process.exit(1);
  }
}
