import { XMLParser } from 'fast-xml-parser';

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  images: string[];
}

export interface ParsedSitemap {
  kind: 'index' | 'urlset' | 'unknown';
  /** Child sitemaps (for an index). */
  sitemaps: string[];
  urls: SitemapUrl[];
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  isArray: (name) => ['sitemap', 'url', 'image'].includes(name),
  trimValues: true,
});

export function parseSitemap(xml: string): ParsedSitemap {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return { kind: 'unknown', sitemaps: [], urls: [] };
  }
  const index = doc['sitemapindex'] as { sitemap?: { loc?: string }[] } | undefined;
  if (index) {
    return {
      kind: 'index',
      sitemaps: (index.sitemap ?? []).map((s) => s.loc).filter(isString),
      urls: [],
    };
  }
  const urlset = doc['urlset'] as
    { url?: { loc?: string; lastmod?: string; image?: { loc?: string }[] }[] } | undefined;
  if (urlset) {
    return {
      kind: 'urlset',
      sitemaps: [],
      urls: (urlset.url ?? [])
        .filter((u) => isString(u.loc))
        .map((u) => ({
          loc: u.loc!,
          ...(u.lastmod ? { lastmod: String(u.lastmod) } : {}),
          images: (u.image ?? []).map((i) => i.loc).filter(isString),
        })),
    };
  }
  return { kind: 'unknown', sitemaps: [], urls: [] };
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
