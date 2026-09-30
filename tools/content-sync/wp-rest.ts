import { bodyJson, type HttpClient } from './http.ts';

export interface RestRoot {
  /** Base URL for routes: either a path base (`…/wp-json/`) or a query base (`…/?rest_route=`). */
  base: string;
  style: 'path' | 'query';
  name?: string;
  description?: string;
  home?: string;
  siteIcon?: string;
  namespaces: string[];
}

export interface RestType {
  slug: string;
  name: string;
  restBase: string;
  restNamespace: string;
  hierarchical: boolean;
}

interface RootJson {
  name?: string;
  description?: string;
  home?: string;
  url?: string;
  site_icon_url?: string;
  namespaces?: unknown;
}

/** REST base candidates, most specific first. `linkHeader` is the homepage's `Link: <…>; rel="https://api.w.org/"`. */
export function restRootCandidates(origin: string, linkHeader?: string): string[] {
  const candidates: string[] = [];
  const fromLink = linkHeader
    ? /<([^>]+)>\s*;\s*rel="https:\/\/api\.w\.org\/"/i.exec(linkHeader)?.[1]
    : undefined;
  if (fromLink) candidates.push(fromLink);
  candidates.push(`${origin}/wp-json/`, `${origin}/index.php/wp-json/`, `${origin}/?rest_route=/`);
  return [...new Set(candidates)];
}

export async function findRestRoot(
  http: HttpClient,
  origin: string,
  linkHeader?: string,
): Promise<RestRoot | undefined> {
  for (const candidate of restRootCandidates(origin, linkHeader)) {
    try {
      const response = await http.get(candidate, 'application/json');
      if (response.status !== 200) continue;
      const json = bodyJson<RootJson>(response);
      if (!Array.isArray(json.namespaces)) continue;
      const style = candidate.includes('rest_route=') ? 'query' : 'path';
      return {
        base: style === 'query' ? candidate.replace(/rest_route=.*$/, 'rest_route=') : candidate,
        style,
        ...(json.name ? { name: json.name } : {}),
        ...(json.description ? { description: json.description } : {}),
        ...((json.home ?? json.url) ? { home: json.home ?? json.url } : {}),
        ...(json.site_icon_url ? { siteIcon: json.site_icon_url } : {}),
        namespaces: json.namespaces.filter((n): n is string => typeof n === 'string'),
      };
    } catch {
      // Not JSON or not reachable: try the next candidate.
    }
  }
  return undefined;
}

/** Builds a route URL, e.g. `restUrl(root, '/wp/v2/pages', { per_page: 100 })`. */
export function restUrl(
  root: RestRoot,
  route: string,
  params: Record<string, string | number> = {},
): string {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]): [string, string] => [key, String(value)]),
  );
  if (root.style === 'query') {
    const url = new URL(root.base);
    url.searchParams.set('rest_route', route);
    for (const [key, value] of query) url.searchParams.set(key, value);
    return url.href;
  }
  const base = root.base.endsWith('/') ? root.base.slice(0, -1) : root.base;
  const qs = query.toString();
  return `${base}${route}${qs ? `?${qs}` : ''}`;
}

/** Fetches every item of a collection route, following `X-WP-TotalPages`. */
export async function fetchCollection<T>(
  http: HttpClient,
  root: RestRoot,
  route: string,
  params: Record<string, string | number> = {},
): Promise<{ items: T[]; total: number; status: number }> {
  const items: T[] = [];
  let total = 0;
  for (let page = 1; ; page++) {
    const response = await http.get(
      restUrl(root, route, { per_page: 100, ...params, page }),
      'application/json',
    );
    if (response.status !== 200) {
      // Page numbers past the end return 400 rest_post_invalid_page_number.
      return { items, total, status: page === 1 ? response.status : 200 };
    }
    const batch = bodyJson<T[]>(response);
    if (!Array.isArray(batch)) return { items, total, status: 200 };
    items.push(...batch);
    total = Number(response.headers['x-wp-total'] ?? items.length);
    const totalPages = Number(response.headers['x-wp-totalpages'] ?? 1);
    if (page >= totalPages || batch.length === 0) return { items, total, status: 200 };
  }
}

type TypesJson = Record<
  string,
  {
    name?: string;
    slug?: string;
    rest_base?: string;
    rest_namespace?: string;
    hierarchical?: boolean;
  }
>;

export async function fetchTypes(http: HttpClient, root: RestRoot): Promise<RestType[]> {
  const response = await http.get(restUrl(root, '/wp/v2/types'), 'application/json');
  if (response.status !== 200) return [];
  const json = bodyJson<TypesJson>(response);
  return Object.entries(json)
    .filter(([, value]) => value && typeof value.rest_base === 'string')
    .map(([slug, value]) => ({
      slug: value.slug ?? slug,
      name: value.name ?? slug,
      restBase: value.rest_base!,
      restNamespace: value.rest_namespace ?? 'wp/v2',
      hierarchical: Boolean(value.hierarchical),
    }));
}
