import { analyzePage, type NavMenu, type PageAnalysis } from './analyze.ts';
import { MAX_CRAWL_PAGES, USER_AGENT } from './config.ts';
import { bodyText, isHtml, type HttpClient, type RedirectHop } from './http.ts';
import { parseRobots, type RobotsRules } from './robots.ts';
import { parseSitemap } from './sitemap.ts';
import { classifyPath, crawlKey, isSiteHost, resolveUrl, stripIndexPhp } from './url.ts';
import {
  fetchCollection,
  fetchTypes,
  findRestRoot,
  type RestRoot,
  type RestType,
} from './wp-rest.ts';

export interface DiscoverOptions {
  origin: string;
  siteHosts: string[];
  http: HttpClient;
  maxPages?: number;
  /** Probe only: fingerprint the platform without crawling or fetching collections. */
  probeOnly?: boolean;
  log?: (message: string) => void;
}

export interface Probe {
  origin: string;
  home: {
    url: string;
    finalUrl: string;
    status: number;
    redirects: RedirectHop[];
    headers: Record<string, string>;
  };
  wwwHome?: { finalUrl: string; status: number };
  httpHome?: { finalUrl: string; status: number };
  cloudflare: boolean;
  robots: { status: number; sitemaps: string[]; disallowsRest: boolean };
  rest: (Omit<RestRoot, 'base'> & { base: string }) | null;
  platform: {
    generator: string[];
    theme?: string;
    plugins: string[];
    builders: string[];
    translationWidgets: string[];
    lang?: string;
    dir?: string;
    hreflang: { lang: string; href: string }[];
    cfEmail: boolean;
  };
  permalinks: { sample: string; clean?: VariantCheck; indexPhp?: VariantCheck } | null;
}

export interface VariantCheck {
  url: string;
  status: number;
  finalUrl: string;
}

export interface RestItemSummary {
  type: string;
  id: number;
  slug: string;
  link: string;
  parent: number;
  status?: string;
  template?: string;
  modified?: string;
  title: string;
  menuOrder?: number;
}

export interface RestMediaSummary {
  id: number;
  url: string;
  /** Every resized variant WordPress generated (thumbnail, medium, large, …). */
  sizes: string[];
  alt: string;
  caption: string;
  mime: string;
  width?: number;
  height?: number;
  parent: number;
}

export type Source = 'home' | 'sitemap' | 'rest' | 'crawl';

export interface InventoryPage {
  key: string;
  /** URLs that redirected here. */
  requested: string[];
  /** Other URLs that serve the same WordPress object without redirecting (duplicate content). */
  aliases: string[];
  finalUrl: string;
  status: number;
  redirects: RedirectHop[];
  sources: Source[];
  contentType: string;
  analysis?: PageAnalysis;
  rest?: RestItemSummary;
}

export interface Anomaly {
  kind:
    | 'demo-text'
    | 'broken-link'
    | 'error-page'
    | 'missing-alt'
    | 'foreign-image-host'
    | 'foreign-email'
    | 'contact-conflict'
    | 'translation-widget'
    | 'unrendered-shortcodes'
    | 'rest-without-page';
  detail: string;
  pages: string[];
}

export interface Inventory {
  generatedAt: string;
  origin: string;
  probe: Probe;
  sitemaps: { url: string; status: number; kind: string; urls: number }[];
  rest: {
    types: RestType[];
    counts: Record<string, number>;
    items: RestItemSummary[];
    media: RestMediaSummary[];
  } | null;
  pages: InventoryPage[];
  menus: { header: NavMenu[]; footer: NavMenu[] };
  media: { url: string; host: string; alts: (string | null)[]; pages: string[]; kinds: string[] }[];
  documents: { url: string; pages: string[] }[];
  pageStylesheets: string[];
  contacts: { emails: Record<string, string[]>; phones: Record<string, string[]> };
  anomalies: Anomaly[];
}

/** Types WordPress exposes over REST that are not public content. */
const INTERNAL_TYPES = new Set([
  'attachment',
  'nav_menu_item',
  'wp_block',
  'wp_template',
  'wp_template_part',
  'wp_navigation',
  'wp_global_styles',
  'wp_font_family',
  'wp_font_face',
  'elementor_library',
]);

interface RestItemJson {
  id: number;
  slug?: string;
  link?: string;
  parent?: number;
  status?: string;
  template?: string;
  modified?: string;
  menu_order?: number;
  title?: { rendered?: string };
}

interface RestMediaJson {
  id: number;
  source_url?: string;
  alt_text?: string;
  caption?: { rendered?: string };
  mime_type?: string;
  post?: number | null;
  media_details?: {
    width?: number;
    height?: number;
    sizes?: Record<string, { source_url?: string }>;
  };
}

export async function discover(options: DiscoverOptions): Promise<Inventory> {
  const { origin, siteHosts, http } = options;
  const log = options.log ?? (() => undefined);
  const canonicalHost = new URL(origin).hostname.replace(/^www\./, '');
  const maxPages = options.maxPages ?? MAX_CRAWL_PAGES;

  // 1. Home page and platform fingerprint.
  log(`Fetching ${origin}/`);
  const home = await http.get(`${origin}/`, 'text/html');
  const homeHtml = isHtml(home) ? bodyText(home) : '';
  const homeAnalysis = homeHtml ? analyzePage(homeHtml, home.finalUrl, siteHosts) : undefined;

  const robotsResponse = await http.get(`${origin}/robots.txt`, 'text/plain');
  const robots: RobotsRules = parseRobots(
    robotsResponse.status === 200 ? bodyText(robotsResponse) : '',
    USER_AGENT,
  );

  log('Looking for the WordPress REST API');
  const disallowsRest = !robots.isAllowed('/wp-json/');
  const restRoot = disallowsRest
    ? undefined
    : await findRestRoot(http, origin, home.headers['link'] ?? homeAnalysis?.restLink);

  const probe: Probe = {
    origin,
    home: {
      url: home.url,
      finalUrl: home.finalUrl,
      status: home.status,
      redirects: home.redirects,
      headers: home.headers,
    },
    cloudflare: Boolean(home.headers['cf-ray']) || /cloudflare/i.test(home.headers['server'] ?? ''),
    robots: { status: robotsResponse.status, sitemaps: robots.sitemaps, disallowsRest },
    rest: restRoot ?? null,
    platform: {
      generator: homeAnalysis?.generator ?? [],
      ...(homeAnalysis?.theme ? { theme: homeAnalysis.theme } : {}),
      plugins: homeAnalysis?.plugins ?? [],
      builders: homeAnalysis?.builders ?? [],
      translationWidgets: homeAnalysis?.translationWidgets ?? [],
      ...(homeAnalysis?.lang ? { lang: homeAnalysis.lang } : {}),
      ...(homeAnalysis?.dir ? { dir: homeAnalysis.dir } : {}),
      hreflang: homeAnalysis?.hreflang ?? [],
      cfEmail: (homeAnalysis?.cfEmailCount ?? 0) > 0,
    },
    permalinks: null,
  };

  if (!/^[\d.]+$|^localhost$/.test(canonicalHost)) {
    const www = await safeGet(http, `https://www.${canonicalHost}/`);
    if (www) probe.wwwHome = www;
    const plainHttp = await safeGet(http, `http://${canonicalHost}/`);
    if (plainHttp) probe.httpHome = plainHttp;
  }

  // 2. REST collections (pages, posts, public custom types, media).
  let rest: Inventory['rest'] = null;
  if (restRoot && !options.probeOnly) {
    log(`REST API at ${restRoot.base}; fetching collections`);
    const types = await fetchTypes(http, restRoot);
    const contentTypes = types.filter(
      (t) => !INTERNAL_TYPES.has(t.slug) && t.restNamespace === 'wp/v2',
    );
    const items: RestItemSummary[] = [];
    const counts: Record<string, number> = {};
    for (const type of contentTypes) {
      const {
        items: raw,
        total,
        status,
      } = await fetchCollection<RestItemJson>(http, restRoot, `/wp/v2/${type.restBase}`);
      counts[type.slug] = status === 200 ? total || raw.length : -status;
      for (const item of raw) items.push(summarizeItem(type.slug, item));
    }
    const mediaResult = await fetchCollection<RestMediaJson>(http, restRoot, '/wp/v2/media');
    counts['attachment'] = mediaResult.status === 200 ? mediaResult.total : -mediaResult.status;
    rest = {
      types,
      counts,
      items,
      media: mediaResult.items.map(summarizeMedia).filter((m) => m.url),
    };
  }

  // 3. Permalink structure: does the old site answer on both `/index.php/x/` and `/x/`?
  // The front page proves nothing about permalinks, so sample an inner page.
  const isInner = (url: string) => stripIndexPhp(new URL(url).pathname) !== '/';
  const sample =
    rest?.items.find((i) => i.type === 'page' && i.link && isInner(i.link))?.link ??
    homeAnalysis?.links.find((l) => l.internal && l.kind === 'page' && isInner(l.href))?.href;
  if (sample) {
    const samplePath = new URL(sample).pathname;
    const cleanPath = stripIndexPhp(samplePath);
    const clean = await safeGet(http, `${origin}${cleanPath}`);
    const indexPhp = await safeGet(
      http,
      `${origin}/index.php${cleanPath === '/' ? '/' : cleanPath}`,
    );
    probe.permalinks = {
      sample,
      ...(clean ? { clean: { url: `${origin}${cleanPath}`, ...clean } } : {}),
      ...(indexPhp ? { indexPhp: { url: `${origin}/index.php${cleanPath}`, ...indexPhp } } : {}),
    };
  }

  if (options.probeOnly) {
    return emptyInventory(origin, probe);
  }

  // 4. Sitemaps.
  const sitemapReports: Inventory['sitemaps'] = [];
  const sitemapQueue = [
    ...robots.sitemaps,
    `${origin}/wp-sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap.xml`,
  ];
  const sitemapSeen = new Set<string>();
  const sitemapUrls = new Set<string>();
  while (sitemapQueue.length > 0 && sitemapSeen.size < 200) {
    const url = sitemapQueue.shift()!;
    if (sitemapSeen.has(url)) continue;
    sitemapSeen.add(url);
    const response = await safeFetch(http, url, 'application/xml');
    if (!response) continue;
    const parsed = response.status === 200 ? parseSitemap(bodyText(response)) : undefined;
    sitemapReports.push({
      url,
      status: response.status,
      kind: parsed?.kind ?? 'missing',
      urls: parsed ? parsed.urls.length + parsed.sitemaps.length : 0,
    });
    if (!parsed) continue;
    sitemapQueue.push(...parsed.sitemaps);
    for (const entry of parsed.urls) sitemapUrls.add(entry.loc);
  }

  // 5. Crawl every same-site page reachable from the home page, sitemaps and REST links.
  const pages = new Map<string, InventoryPage>();
  const queued = new Set<string>();
  const queue: { url: string; source: Source }[] = [];
  const brokenLinks: { from: string; to: string; status: number }[] = [];
  const linkSources = new Map<string, Set<string>>();

  const enqueue = (url: string, source: Source, from?: string) => {
    const resolved = resolveUrl(url, origin);
    if (!resolved || !isSiteHost(resolved.hostname, siteHosts)) return;
    if (classifyPath(resolved) !== 'page') return;
    if (!robots.isAllowed(resolved.pathname + resolved.search)) return;
    const key = crawlKey(resolved, canonicalHost);
    if (from) {
      if (!linkSources.has(key)) linkSources.set(key, new Set());
      linkSources.get(key)!.add(from);
    }
    const existing = [...pages.values()].find(
      (p) => p.key === key || p.requested.includes(key) || p.aliases.includes(key),
    );
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      return;
    }
    if (queued.has(key)) return;
    queued.add(key);
    queue.push({ url: resolved.href, source });
  };

  enqueue(home.url, 'home');
  for (const url of sitemapUrls) enqueue(url, 'sitemap');
  for (const item of rest?.items ?? []) if (item.link) enqueue(item.link, 'rest');

  while (queue.length > 0 && pages.size < maxPages) {
    const batch = queue.splice(0, 6);
    const results = await Promise.all(
      batch.map(async ({ url, source }) => ({
        url,
        source,
        response: await safeFetch(http, url, 'text/html'),
      })),
    );
    for (const { url, source, response } of results) {
      if (!response) continue;
      const requestedKey = crawlKey(new URL(url), canonicalHost);
      const finalUrl = new URL(response.finalUrl);
      const finalKey = crawlKey(finalUrl, canonicalHost);
      const known = pages.get(finalKey);
      if (known) {
        if (!known.requested.includes(requestedKey)) known.requested.push(requestedKey);
        if (!known.sources.includes(source)) known.sources.push(source);
        continue;
      }
      const page: InventoryPage = {
        key: finalKey,
        requested: requestedKey === finalKey ? [] : [requestedKey],
        aliases: [],
        finalUrl: response.finalUrl,
        status: response.status,
        redirects: response.redirects,
        sources: [source],
        contentType: response.headers['content-type'] ?? '',
      };
      pages.set(finalKey, page);
      if (response.status >= 400) {
        for (const from of linkSources.get(requestedKey) ?? []) {
          brokenLinks.push({ from, to: url, status: response.status });
        }
        continue;
      }
      if (
        response.status !== 200 ||
        !isHtml(response) ||
        !isSiteHost(finalUrl.hostname, siteHosts)
      ) {
        continue;
      }
      page.analysis = analyzePage(bodyText(response), response.finalUrl, siteHosts);
      for (const link of page.analysis.links) {
        if (link.internal && link.kind === 'page') enqueue(link.href, 'crawl', page.finalUrl);
      }
      mergeDuplicate(pages, page);
    }
    log(`Crawled ${pages.size} pages (${queue.length} queued)`);
  }

  // 6. Attach REST items to the pages they render.
  const pageList = [...pages.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const item of rest?.items ?? []) {
    const itemKey = item.link ? crawlKey(new URL(item.link), canonicalHost) : undefined;
    const page =
      pageList.find(
        (p) => p.analysis?.wpId === item.id && (p.analysis.wpKind ?? '') !== 'archive',
      ) ?? pageList.find((p) => itemKey && (p.key === itemKey || p.requested.includes(itemKey)));
    if (page && !page.rest) page.rest = item;
  }

  return buildInventory(origin, probe, sitemapReports, rest, pageList, brokenLinks, siteHosts);
}

function buildInventory(
  origin: string,
  probe: Probe,
  sitemaps: Inventory['sitemaps'],
  rest: Inventory['rest'],
  pages: InventoryPage[],
  brokenLinks: { from: string; to: string; status: number }[],
  siteHosts: readonly string[],
): Inventory {
  const analyzed = pages.filter((p) => p.analysis);
  const media = new Map<string, Inventory['media'][number]>();
  const documents = new Map<string, Set<string>>();
  const emails: Record<string, string[]> = {};
  const phones: Record<string, string[]> = {};
  const header: NavMenu[] = [];
  const footer: NavMenu[] = [];
  const menuSeen = new Set<string>();
  const stylesheets = new Set<string>();
  const anomalies: Anomaly[] = [];

  const addMedia = (url: string, page: string, alt: string | null, kind: string) => {
    const entry = media.get(url) ?? {
      url,
      host: new URL(url).host,
      alts: [],
      pages: [],
      kinds: [],
    };
    if (!entry.pages.includes(page)) entry.pages.push(page);
    if (!entry.alts.includes(alt)) entry.alts.push(alt);
    if (!entry.kinds.includes(kind)) entry.kinds.push(kind);
    media.set(url, entry);
  };

  for (const page of analyzed) {
    const a = page.analysis!;
    for (const image of a.images)
      addMedia(image.src, page.finalUrl, image.alt, `img:${image.region}`);
    for (const bg of a.backgroundImages) addMedia(bg, page.finalUrl, null, 'background');
    for (const doc of a.documents) {
      if (!documents.has(doc)) documents.set(doc, new Set());
      documents.get(doc)!.add(page.finalUrl);
    }
    for (const sheet of a.pageStylesheets) stylesheets.add(sheet);
    for (const email of a.emails) (emails[email] ??= []).push(page.finalUrl);
    for (const phone of a.phones) (phones[phone] ??= []).push(page.finalUrl);
    for (const menu of a.menus) {
      const signature = `${menu.location}:${JSON.stringify(menu.items)}`;
      if (menuSeen.has(signature)) continue;
      menuSeen.add(signature);
      if (menu.location === 'header') header.push(menu);
      if (menu.location === 'footer') footer.push(menu);
    }
    if (a.demoTextHits.length > 0) {
      anomalies.push({
        kind: 'demo-text',
        detail: a.demoTextHits.join(', '),
        pages: [page.finalUrl],
      });
    }
    if (a.unrenderedShortcodes) {
      anomalies.push({
        kind: 'unrendered-shortcodes',
        detail: 'Raw builder shortcodes in page text',
        pages: [page.finalUrl],
      });
    }
  }

  for (const page of pages.filter((p) => p.status >= 400)) {
    anomalies.push({ kind: 'error-page', detail: `HTTP ${page.status}`, pages: [page.finalUrl] });
  }
  for (const link of brokenLinks) {
    anomalies.push({
      kind: 'broken-link',
      detail: `${link.to} → HTTP ${link.status}`,
      pages: [link.from],
    });
  }
  // Resized variants share their original's alt text in the media library.
  const restAlt = new Map(
    (rest?.media ?? []).flatMap((m) => [m.url, ...m.sizes].map((u) => [u, m.alt] as const)),
  );
  for (const entry of media.values()) {
    if (!isSiteHost(new URL(entry.url).hostname, siteHosts)) {
      anomalies.push({ kind: 'foreign-image-host', detail: entry.url, pages: entry.pages });
    }
    const hasAlt = entry.alts.some((alt) => alt && alt.trim()) || Boolean(restAlt.get(entry.url));
    if (!hasAlt && entry.kinds.some((k) => k.startsWith('img:'))) {
      anomalies.push({ kind: 'missing-alt', detail: entry.url, pages: entry.pages });
    }
  }
  const siteDomains = siteHosts.map((h) => h.replace(/^www\./, ''));
  for (const [email, onPages] of Object.entries(emails)) {
    const domain = email.split('@')[1] ?? '';
    if (!siteDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) {
      anomalies.push({ kind: 'foreign-email', detail: email, pages: unique(onPages) });
    }
  }
  const phoneDigits = unique(
    Object.keys(phones).map((p) => p.replace(/\D/g, '').replace(/^00/, '')),
  );
  if (phoneDigits.length > 1) {
    anomalies.push({
      kind: 'contact-conflict',
      detail: `Different phone numbers across pages: ${Object.keys(phones).join(' | ')}`,
      pages: unique(Object.values(phones).flat()),
    });
  }
  if (probe.platform.translationWidgets.length > 0) {
    anomalies.push({
      kind: 'translation-widget',
      detail: `Translation widget(s): ${probe.platform.translationWidgets.join(', ')}. Machine translation is not content.`,
      pages: [probe.home.finalUrl],
    });
  }
  for (const item of rest?.items ?? []) {
    if (item.status && item.status !== 'publish') continue;
    if (!pages.some((p) => p.rest === item)) {
      anomalies.push({
        kind: 'rest-without-page',
        detail: `${item.type} ${item.id} "${item.title}"`,
        pages: [item.link],
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    origin,
    probe,
    sitemaps,
    rest,
    pages,
    menus: { header, footer },
    media: [...media.values()].sort((a, b) => a.url.localeCompare(b.url)),
    documents: [...documents.entries()].map(([url, onPages]) => ({ url, pages: [...onPages] })),
    pageStylesheets: [...stylesheets].sort(),
    contacts: {
      emails: Object.fromEntries(Object.entries(emails).map(([k, v]) => [k, unique(v)])),
      phones: Object.fromEntries(Object.entries(phones).map(([k, v]) => [k, unique(v)])),
    },
    anomalies,
  };
}

/**
 * WordPress with PATHINFO permalinks can serve one object at several URLs (e.g. `/` and `/index.php/`).
 * Keeps one entry per object, preferring the URL that matches the page's canonical link.
 */
function mergeDuplicate(pages: Map<string, InventoryPage>, page: InventoryPage): void {
  const id = page.analysis?.wpId;
  if (id === undefined) return;
  const twin = [...pages.values()].find(
    (p) => p !== page && p.analysis?.wpId === id && p.analysis.wpKind === page.analysis!.wpKind,
  );
  if (!twin) return;
  const isCanonical = (p: InventoryPage) => p.analysis?.canonical === p.finalUrl;
  const [keep, drop] = isCanonical(page) && !isCanonical(twin) ? [page, twin] : [twin, page];
  pages.delete(drop.key);
  pages.set(keep.key, keep);
  keep.aliases = [...new Set([...keep.aliases, drop.key, ...drop.aliases])];
  keep.requested = [...new Set([...keep.requested, ...drop.requested])];
  keep.sources = [...new Set([...keep.sources, ...drop.sources])];
}

function emptyInventory(origin: string, probe: Probe): Inventory {
  return {
    generatedAt: new Date().toISOString(),
    origin,
    probe,
    sitemaps: [],
    rest: null,
    pages: [],
    menus: { header: [], footer: [] },
    media: [],
    documents: [],
    pageStylesheets: [],
    contacts: { emails: {}, phones: {} },
    anomalies: [],
  };
}

function summarizeItem(type: string, item: RestItemJson): RestItemSummary {
  return {
    type,
    id: item.id,
    slug: item.slug ?? '',
    link: item.link ?? '',
    parent: item.parent ?? 0,
    ...(item.status ? { status: item.status } : {}),
    ...(item.template ? { template: item.template } : {}),
    ...(item.modified ? { modified: item.modified } : {}),
    ...(item.menu_order !== undefined ? { menuOrder: item.menu_order } : {}),
    title: decodeEntities(item.title?.rendered ?? ''),
  };
}

function summarizeMedia(item: RestMediaJson): RestMediaSummary {
  return {
    id: item.id,
    url: item.source_url ?? '',
    sizes: Object.values(item.media_details?.sizes ?? {})
      .map((size) => size.source_url)
      .filter((url): url is string => Boolean(url)),
    alt: item.alt_text ?? '',
    caption: decodeEntities((item.caption?.rendered ?? '').replace(/<[^>]+>/g, '')).trim(),
    mime: item.mime_type ?? '',
    ...(item.media_details?.width ? { width: item.media_details.width } : {}),
    ...(item.media_details?.height ? { height: item.media_details.height } : {}),
    parent: item.post ?? 0,
  };
}

/** Decodes the HTML entities WordPress puts in rendered titles. */
export function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X'))
      return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
    return named[code.toLowerCase()] ?? entity;
  });
}

async function safeGet(
  http: HttpClient,
  url: string,
): Promise<{ finalUrl: string; status: number } | undefined> {
  const response = await safeFetch(http, url, 'text/html');
  return response ? { finalUrl: response.finalUrl, status: response.status } : undefined;
}

async function safeFetch(http: HttpClient, url: string, accept: string) {
  try {
    return await http.get(url, accept);
  } catch (error) {
    if ((error as Error).name === 'NetworkPolicyError') throw error;
    return undefined;
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
