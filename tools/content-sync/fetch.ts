import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ARCHIVE_DIR } from './config.ts';
import type { Inventory } from './discover.ts';
import { bodyText, NetworkPolicyError, type HttpClient } from './http.ts';
import { cssImageUrls, isSiteHost, stripSizeSuffix, unwrapJetpack } from './url.ts';

export type AssetKind = 'image' | 'document' | 'stylesheet';

export interface AssetEntry {
  /** URL of the file that was downloaded (the original, when it could be found). */
  url: string;
  kind: AssetKind;
  status: number;
  file: string | null;
  sha256: string | null;
  contentType: string;
  bytes: number;
}

export interface AssetManifest {
  generatedAt: string;
  assets: AssetEntry[];
  /** Every URL referenced by the site (variant, CDN or original) → the downloaded asset URL. */
  resolved: Record<string, string>;
  /** Referenced files that could not be downloaded, with the reason. */
  missing: { url: string; reason: string }[];
}

export interface FetchOptions {
  siteHosts: readonly string[];
  /** Extra hosts allowed to serve images (e.g. a CDN the site uses). */
  assetHosts?: readonly string[];
  log?: (message: string) => void;
}

export const ASSET_MANIFEST = path.join(ARCHIVE_DIR, 'assets.json');

/** Downloads every image, document and builder stylesheet the inventory references. */
export async function fetchAssets(
  inventory: Inventory,
  http: HttpClient,
  options: FetchOptions,
): Promise<AssetManifest> {
  const log = options.log ?? (() => undefined);
  const allowed = new Set([...options.siteHosts, ...(options.assetHosts ?? [])]);
  const assets = new Map<string, AssetEntry>();
  const resolved: Record<string, string> = {};
  const missing: AssetManifest['missing'] = [];

  // WordPress media library: every resized variant maps back to its original.
  const originals = new Map<string, string>();
  for (const media of inventory.rest?.media ?? []) {
    originals.set(media.url, media.url);
    for (const size of media.sizes) originals.set(size, media.url);
  }

  const download = async (url: string, kind: AssetKind): Promise<AssetEntry | undefined> => {
    const existing = assets.get(url);
    if (existing) return existing;
    const host = new URL(url).hostname;
    if (!allowed.has(host)) return undefined;
    try {
      const response = await http.get(url, kind === 'image' ? 'image/*' : '*/*');
      const entry: AssetEntry = {
        url,
        kind,
        status: response.status,
        file: response.status === 200 ? response.file : null,
        sha256: response.status === 200 ? response.sha256 : null,
        contentType: response.headers['content-type'] ?? '',
        bytes: response.body.length,
      };
      assets.set(url, entry);
      return entry;
    } catch (error) {
      if (error instanceof NetworkPolicyError) throw error;
      missing.push({ url, reason: (error as Error).message });
      return undefined;
    }
  };

  const images = new Set(inventory.media.map((m) => m.url));
  // Images referenced outside page bodies: the site icon and social-share images.
  if (inventory.probe.rest?.siteIcon) images.add(inventory.probe.rest.siteIcon);
  for (const page of inventory.pages) {
    const og = page.analysis?.meta['og:image'];
    if (og) images.add(new URL(og, page.finalUrl).href);
  }

  // Builder CSS (e.g. Elementor's post-N.css) holds section background images.
  for (const sheet of inventory.pageStylesheets) {
    const entry = await download(sheet, 'stylesheet');
    if (entry?.status !== 200) continue;
    const response = await http.get(sheet); // memoized: the response `download` just archived
    for (const url of cssImageUrls(bodyText(response), sheet)) images.add(url);
  }

  let done = 0;
  for (const referenced of images) {
    const unwrapped = unwrapJetpack(referenced);
    const candidates = [
      ...new Set(
        [
          originals.get(unwrapped),
          isSiteHost(new URL(unwrapped).hostname, options.siteHosts)
            ? stripSizeSuffix(unwrapped)
            : undefined,
          unwrapped,
          referenced,
        ].filter((u): u is string => Boolean(u)),
      ),
    ];
    let found: AssetEntry | undefined;
    for (const candidate of candidates) {
      const entry = await download(candidate, 'image');
      if (entry?.status === 200 && /^image\//.test(entry.contentType)) {
        found = entry;
        break;
      }
    }
    if (found) {
      resolved[referenced] = found.url;
      if (unwrapped !== referenced) resolved[unwrapped] = found.url;
    } else {
      const host = new URL(unwrapped).hostname;
      missing.push({
        url: referenced,
        reason: allowed.has(host) ? 'not downloadable' : `host ${host} is not allowlisted`,
      });
    }
    if (++done % 25 === 0) log(`Images: ${done}/${images.size}`);
  }

  for (const doc of inventory.documents) {
    const entry = await download(doc.url, 'document');
    if (entry?.status === 200) resolved[doc.url] = doc.url;
    else if (!entry) missing.push({ url: doc.url, reason: 'host is not allowlisted' });
    else missing.push({ url: doc.url, reason: `HTTP ${entry.status}` });
  }

  return {
    generatedAt: new Date().toISOString(),
    assets: [...assets.values()].sort((a, b) => a.url.localeCompare(b.url)),
    resolved: Object.fromEntries(Object.entries(resolved).sort(([a], [b]) => a.localeCompare(b))),
    missing,
  };
}

export async function writeAssetManifest(
  manifest: AssetManifest,
  file = ASSET_MANIFEST,
): Promise<void> {
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
}
