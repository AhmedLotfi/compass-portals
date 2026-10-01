/**
 * Downloads every image the CMS API names, including those the old front end never loaded (pages
 * the crawl didn't reach, mobile variants, and images on the CMS's plain-HTTP `ddns.net` host, which
 * browsers block as mixed content on the HTTPS site). For a plain-HTTP URL the HTTPS form is tried
 * first. Everything lands in the HTTP archive, where the sync finds it by URL.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NetworkPolicyError, type HttpClient } from '../http.ts';
import { API_HOST, Archive, collapseSlashes } from './api.ts';

const IMAGE = /\.(?:png|jpe?g|gif|webp|svg|avif)$/i;

/** Fields the sync never uses (the old front end's phone-sized variants). */
const SKIPPED_KEYS = /^mobile/i;

/** Image URLs anywhere in a JSON value (including inside HTML strings), except mobile variants. */
export function imageUrls(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>()]+/g)) {
      const url = match[0].replace(/&amp;/g, '&');
      try {
        if (IMAGE.test(new URL(url).pathname)) out.add(url);
      } catch {
        // Not a URL after all.
      }
    }
  } else if (Array.isArray(value)) {
    for (const item of value) imageUrls(item, out);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (!SKIPPED_KEYS.test(key)) imageUrls(item, out);
    }
  }
  return out;
}

export interface CmsFetchResult {
  downloaded: string[];
  missing: { url: string; reason: string }[];
}

/** The part of HttpClient the fetch needs (a fake in tests). */
export type ImageGetter = Pick<HttpClient, 'get'>;

/**
 * Downloads each image not yet in the archive. One attempt per URL (the client is made with no
 * retries and a short timeout), and an origin (scheme, host and port) that fails at the network level once is skipped for
 * the rest of the run: the CMS names about a hundred images on a host that doesn't answer.
 */
export async function downloadImages(
  urls: Iterable<string>,
  have: (url: string) => boolean,
  http: ImageGetter,
): Promise<CmsFetchResult> {
  const result: CmsFetchResult = { downloaded: [], missing: [] };
  const deadHosts = new Map<string, string>();
  for (const url of [...urls].sort()) {
    if (have(url)) continue;
    const candidates = url.startsWith('http://') ? [url.replace(/^http:/, 'https:'), url] : [url];
    let reason = 'not found';
    let ok = false;
    for (const candidate of candidates) {
      const host = new URL(candidate).origin;
      const dead = deadHosts.get(host);
      if (dead) {
        reason = `host unreachable (${dead})`;
        continue;
      }
      try {
        const response = await http.get(candidate, 'image/*');
        if (response.status === 200 && /^image\//.test(response.headers['content-type'] ?? '')) {
          result.downloaded.push(candidate);
          ok = true;
          break;
        }
        reason = `HTTP ${response.status}`;
      } catch (error) {
        if (error instanceof NetworkPolicyError) throw error;
        reason = (error as Error).message;
        deadHosts.set(host, reason);
      }
    }
    if (!ok) result.missing.push({ url, reason });
  }
  return result;
}

export async function fetchCmsImages(
  archiveDir: string,
  http: ImageGetter,
  log: (message: string) => void = () => undefined,
): Promise<CmsFetchResult> {
  const archive = await Archive.open(archiveDir);
  const urls = new Set<string>();
  for (const entry of archive.entries) {
    if (new URL(entry.url).hostname !== API_HOST || entry.status !== 200 || !entry.file) continue;
    imageUrls(JSON.parse(await readFile(path.join(archiveDir, entry.file), 'utf8')), urls);
  }
  const have = (url: string) => {
    const entry = archive.get(url) ?? archive.get(collapseSlashes(url));
    return entry?.status === 200 && Boolean(entry.file);
  };
  const result = await downloadImages(urls, have, http);
  log(
    `CMS images: ${urls.size} referenced, ${result.downloaded.length} downloaded now, ${result.missing.length} unavailable`,
  );
  return result;
}
