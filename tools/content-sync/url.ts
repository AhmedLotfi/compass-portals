/** URL helpers shared by the crawler, the analyzer and the route mapper. */

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|mc_[a-z]+|_ga)$/i;

/** Query parameters that WordPress uses for distinct content and must be kept. */
const CONTENT_PARAMS = new Set([
  'p',
  'page_id',
  'post_type',
  'cat',
  'tag',
  'attachment_id',
  'lang',
]);

const SKIP_PATH =
  /^\/(?:index\.php\/)?(?:wp-admin|wp-login\.php|wp-json|xmlrpc\.php|feed|comments\/feed|wp-cron\.php|cdn-cgi)(?:\/|$)|\/feed\/?$|\/trackback\/?$|\/embed\/?$/i;

const DOCUMENT_EXT = /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|csv|txt)$/i;
const MEDIA_EXT = /\.(?:jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|mp4|webm|mov|mp3|wav)$/i;
const ASSET_EXT = /\.(?:css|js|mjs|map|woff2?|ttf|otf|eot|json|xml)$/i;

export function isSiteHost(host: string, siteHosts: readonly string[]): boolean {
  return siteHosts.includes(host.toLowerCase());
}

/** Resolves `href` against `base`; returns undefined for javascript:, data:, mailto:, tel: and broken URLs. */
export function resolveUrl(href: string | undefined, base: string): URL | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!trimmed || /^(?:javascript|data|mailto|tel|sms|whatsapp|skype):/i.test(trimmed))
    return undefined;
  try {
    return new URL(trimmed, base);
  } catch {
    return undefined;
  }
}

/**
 * Normalizes a same-site URL for de-duplication while crawling: https, no `www.`, no hash, no tracking
 * parameters, sorted remaining parameters. Paths are kept exactly (including `/index.php/` and trailing
 * slashes), because the old site may serve different things at each.
 */
export function crawlKey(url: URL, canonicalHost: string): string {
  const copy = new URL(url.href);
  copy.protocol = 'https:';
  copy.hostname = canonicalHost;
  copy.port = '';
  copy.hash = '';
  const kept = [...copy.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.test(key))
    .sort(([a], [b]) => a.localeCompare(b));
  copy.search = '';
  for (const [key, value] of kept) copy.searchParams.append(key, value);
  return copy.href;
}

export type LinkKind = 'page' | 'document' | 'media' | 'asset' | 'skip';

/** Classifies a same-site URL so the crawler only follows HTML pages. */
export function classifyPath(url: URL): LinkKind {
  const pathname = decodeURIComponent(url.pathname);
  if (SKIP_PATH.test(pathname)) return 'skip';
  if (url.searchParams.has('replytocom') || url.searchParams.has('share')) return 'skip';
  if (/\/wp-content\/uploads\//i.test(pathname)) {
    return DOCUMENT_EXT.test(pathname) ? 'document' : 'media';
  }
  if (DOCUMENT_EXT.test(pathname)) return 'document';
  if (MEDIA_EXT.test(pathname)) return 'media';
  if (ASSET_EXT.test(pathname) || /\/wp-(?:content|includes)\//i.test(pathname)) return 'asset';
  const unknownParams = [...url.searchParams.keys()].filter(
    (key) => !CONTENT_PARAMS.has(key) && !TRACKING_PARAMS.test(key),
  );
  if (unknownParams.length > 0) return 'skip';
  return 'page';
}

/** Removes the PATHINFO `/index.php` prefix WordPress uses without mod_rewrite. */
export function stripIndexPhp(pathname: string): string {
  const stripped = pathname.replace(/^\/index\.php(?=\/|$)/i, '');
  return stripped === '' ? '/' : stripped;
}
