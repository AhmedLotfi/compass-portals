/**
 * Content sync for the CMS-driven compassint.org: the archived API responses (api.ts) and the
 * browser-rendered pages (rendered.ts) → the portal's snapshot, with the same coverage proof as the
 * HTML sync: every sentence of every API text a page is meant to show must be in its output.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { NavItem, PageDoc, Redirect, RouteEntry, Site } from '../../../schema/content.ts';
import type { AssetManifest } from '../fetch.ts';
import { MediaRegistry } from '../media.ts';
import type { LinkResolver } from '../normalize/sanitize.ts';
import {
  coverageGaps,
  mediaRefs,
  snapshotFiles,
  type CoverageGap,
  type SyncResult,
  type Waiver,
} from '../sync.ts';
import { Archive, loadCms } from './api.ts';
import { FRONT_END_LOGO } from './fetch.ts';
import { arLabel, localPath, mapSite, SECTIONS, type CmsPage, type Lang } from './map.ts';
import { readChrome, RenderedSite } from './rendered.ts';

export interface CmsSyncOptions {
  /** source-archive/http */
  archiveDir: string;
  /** source-archive/rendered */
  renderedDir: string;
  /** Canonical origin of the new site. */
  origin: string;
  /** Origin of the old site. */
  source: string;
  siteHosts: readonly string[];
  waivers?: Waiver[];
  syncedAt?: string;
  log?: (message: string) => void;
}

const SOCIAL: [RegExp, string][] = [
  [/(^|\.)facebook\.com$/, 'facebook'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)(twitter|x)\.com$/, 'x'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)youtube\.com$/, 'youtube'],
];

/** Old site path → new path, for links in CMS text and the front end's header and footer. */
export function oldPathMap(pages: CmsPage[]): (pathname: string) => string | undefined {
  const exact = new Map<string, string>();
  const prefixes: [string, string][] = [];
  for (const page of pages) {
    exact.set(page.doc.path.replace(/\/$/, '') || '/', page.doc.path);
    for (const old of page.oldPaths) exact.set(old.replace(/\/$/, '') || '/', page.doc.path);
    for (const prefix of page.oldPrefixes) prefixes.push([prefix, page.doc.path]);
  }
  return (pathname: string) => {
    const decoded = decodeURIComponent(pathname);
    const bare = decoded.replace(/\/$/, '') || '/';
    return (
      exact.get(bare) ?? prefixes.find(([prefix]) => decoded.startsWith(prefix))?.[1] ?? undefined
    );
  };
}

/**
 * Whether an image is drawn light (white on transparent, for dark backgrounds) or dark: the
 * luminance of its visible pixels, weighted by their opacity.
 */
export async function imageTone(file: string): Promise<'light' | 'dark' | undefined> {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let weight = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const alpha = data[i + 3]! / 255;
    sum += alpha * (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!);
    weight += alpha;
  }
  if (!weight) return undefined;
  return sum / weight > 160 ? 'light' : 'dark';
}

/** Writes an inline (data URI) image into the archive, so it is a file like any other. */
async function inlineAsset(
  dataUri: string,
  archiveDir: string,
  origin: string,
): Promise<AssetManifest['assets'][number] | undefined> {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/s.exec(dataUri);
  if (!match) return undefined;
  const buffer = Buffer.from(match[2]!, 'base64');
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const ext = match[1] === 'image/svg+xml' ? 'svg' : match[1]!.split('/')[1]!;
  const file = `inline/${sha256.slice(0, 10)}.${ext}`;
  const target = path.join(archiveDir, file);
  try {
    await access(target);
  } catch {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer);
  }
  return {
    // Inline in the old front end's HTML; the fragment names the archived copy.
    url: `${origin}/#inline-${sha256.slice(0, 10)}`,
    kind: 'image',
    status: 200,
    file,
    sha256,
    contentType: match[1]!,
    bytes: buffer.length,
  };
}

export async function runCmsSync(options: CmsSyncOptions): Promise<SyncResult> {
  const log = options.log ?? (() => undefined);
  const syncedAt = options.syncedAt ?? new Date().toISOString();
  const archive = await Archive.open(options.archiveDir);
  const rendered = await RenderedSite.open(options.renderedDir);
  const cms = await loadCms(archive);
  const home = await rendered.page('/');
  const chrome = readChrome(home);

  const assets = archive.imageAssets();
  // The logo: the front end's own full-colour logo file when the archive has it (cms/fetch.ts
  // downloads it), else the copy its build inlined into the header.
  const logoFile = `${options.source}${FRONT_END_LOGO}`;
  const logoEntry = archive.get(logoFile);
  const logoAsset =
    logoEntry?.status === 200 && logoEntry.file
      ? assets.assets.find((asset) => asset.url === logoFile)
      : chrome.logo
        ? await inlineAsset(chrome.logo.src, options.archiveDir, options.source)
        : undefined;
  if (logoAsset && !assets.resolved[logoAsset.url]) {
    assets.assets.push(logoAsset);
    assets.resolved[logoAsset.url] = logoAsset.url;
  }
  const media = new MediaRegistry({ assets, restMedia: [], archiveDir: options.archiveDir });

  // Links inside CMS text: the old paths are only known once the pages are mapped, so resolve
  // through a late-bound map.
  let mapOld: (pathname: string) => string | undefined = () => undefined;
  const unresolved = new Map<string, Set<string>>();
  const siteHost = (host: string) =>
    options.siteHosts.includes(host.toLowerCase()) ||
    options.siteHosts.includes(host.toLowerCase().replace(/^www\./, ''));
  const resolve: LinkResolver = (href) => {
    const trimmed = href.trim();
    if (/^mailto:/i.test(trimmed)) return { href: trimmed, kind: 'email' };
    if (/^tel:/i.test(trimmed)) return { href: trimmed.replace(/\s+/g, ''), kind: 'phone' };
    if (trimmed.startsWith('#')) return { href: trimmed, kind: 'internal' };
    let url: URL;
    try {
      url = new URL(trimmed, `${options.source}/`);
    } catch {
      return { href: trimmed, kind: 'external' };
    }
    if (!siteHost(url.hostname)) return { href: url.href, kind: 'external' };
    const target = mapOld(url.pathname);
    if (target) return { href: target + url.hash, kind: 'internal' };
    const from = unresolved.get(url.pathname) ?? new Set<string>();
    from.add('cms');
    unresolved.set(url.pathname, from);
    return { href: url.pathname, kind: 'internal' };
  };

  // Two passes: the first only learns every page's old and new paths, so links in CMS text
  // (which point at old paths) resolve in the second.
  const scratch = new MediaRegistry({ assets, restMedia: [], archiveDir: options.archiveDir });
  mapOld = oldPathMap(
    await mapSite({
      cms,
      rendered,
      media: scratch,
      resolve: (href) => ({ href, kind: 'external' }),
      source: options.source,
      lang: 'en',
    }),
  );
  const english = await mapSite({
    cms,
    rendered,
    media,
    resolve,
    source: options.source,
    lang: 'en',
  });
  const arabic = await mapSite({
    cms,
    rendered,
    media,
    resolve,
    source: options.source,
    lang: 'ar',
  });
  pairTranslations(english, arabic);
  const pages = [...english, ...arabic];
  log(
    `Mapped ${english.length} pages from the CMS, in English and Arabic (${arabic.filter((p) => p.translated).length} with Arabic text)`,
  );

  // Site chrome. Header and footer links point at the old paths; map them to the new ones.
  const siteRef = { id: 'site', url: home.url };
  const logo = logoAsset
    ? media.register(
        { src: logoAsset.url, alt: chrome.logo?.alt || chrome.topbar.split(/\s+·\s+/)[0] || '' },
        siteRef,
      )
    : undefined;
  const nav = (link: { label: string; href: string }): NavItem | undefined => {
    const external = /^https?:/i.test(link.href) && !siteHost(new URL(link.href).hostname);
    if (external) return { label: link.label, href: link.href, external: true, children: [] };
    const target = mapOld(new URL(link.href, `${options.source}/`).pathname);
    if (!target) {
      const from = unresolved.get(link.href) ?? new Set<string>();
      from.add('site navigation');
      unresolved.set(link.href, from);
      return undefined;
    }
    return { label: link.label, href: target, external: false, children: [] };
  };
  const defined = <T>(items: (T | undefined)[]) => items.filter((i): i is T => Boolean(i));
  // The Arabic tree's chrome: the same links, into /ar/, labelled with the Arabic labels
  // (front-end labels) or the Arabic page's own title (pages).
  const arabicByPath = new Map(arabic.map((page) => [page.doc.path, page]));
  const toArabic = (item: NavItem, pageTitle: boolean): NavItem => {
    if (item.external) return item;
    const href = localPath('ar', item.href);
    const page = arabicByPath.get(href);
    return {
      label: pageTitle && page ? page.doc.title : arLabel(item.label),
      href,
      external: false,
      children: item.children.map((child) => toArabic(child, true)),
    };
  };
  const [name = '', tagline] = chrome.topbar.split(/\s+·\s+/);
  const offices = cms.offices.filter((o) => o.isActive);
  const valueOf = (raw: string | null) => (raw ?? '').trim().replace(/^.*?:\s*/, '');
  const phones = defined(
    offices.map((o) => {
      const display = valueOf(o.phoneNumber);
      return display ? { display, tel: `tel:${display.replace(/[^\d+]/g, '')}` } : undefined;
    }),
  );
  const emails = [...new Set(defined(offices.map((o) => valueOf(o.email) || undefined)))];
  const sectionPaths = new Map(SECTIONS.map((s) => [s.key, s.path]));
  const siteDraft: Omit<Site, 'snapshot' | 'media'> = {
    name,
    ...(tagline ? { tagline } : {}),
    origin: options.origin,
    source: options.source,
    ...(logo ? { logo } : {}),
    languages: [
      { code: 'en', dir: 'ltr' },
      { code: 'ar', dir: 'rtl' },
    ],
    navigation: {
      header: defined(chrome.header.map(nav)),
      footer: [
        ...chrome.footerGroups.map((group) => ({
          label: group.title,
          href: sectionPaths.get(group.title.toLowerCase() as never) ?? '/',
          external: false,
          children: defined(group.links.map(nav)),
        })),
        ...defined(chrome.footerLinks.map(nav)),
      ],
    },
    contact: {
      emails,
      phones,
      // The first office the API lists is the head office (Dubai); the contact page lists all.
      address: defined(offices.slice(0, 1).map((o) => o.address?.trim() || undefined)),
    },
    social: chrome.social.flatMap((url) => {
      const host = new URL(url).hostname;
      const network = SOCIAL.find(([pattern]) => pattern.test(host))?.[1];
      return network ? [{ network, url }] : [];
    }),
    apps: [],
    footer: chrome.copyright ? { copyright: chrome.copyright } : {},
  };
  siteDraft.i18n = {
    ar: {
      ...(tagline ? { tagline: arLabel(tagline) } : {}),
      navigation: {
        header: siteDraft.navigation.header.map((item) => toArabic(item, false)),
        footer: siteDraft.navigation.footer.map((item) => toArabic(item, false)),
      },
    },
  };

  const mediaList = await media.finalize();
  const logoRecord = mediaList.find((m) => m.id === logo);
  if (logoRecord) {
    const tone = await imageTone(path.join(options.archiveDir, logoRecord.archiveFile));
    if (tone) siteDraft.logoTone = tone;
  }
  const refs = mediaRefs(mediaList);
  const refsFor = (ids: Iterable<string>) =>
    Object.fromEntries(
      [...new Set(ids)]
        .sort()
        .filter((id) => refs.has(id))
        .map((id) => [id, refs.get(id)!]),
    );

  const byId = new Map(pages.map((p) => [p.doc.id, p]));
  const homeLabels: Record<Lang, string> = {
    en: siteDraft.navigation.header.find((item) => item.href === '/')?.label ?? siteDraft.name,
    ar:
      siteDraft.i18n.ar?.navigation.header.find((item) => item.href === '/ar/')?.label ??
      siteDraft.name,
  };
  const firstParagraph = (page: CmsPage) => page.doc.hero.lede;
  const entries: RouteEntry[] = pages.map((page) => ({
    id: page.doc.id,
    path: page.doc.path,
    kind: page.doc.kind,
    lang: page.lang,
    params: {},
    parentId: page.parentId,
    order: page.order,
    title: page.doc.title,
    ...(firstParagraph(page) ? { summary: firstParagraph(page)! } : {}),
    ...(page.doc.hero.media ? { media: page.doc.hero.media } : {}),
    ...(page.icon ? { icon: page.icon } : {}),
    sourceUrl: page.doc.sourceUrl,
    oldUrls: [...page.oldPaths, ...page.oldPrefixes.map((p) => `${p}*`)],
    ...(page.modified ? { modified: page.modified } : {}),
  }));

  const docs: PageDoc[] = pages.map((page) => {
    const chain: { label: string; path: string }[] = [];
    for (let parent = page.parentId ? byId.get(page.parentId) : undefined; parent;) {
      chain.unshift({
        label: parent.parentId === null ? homeLabels[page.lang] : parent.doc.title,
        path: parent.doc.path,
      });
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    const children = entries
      .filter((e) => e.parentId === page.doc.id && page.parentId !== null)
      .sort((a, b) => a.order - b.order || a.path.localeCompare(b.path))
      .map((e) => ({
        id: e.id,
        path: e.path,
        title: e.title,
        ...(e.summary ? { summary: e.summary } : {}),
        ...(e.media ? { media: e.media } : {}),
        ...(e.icon ? { icon: e.icon } : {}),
      }));
    const used = mediaList.filter((m) => m.usedOn.includes(page.doc.id)).map((m) => m.id);
    return {
      ...page.doc,
      lang: page.lang,
      breadcrumbs:
        page.parentId === null ? [] : [...chain, { label: page.doc.title, path: page.doc.path }],
      children,
      media: refsFor([...used, ...defined(children.map((c) => c.media))]),
    };
  });

  const redirects = buildCmsRedirects(pages);
  const site: Site = {
    ...siteDraft,
    media: refsFor(logo ? [logo] : []),
    snapshot: { syncedAt, pages: docs.length, media: mediaList.length },
  };

  const gaps: CoverageGap[] = [];
  for (const page of pages) {
    for (const sentence of coverageGaps(page.doc.id, page.sourceText, page.doc, options.waivers))
      gaps.push({ page: page.doc.id, sentence });
  }

  return {
    site,
    routes: entries,
    docs,
    media: mediaList,
    redirects,
    gaps,
    missingMedia: media.missing,
    unresolvedLinks: [...unresolved.entries()].map(([p, from]) => ({ path: p, from: [...from] })),
    skipped: [],
    files: snapshotFiles(site, entries, docs, mediaList, redirects),
  };
}

/**
 * Pairs each Arabic page with its English page. A real translation (some CMS text is Arabic)
 * gets hreflang alternates both ways; an Arabic page that only repeats the English stays
 * reachable for navigation, but names the English page as its canonical and has no pair.
 */
export function pairTranslations(english: CmsPage[], arabic: CmsPage[]): void {
  const byKey = new Map(english.map((page) => [page.key, page]));
  for (const ar of arabic) {
    const en = byKey.get(ar.key);
    if (!en) continue;
    if (ar.translated) {
      const alternates = { en: en.doc.path, ar: ar.doc.path };
      en.doc.alternates = alternates;
      ar.doc.alternates = alternates;
    } else {
      ar.doc.seo = { ...ar.doc.seo, canonical: en.doc.path };
    }
  }
}

/**
 * Old URL → new page (301). The old site appended a ciphertext segment that changed on every
 * visit, so each old page is matched by its prefix (`/solution/hr_&_payroll/*`).
 */
export function buildCmsRedirects(pages: CmsPage[]): Redirect[] {
  const redirects = new Map<string, Redirect>();
  const add = (from: string, to: string, reason: string) => {
    if (from === to || from.replace(/\/$/, '') === to.replace(/\/$/, '')) return;
    if (!redirects.has(from)) redirects.set(from, { from, to, status: 301, reason });
  };
  for (const page of pages) {
    for (const old of page.oldPaths)
      add(old.endsWith('/') ? old : `${old}/`, page.doc.path, 'old URL');
    for (const prefix of page.oldPrefixes)
      add(`${prefix}*`, page.doc.path, 'old URL with a per-visit ciphertext');
  }
  return [...redirects.values()].sort((a, b) => a.from.localeCompare(b.from));
}
