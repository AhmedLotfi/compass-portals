/**
 * Route mapping: old WordPress URLs → new portal paths, page kinds, and the redirect map.
 * New paths drop the PATHINFO `/index.php` prefix and keep WordPress's trailing slash.
 */
import type { PageKind, Redirect } from '../../schema/content.ts';
import type { Inventory, InventoryPage } from './discover.ts';
import type { LinkResolver } from './normalize/sanitize.ts';
import {
  classifyPath,
  crawlKey,
  isSiteHost,
  resolveUrl,
  stripIndexPhp,
  unwrapJetpack,
} from './url.ts';

export interface RouteRule {
  pattern: RegExp;
  kind: PageKind;
}

/** Path → kind rules, first match wins. Tuned to the site's structure after the inventory. */
export const ROUTE_RULES: RouteRule[] = [
  { pattern: /^\/$/, kind: 'home' },
  { pattern: /^\/products\/$/, kind: 'product-index' },
  { pattern: /^\/products\/[^/]+\/$/, kind: 'product-category' },
  { pattern: /^\/products\/[^/]+\/[^/]+\/$/, kind: 'product' },
  { pattern: /^\/services\/$/, kind: 'service-index' },
  { pattern: /^\/services\/[^/]+\/$/, kind: 'service' },
  { pattern: /^\/contact(?:-us)?\/$/, kind: 'contact' },
];

export interface RouteDraft {
  id: string;
  path: string;
  kind: PageKind;
  page: InventoryPage;
  title: string;
  order: number;
  /** Every old URL (absolute) that served or redirected to this page. */
  oldUrls: string[];
  modified?: string;
  wpId?: number;
  wpParent?: number;
}

/** New path for an old URL: `/index.php/products/x` → `/products/x/`. */
export function newPath(url: string): string {
  const { pathname } = new URL(url);
  let path = stripIndexPhp(pathname).replace(/\/{2,}/g, '/');
  if (!path.endsWith('/') && !/\.[a-z0-9]{2,5}$/i.test(path)) path += '/';
  return path;
}

/** Stable route id from a path: `/` → `home`, `/products/erp/` → `products--erp`. */
export function routeId(path: string): string {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return 'home';
  return segments
    .map((s) =>
      decodeURIComponent(s)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .join('--');
}

export function kindFor(
  path: string,
  page: InventoryPage,
  rules: RouteRule[] = ROUTE_RULES,
): PageKind {
  const rule = rules.find((r) => r.pattern.test(path));
  if (rule) return rule.kind;
  if (page.rest?.type === 'post' || page.analysis?.wpKind === 'post') return 'post';
  return 'page';
}

const SKIPPED_KINDS = new Set(['404', 'search', 'attachment', 'archive', 'blog', 'home-blog']);

export function buildRoutes(
  inventory: Inventory,
  siteHosts: readonly string[],
  rules: RouteRule[] = ROUTE_RULES,
): { routes: RouteDraft[]; skipped: { url: string; reason: string }[] } {
  const routes: RouteDraft[] = [];
  const skipped: { url: string; reason: string }[] = [];
  const byPath = new Map<string, RouteDraft>();

  for (const page of inventory.pages) {
    const final = new URL(page.finalUrl);
    if (page.status !== 200 || !page.analysis) continue;
    if (!isSiteHost(final.hostname, siteHosts)) continue;
    const wpKind = page.analysis.wpKind ?? '';
    const isFront = stripIndexPhp(final.pathname) === '/';
    if (!isFront && SKIPPED_KINDS.has(wpKind)) {
      skipped.push({ url: page.finalUrl, reason: `WordPress ${wpKind} page` });
      continue;
    }
    const path = newPath(page.finalUrl);
    if (byPath.has(path)) {
      skipped.push({ url: page.finalUrl, reason: `duplicate of ${path}` });
      continue;
    }
    const title = page.rest?.title || page.analysis.h1[0] || page.analysis.title;
    const route: RouteDraft = {
      id: routeId(path),
      path,
      kind: kindFor(path, page, rules),
      page,
      title,
      order: page.rest?.menuOrder ?? 0,
      oldUrls: [...new Set([page.finalUrl, ...page.requested, ...page.aliases])],
      ...(page.rest?.modified ? { modified: page.rest.modified } : {}),
      ...(page.rest ? { wpId: page.rest.id, wpParent: page.rest.parent } : {}),
    };
    byPath.set(path, route);
    routes.push(route);
  }
  routes.sort((a, b) => a.path.localeCompare(b.path));
  return { routes, skipped };
}

/** Route id of the nearest existing ancestor path, e.g. `/products/erp/` → `products`. */
export function parentOf(route: RouteDraft, routes: RouteDraft[]): RouteDraft | undefined {
  if (route.wpParent) {
    const parent = routes.find((r) => r.wpId === route.wpParent);
    if (parent) return parent;
  }
  const segments = route.path.split('/').filter(Boolean);
  for (let n = segments.length - 1; n >= 1; n--) {
    const candidate = `/${segments.slice(0, n).join('/')}/`;
    const parent = routes.find((r) => r.path === candidate);
    if (parent) return parent;
  }
  return route.path === '/' ? undefined : routes.find((r) => r.path === '/');
}

export interface LinkMap {
  /** Resolver for links on a page at `base`. */
  resolverFor(base: string): LinkResolver;
  /** Internal links that point at no known page. */
  unresolved: Map<string, Set<string>>;
}

/**
 * Rewrites site links to new paths. `mediaHref` maps an uploaded image to its new URL; documents
 * move to `/files/`.
 */
export function createLinkMap(
  routes: RouteDraft[],
  siteHosts: readonly string[],
  mediaHref: (url: string) => string | undefined,
): LinkMap {
  const canonicalHost = siteHosts[0]!.replace(/^www\./, '');
  const byKey = new Map<string, string>();
  for (const route of routes) {
    for (const url of route.oldUrls) byKey.set(crawlKey(new URL(url), canonicalHost), route.path);
    if (route.page.rest?.link)
      byKey.set(crawlKey(new URL(route.page.rest.link), canonicalHost), route.path);
  }
  const unresolved = new Map<string, Set<string>>();

  return {
    unresolved,
    resolverFor(base: string): LinkResolver {
      return (href: string) => {
        const trimmed = href.trim();
        if (/^mailto:/i.test(trimmed)) return { href: trimmed, kind: 'email' };
        if (/^tel:/i.test(trimmed)) return { href: trimmed.replace(/\s+/g, ''), kind: 'phone' };
        if (trimmed.startsWith('#')) return { href: trimmed, kind: 'internal' };
        const url = resolveUrl(unwrapJetpack(trimmed), base);
        if (!url) return { href: trimmed, kind: 'external' };
        if (!isSiteHost(url.hostname, siteHosts)) return { href: url.href, kind: 'external' };
        const kind = classifyPath(url);
        if (kind === 'document') {
          const name = decodeURIComponent(url.pathname.split('/').pop() ?? 'file');
          return { href: `/files/${encodeURIComponent(name)}`, kind: 'document' };
        }
        if (kind === 'media') {
          return { href: mediaHref(url.href) ?? url.href, kind: 'document' };
        }
        const path = byKey.get(crawlKey(url, canonicalHost));
        const hash = url.hash;
        if (path) return { href: path + hash, kind: 'internal' };
        const guess = newPath(url.href);
        if (!unresolved.has(guess)) unresolved.set(guess, new Set());
        unresolved.get(guess)!.add(base);
        return { href: guess + hash, kind: 'internal' };
      };
    },
  };
}

/** Old URL → new path (301), plus retired WordPress system paths (410). No chains; targets exist. */
export function buildRedirects(routes: RouteDraft[]): Redirect[] {
  const redirects = new Map<string, Redirect>();
  const paths = new Set(routes.map((r) => r.path));
  const add = (from: string, to: string, reason: string, status: 301 | 410 = 301) => {
    if (from === to || redirects.has(from)) return;
    if (status === 301 && !paths.has(to.split('#')[0]!)) return;
    redirects.set(from, { from, to, status, reason });
  };

  for (const route of routes) {
    for (const old of route.oldUrls) {
      const url = new URL(old);
      const from = decodeURIComponent(url.pathname) + url.search;
      add(from, route.path, from.startsWith('/index.php') ? 'PATHINFO permalink' : 'old URL');
      if (!url.pathname.endsWith('/') && !url.search) add(`${from}/`, route.path, 'old URL');
    }
    if (route.wpId !== undefined) {
      const param = route.page.rest?.type === 'page' ? 'page_id' : 'p';
      add(`/?${param}=${route.wpId}`, route.path, 'WordPress short link');
    }
  }
  const home = routes.find((r) => r.path === '/');
  if (home) add('/index.php', '/', 'PATHINFO front page');
  for (const system of [
    '/wp-admin/',
    '/wp-login.php',
    '/xmlrpc.php',
    '/wp-json/',
    '/feed/',
    '/comments/feed/',
  ]) {
    add(system, '', 'retired WordPress endpoint', 410);
  }
  return [...redirects.values()].sort((a, b) => a.from.localeCompare(b.from));
}
