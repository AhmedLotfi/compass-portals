/**
 * Normalize + emit + verify: turns the archived site into the portal's typed content snapshot
 * (src/content/) and proves that no visible sentence was lost on the way.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  MediaIndexSchema,
  PageDocSchema,
  RedirectsSchema,
  RouteIndexSchema,
  RouteTableSchema,
  SiteSchema,
  type Media,
  type MediaRef,
  type PageDoc,
  type Redirect,
  type RouteEntry,
  type Site,
} from '../../schema/content.ts';
import type { Inventory } from './discover.ts';
import type { AssetManifest } from './fetch.ts';
import { bodyText, type HttpClient } from './http.ts';
import { MediaRegistry } from './media.ts';
import { comparable, htmlBlockText, sentences } from './normalize/sentences.ts';
import { normalizePage, type PageDraft } from './page.ts';
import { buildRedirects, buildRoutes, createLinkMap, parentOf, type RouteRule } from './routes.ts';
import { buildSite } from './site.ts';

export interface Waiver {
  /** Route id, or `*` for every page. */
  page: string;
  /** Exact sentence, or a regular expression written as `/pattern/flags`. */
  match: string;
  reason: string;
}

export interface SyncOptions {
  inventory: Inventory;
  assets: AssetManifest;
  /** Offline client over the archive. */
  http: HttpClient;
  siteHosts: string[];
  /** Canonical origin of the new site. */
  origin: string;
  /** Origin the content was synced from. */
  source: string;
  outDir: string;
  archiveDir?: string;
  waivers?: Waiver[];
  rules?: RouteRule[];
  syncedAt?: string;
  log?: (message: string) => void;
}

export interface CoverageGap {
  page: string;
  sentence: string;
}

export interface SyncResult {
  site: Site;
  routes: RouteEntry[];
  docs: PageDoc[];
  media: Media[];
  redirects: Redirect[];
  gaps: CoverageGap[];
  missingMedia: { url: string; page: string }[];
  unresolvedLinks: { path: string; from: string[] }[];
  skipped: { url: string; reason: string }[];
  /** Files the snapshot consists of, relative to outDir, with their contents. */
  files: Map<string, string>;
}

/** All visible text of a page document, one piece per line. */
export function docText(doc: PageDraft): string {
  const parts: string[] = [
    doc.hero.title,
    doc.hero.lede ?? '',
    ...doc.hero.ctas.map((c) => c.label),
    ...(doc.hero.slides ?? []).flatMap((s) => [s.title, s.lede ?? '']),
  ];
  for (const section of doc.sections) {
    if (section.title) parts.push(section.title);
    for (const block of section.blocks) {
      switch (block.type) {
        case 'richText':
          parts.push(htmlBlockText(block.html));
          break;
        case 'featureList':
          parts.push(
            block.title ?? '',
            ...block.items.flatMap((i) => [i.title ?? '', htmlBlockText(i.html)]),
          );
          break;
        case 'moduleGrid':
          parts.push(
            block.title ?? '',
            ...block.items.flatMap((i) => [
              i.title,
              i.html ? htmlBlockText(i.html) : '',
              i.linkLabel ?? '',
            ]),
          );
          break;
        case 'media':
          parts.push(block.caption ?? '');
          break;
        case 'gallery':
          parts.push(...block.items.map((i) => i.caption ?? ''));
          break;
        case 'cta':
          parts.push(block.label);
          break;
        case 'stats':
          parts.push(...block.items.flatMap((i) => [i.value, i.label]));
          break;
        case 'quote':
          parts.push(htmlBlockText(block.html), block.cite ?? '', ...(block.role ?? []));
          break;
        case 'faq':
          parts.push(...block.items.flatMap((i) => [i.question, htmlBlockText(i.html)]));
          break;
        case 'contactForm':
          parts.push(
            ...block.fields.flatMap((f) => [f.label, ...(f.options ?? [])]),
            block.submitLabel ?? '',
          );
          break;
        case 'embed':
          break;
      }
    }
  }
  return parts.join('\n');
}

function waived(page: string, sentence: string, waivers: Waiver[]): boolean {
  return waivers.some((w) => {
    if (w.page !== '*' && w.page !== page) return false;
    const regex = /^\/(.+)\/([a-z]*)$/.exec(w.match);
    return regex
      ? new RegExp(regex[1]!, regex[2]).test(sentence)
      : comparable(w.match) === sentence;
  });
}

/** Source sentences missing from the output text (after waivers). */
export function coverageGaps(
  page: string,
  sourceText: string,
  doc: PageDraft,
  waivers: Waiver[] = [],
): string[] {
  const output = comparable(docText(doc).replace(/\n/g, ' '));
  return [...new Set(sentences(sourceText))].filter(
    (s) => !output.includes(s) && !waived(page, s, waivers),
  );
}

function firstParagraph(doc: PageDraft): string | undefined {
  if (doc.hero.lede) return doc.hero.lede;
  for (const section of doc.sections) {
    for (const block of section.blocks) {
      if (block.type !== 'richText') continue;
      const match = /<p>(.*?)<\/p>/s.exec(block.html);
      if (match) return htmlBlockText(match[1]!).replace(/\s+/g, ' ').trim();
    }
  }
  return undefined;
}

function firstMedia(doc: PageDraft): string | undefined {
  if (doc.hero.media) return doc.hero.media;
  for (const section of doc.sections) {
    for (const block of section.blocks) {
      if (block.type === 'media') return block.media;
      if (block.type === 'gallery' && block.items[0]) return block.items[0].media;
    }
  }
  return undefined;
}

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

export async function runSync(options: SyncOptions): Promise<SyncResult> {
  const log = options.log ?? (() => undefined);
  const { inventory, http, siteHosts } = options;
  const syncedAt = options.syncedAt ?? new Date().toISOString();

  const { routes, skipped } = buildRoutes(inventory, siteHosts, options.rules);
  if (!routes.some((r) => r.path === '/'))
    throw new Error('The inventory has no front page to build the site from.');
  const media = new MediaRegistry({
    assets: options.assets,
    restMedia: inventory.rest?.media ?? [],
    ...(options.archiveDir ? { archiveDir: options.archiveDir } : {}),
  });
  const links = createLinkMap(routes, siteHosts, (url) => media.hrefFor(url));

  const normalized = new Map<string, ReturnType<typeof normalizePage>>();
  for (const route of routes) {
    const response = await http.get(route.page.finalUrl, 'text/html');
    normalized.set(
      route.id,
      normalizePage(route, bodyText(response), links.resolverFor(route.page.finalUrl), media),
    );
  }
  log(`Normalized ${routes.length} pages`);

  const home = routes.find((r) => r.path === '/')!;
  const homeHtml = bodyText(await http.get(home.page.finalUrl, 'text/html'));
  const siteDraft = buildSite({
    inventory,
    homeHtml,
    homeUrl: home.page.finalUrl,
    resolve: links.resolverFor(home.page.finalUrl),
    media,
    origin: options.origin,
    source: options.source,
    syncedAt,
  });

  const mediaList = await media.finalize();
  const homeLabel =
    siteDraft.navigation.header.find((item) => item.href === '/')?.label ??
    home.title ??
    siteDraft.name;

  const entries: RouteEntry[] = routes.map((route) => {
    const doc = normalized.get(route.id)!.doc;
    const parent = parentOf(route, routes);
    const summary = firstParagraph(doc);
    const image = firstMedia(doc);
    return {
      id: route.id,
      path: route.path,
      kind: route.kind,
      params: {},
      parentId: parent?.id ?? null,
      order: route.order,
      title: route.title,
      ...(summary ? { summary } : {}),
      ...(image ? { media: image } : {}),
      sourceUrl: route.page.finalUrl,
      oldUrls: route.oldUrls.map((u) => {
        const url = new URL(u);
        return decodeURIComponent(url.pathname) + url.search;
      }),
      ...(route.modified ? { modified: route.modified } : {}),
    };
  });

  const refs = new Map<string, MediaRef>(
    mediaList.map((m) => [
      m.id,
      {
        id: m.id,
        mime: m.mime,
        width: m.width,
        height: m.height,
        alt: m.alt,
        widths: m.widths,
        svg: m.svg,
        ...(m.placeholder ? { placeholder: m.placeholder } : {}),
      },
    ]),
  );
  const refsFor = (ids: Iterable<string>) =>
    Object.fromEntries(
      [...new Set(ids)]
        .sort()
        .filter((id) => refs.has(id))
        .map((id) => [id, refs.get(id)!]),
    );

  const docs: PageDoc[] = routes.map((route) => {
    const { doc } = normalized.get(route.id)!;
    const chain: { label: string; path: string }[] = [];
    for (let parent = parentOf(route, routes); parent; parent = parentOf(parent, routes)) {
      chain.unshift({ label: parent.path === '/' ? homeLabel : parent.title, path: parent.path });
      if (parent.path === '/') break;
    }
    const children = entries
      .filter((e) => e.parentId === route.id && route.path !== '/')
      .sort((a, b) => a.order - b.order || a.path.localeCompare(b.path))
      .map((e) => ({
        id: e.id,
        path: e.path,
        title: e.title,
        ...(e.summary ? { summary: e.summary } : {}),
        ...(e.media ? { media: e.media } : {}),
      }));
    const used = mediaList.filter((m) => m.usedOn.includes(route.id)).map((m) => m.id);
    const childMedia = children.map((c) => c.media).filter((id): id is string => Boolean(id));
    return PageDocSchema.parse({
      ...doc,
      breadcrumbs: route.path === '/' ? [] : [...chain, { label: route.title, path: route.path }],
      children,
      media: refsFor([...used, ...childMedia, ...(doc.seo.image ? [doc.seo.image] : [])]),
    });
  });

  const redirects = buildRedirects(routes);
  for (const item of mediaList) {
    const from = decodeURIComponent(new URL(item.sourceUrl).pathname);
    if (!redirects.some((r) => r.from === from)) {
      redirects.push({
        from,
        to: item.svg ? `/media/${item.id}.svg` : `/media/${item.id}.webp`,
        status: 301,
        reason: 'uploaded image',
      });
    }
  }
  for (const asset of options.assets.assets.filter(
    (a) => a.kind === 'document' && a.status === 200,
  )) {
    const url = new URL(asset.url);
    const name = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    redirects.push({
      from: decodeURIComponent(url.pathname),
      to: `/files/${encodeURIComponent(name)}`,
      status: 301,
      reason: 'uploaded document',
    });
  }
  redirects.sort((a, b) => a.from.localeCompare(b.from));

  const site = SiteSchema.parse({
    ...siteDraft,
    media: refsFor([siteDraft.logo, siteDraft.icon].filter((id): id is string => Boolean(id))),
    snapshot: { syncedAt, pages: docs.length, media: mediaList.length },
  });

  const gaps: CoverageGap[] = [];
  for (const route of routes) {
    const { doc, sourceText } = normalized.get(route.id)!;
    for (const sentence of coverageGaps(route.id, sourceText, doc, options.waivers))
      gaps.push({ page: route.id, sentence });
  }

  const files = snapshotFiles(site, entries, docs, mediaList, redirects);

  return {
    site,
    routes: entries,
    docs,
    media: mediaList,
    redirects,
    gaps,
    missingMedia: media.missing,
    unresolvedLinks: [...links.unresolved.entries()].map(([p, from]) => ({
      path: p,
      from: [...from],
    })),
    skipped,
    files,
  };
}

/** The snapshot's files (relative to src/content), each validated against the content schema. */
export function snapshotFiles(
  site: Site,
  entries: RouteEntry[],
  docs: PageDoc[],
  mediaList: Media[],
  redirects: Redirect[],
): Map<string, string> {
  const files = new Map<string, string>();
  files.set('site.json', json(SiteSchema.parse(site)));
  files.set('index.json', json(RouteIndexSchema.parse({ routes: entries })));
  files.set(
    'routes.json',
    json(
      RouteTableSchema.parse({
        routes: entries.map(({ id, path, kind, lang }) => ({
          id,
          path,
          kind,
          ...(lang ? { lang } : {}),
        })),
      }),
    ),
  );
  files.set('media.json', json(MediaIndexSchema.parse({ media: mediaList })));
  files.set('redirects.json', json(RedirectsSchema.parse({ redirects })));
  for (const doc of docs) files.set(`pages/${doc.id}.json`, json(PageDocSchema.parse(doc)));
  files.set(
    'page-loaders.ts',
    [
      '// Generated by tools/content-sync. Do not edit.',
      "import type { PageDoc } from '@schema/content';",
      '',
      'export const pageLoaders: Record<string, () => Promise<PageDoc>> = {',
      ...docs.map(
        (doc) =>
          `  ${JSON.stringify(doc.id)}: () => import('./pages/${doc.id}.json').then((m) => m.default as unknown as PageDoc),`,
      ),
      '};',
      '',
    ].join('\n'),
  );
  return files;
}

/** Media records reduced to what pages need, for `refsFor`. */
export function mediaRefs(mediaList: Media[]): Map<string, MediaRef> {
  return new Map<string, MediaRef>(
    mediaList.map((m) => [
      m.id,
      {
        id: m.id,
        mime: m.mime,
        width: m.width,
        height: m.height,
        alt: m.alt,
        widths: m.widths,
        svg: m.svg,
        ...(m.placeholder ? { placeholder: m.placeholder } : {}),
      },
    ]),
  );
}

/** Writes the snapshot, replacing any previous one. Returns the paths that changed. */
export async function writeSnapshot(outDir: string, files: Map<string, string>): Promise<string[]> {
  const changed: string[] = [];
  const existing = new Set<string>();
  try {
    for (const name of await readdir(path.join(outDir, 'pages'))) existing.add(`pages/${name}`);
  } catch {
    // First sync.
  }
  for (const [name, content] of files) {
    const target = path.join(outDir, name);
    let previous: string | undefined;
    try {
      previous = await readFile(target, 'utf8');
    } catch {
      previous = undefined;
    }
    if (previous !== content) {
      changed.push(name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    existing.delete(name);
  }
  for (const stale of existing) {
    changed.push(stale);
    await rm(path.join(outDir, stale));
  }
  return changed;
}

/** Compares a snapshot to what is on disk without writing (for scheduled re-sync checks). */
export async function snapshotDiff(outDir: string, files: Map<string, string>): Promise<string[]> {
  const different: string[] = [];
  for (const [name, content] of files) {
    try {
      if ((await readFile(path.join(outDir, name), 'utf8')) !== content) different.push(name);
    } catch {
      different.push(name);
    }
  }
  return different;
}

export function coverageMarkdown(result: SyncResult): string {
  const lines = ['# Content sync report', ''];
  lines.push(
    `- Pages: ${result.docs.length}; media: ${result.media.length}; redirects: ${result.redirects.length}`,
  );
  lines.push(`- Coverage gaps: **${result.gaps.length}** (must be 0, or waived with a reason)`);
  lines.push(
    `- Missing media: ${result.missingMedia.length}; unresolved internal links: ${result.unresolvedLinks.length}`,
  );
  const derived = result.media.filter((m) => m.altSource === 'derived');
  const decorative = result.media.filter((m) => m.altSource === 'decorative');
  lines.push(
    `- Alt text derived from nearby text (review): ${derived.length}; decorative (empty alt): ${decorative.length}`,
    '',
  );
  if (result.gaps.length) {
    lines.push('## Coverage gaps', '');
    for (const gap of result.gaps) lines.push(`- \`${gap.page}\`: ${gap.sentence}`);
    lines.push('');
  }
  if (result.missingMedia.length) {
    lines.push('## Missing media', '');
    for (const m of result.missingMedia) lines.push(`- ${m.url} (on \`${m.page}\`)`);
    lines.push('');
  }
  if (result.unresolvedLinks.length) {
    lines.push('## Unresolved internal links', '');
    for (const link of result.unresolvedLinks)
      lines.push(`- ${link.path} (from ${link.from.join(', ')})`);
    lines.push('');
  }
  if (derived.length) {
    lines.push('## Derived alt text (review)', '');
    for (const m of derived) lines.push(`- \`${m.id}\` ${m.sourceUrl}: "${m.alt}"`);
    lines.push('');
  }
  if (result.skipped.length) {
    lines.push('## Skipped URLs', '');
    for (const s of result.skipped) lines.push(`- ${s.url}: ${s.reason}`);
    lines.push('');
  }
  return lines.join('\n');
}
