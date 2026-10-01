/**
 * Checks the built site against the content snapshot (after `npm run build`):
 * - parity: every sentence and image of each synced page is in its prerendered HTML
 * - provenance (the hard rule): all text in the HTML — visible text, alt / aria-label / title
 *   attributes, the title, meta descriptions and JSON-LD names — comes from the site or the
 *   microcopy file
 * - links: internal links and assets resolve to files in the build, fragments to ids; links that
 *   come from the site's own content and point nowhere are reported as content anomalies
 * - sitemap: lists exactly the indexable prerendered pages
 * - html: html-validate
 *
 *   node tools/verify/dist.ts [--content=src/content] [--dist=dist/compass-portal]
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { load, type CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { HtmlValidate, type ConfigData } from 'html-validate';
import type { PageDoc, Site } from '../../schema/content.ts';
import { CONTENT_DIR, ROOT } from '../content-sync/config.ts';
import { comparable, htmlBlockText, sentences } from '../content-sync/normalize/sentences.ts';
import { docText } from '../content-sync/sync.ts';
import { loadContent, MICROCOPY, MICROCOPY_AR } from '../postbuild/index.ts';

export type CheckName = 'parity' | 'provenance' | 'links' | 'sitemap' | 'html';

export interface DistReport {
  pages: number;
  errors: Record<CheckName, string[]>;
  /** Problems in the site's own content (e.g. its links to pages that don't exist), for review. */
  anomalies: string[];
}

/** Keys of snapshot values that are identifiers, URLs or enums rather than text shown to people. */
const NON_TEXT_KEYS = new Set([
  'id',
  'kind',
  'type',
  'path',
  'href',
  'url',
  'sourceUrl',
  'archiveFile',
  'mime',
  'provider',
  'icon',
  'network',
  'store',
  'code',
  'dir',
  'origin',
  'source',
  'logo',
  'parentId',
  'oldUrls',
  'modified',
  'syncedAt',
  'placeholder',
  'tel',
  'media',
  'image',
  'mapUrl',
  'titleSource',
  'descriptionSource',
  'altSource',
  'params',
  'widths',
]);

/** Every text value in a snapshot file, one line per block of text. */
export function snapshotText(value: unknown, key = ''): string[] {
  if (typeof value === 'string') {
    if (NON_TEXT_KEYS.has(key)) return [];
    const text = key === 'html' ? htmlBlockText(value) : value;
    return text.split('\n').map(comparable).filter(Boolean);
  }
  if (Array.isArray(value)) return value.flatMap((item) => snapshotText(item, key));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => snapshotText(v, k));
  }
  return [];
}

/** Hrefs the site's own content provides (rich-text links and link fields). */
function contentHrefs(value: unknown, key = '', out = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (key === 'href') out.add(value);
    if (key === 'html') {
      const $ = load(value, null, false);
      $('a[href]').each((_, a) => void out.add($(a).attr('href')!));
    }
  } else if (Array.isArray(value)) {
    for (const item of value) contentHrefs(item, key, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) contentHrefs(v, k, out);
  }
  return out;
}

export interface Allowed {
  corpus: string;
  literals: Set<string>;
  templates: RegExp[];
}

export function allowedText(
  site: Site,
  page: PageDoc | undefined,
  copy: Record<string, string>,
): Allowed {
  // Embeds name their host ("Loads content from google.com"): the host of the site's own embed URL.
  const embedHosts = (page?.sections ?? [])
    .flatMap((section) => section.blocks)
    .flatMap((block) =>
      block.type === 'embed' ? [comparable(new URL(block.url).hostname.replace(/^www\./, ''))] : [],
    );
  const corpus = [...snapshotText(site), ...(page ? snapshotText(page) : []), ...embedHosts].join(
    '\n',
  );
  const literals = new Set<string>();
  const templates: RegExp[] = [];
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const value of [...Object.values(copy), '{title} | {site}']) {
    const text = comparable(value);
    if (!/\{\w+\}/.test(text)) {
      literals.add(text);
      continue;
    }
    const parts = text.split(/\{\w+\}/).map(escape);
    templates.push(new RegExp(`^${parts.join('(.+?)')}$`));
  }
  return { corpus, literals, templates };
}

/** Punctuation around a fragment (": " before a title, a trailing "*") says nothing about origin. */
const EDGES = /^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu;

export function isAllowed(fragment: string, allowed: Allowed): boolean {
  const text = comparable(fragment);
  const known = (piece: string) => {
    const core = piece.replace(EDGES, '');
    return (
      !core || [piece, core].some((p) => allowed.literals.has(p) || allowed.corpus.includes(p))
    );
  };
  const templated = (piece: string) =>
    allowed.templates.some((template) => {
      const match = template.exec(piece);
      return Boolean(match && match.slice(1).every((group) => known(group.trim())));
    });
  if (known(text) || templated(text)) return true;
  // Adjacent strings in one text node, e.g. a network name followed by "(opens in a new tab)".
  let rest = text;
  for (const literal of [...allowed.literals].sort((a, b) => b.length - a.length)) {
    if (!/[\p{L}\p{N}]/u.test(literal)) continue;
    const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rest = rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu'), '\n');
  }
  return (
    rest !== text &&
    rest.split('\n').every((piece) => known(piece.trim()) || templated(piece.trim()))
  );
}

/** Text a visitor or crawler gets from the page, with where it came from. */
export function pageTexts($: CheerioAPI): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  const add = (where: string, text: string | undefined) => {
    if (text?.trim()) out.push({ where, text: text.trim() });
  };
  add('title', $('title').text());
  $('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]').each((_, el) => {
    const name = $(el).attr('name') ?? $(el).attr('property') ?? '';
    if (/(?:description|title|site_name|image:alt)$/.test(name)) add(name, $(el).attr('content'));
  });
  $('script[type="application/ld+json"]').each((_, el) => {
    const walk = (value: unknown, key: string): void => {
      if (typeof value === 'string') {
        if (['name', 'description', 'streetAddress', 'featureList', 'caption'].includes(key)) {
          add(`JSON-LD ${key}`, value);
        }
      } else if (Array.isArray(value)) {
        for (const item of value) walk(item, key);
      } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, k);
      }
    };
    walk(JSON.parse($(el).text()), '');
  });
  const SKIP = new Set(['script', 'style', 'template', 'noscript', 'svg']);
  const visit = (node: AnyNode, where: string) => {
    if (node.type === 'text') {
      add(where, (node as unknown as { data: string }).data);
      return;
    }
    if (node.type !== 'tag') return;
    const el = node as Element;
    if (SKIP.has(el.tagName)) return;
    for (const attr of ['alt', 'title', 'aria-label', 'placeholder', 'aria-description']) {
      add(`${el.tagName}[${attr}]`, el.attribs[attr]);
    }
    for (const child of el.children) visit(child, el.tagName);
  };
  const body = $('body').get(0);
  if (body) visit(body, 'body');
  return out;
}

async function isFile(file: string): Promise<boolean> {
  return stat(file).then(
    (s) => s.isFile(),
    () => false,
  );
}

async function isDir(file: string): Promise<boolean> {
  return stat(file).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

const HTML_VALIDATE_CONFIG: ConfigData = {
  extends: ['html-validate:recommended'],
  rules: {
    // Angular's view encapsulation and hydration attributes (_ngcontent-*, _nghost-*, ngh, ng-*).
    'attr-pattern': ['error', { pattern: ['[a-z0-9-:]+', '_ng[a-z]+-[a-z0-9-]+'] }],
    // A few bound custom properties (e.g. image max widths) are set as inline styles.
    'no-inline-style': 'off',
    // Angular and its critical-CSS inliner write `crossorigin=""`, `novalidate=""` and
    // `type="text/javascript"`; all valid HTML.
    'attribute-empty-style': 'off',
    'attribute-boolean-style': 'off',
    'script-type': 'off',
    // Phone links are kept on one line by CSS (base.css) instead of rewriting the site's numbers.
    'tel-non-breaking': 'off',
    // The desktop nav and the mobile menu's nav share a name but are never visible together; axe
    // checks landmark uniqueness on the rendered page at each viewport (e2e).
    'unique-landmark': 'off',
  },
};

export async function verifyDist(
  options: { contentDir?: string; distDir?: string; microcopy?: string } = {},
): Promise<DistReport> {
  const contentDir = options.contentDir ?? CONTENT_DIR;
  const distDir = options.distDir ?? path.join(ROOT, 'dist/compass-portal');
  const browser = path.join(distDir, 'browser');
  const content = await loadContent(contentDir, options.microcopy ?? MICROCOPY);
  // Both languages' microcopy: a page also names the other language in its language switch.
  const arabic = JSON.parse(await readFile(MICROCOPY_AR, 'utf8')) as Record<string, string>;
  const copy = {
    ...content.copy,
    ...Object.fromEntries(Object.entries(arabic).map(([key, value]) => [`ar:${key}`, value])),
  };
  const errors: DistReport['errors'] = {
    parity: [],
    provenance: [],
    links: [],
    sitemap: [],
    html: [],
  };
  const anomalies: string[] = [];
  const validator = new HtmlValidate(HTML_VALIDATE_CONFIG);

  const pages = [
    ...content.routes.map((route) => ({
      label: route.path,
      file: path.join(browser, route.path, 'index.html'),
      url: new URL(route.path, content.site.origin),
      page: content.pages.get(route.id),
    })),
    {
      label: '404',
      file: path.join(browser, '404.html'),
      url: new URL('/404.html', content.site.origin),
      page: undefined,
    },
  ];
  const ids = new Map<string, Set<string>>();
  const idsOf = async (file: string) => {
    if (!ids.has(file)) {
      const $ = load(await readFile(file, 'utf8'));
      ids.set(
        file,
        new Set(
          $('[id]')
            .map((_, el) => $(el).attr('id')!)
            .get(),
        ),
      );
    }
    return ids.get(file)!;
  };
  const indexable: string[] = [];

  for (const { label, file, url, page } of pages) {
    const html = await readFile(file, 'utf8');
    const $ = load(html);

    // Parity: the snapshot's sentences and images are all on the page.
    if (page) {
      const text = comparable(htmlBlockText($('main').html() ?? ''));
      for (const sentence of sentences(docText(page))) {
        if (!text.includes(sentence)) errors.parity.push(`${label}: missing "${sentence}"`);
      }
      for (const id of Object.keys(page.media)) {
        if (!html.includes(`/media/${id}`))
          errors.parity.push(`${label}: image ${id} is not shown`);
      }
      // Untranslated Arabic pages name the English page as canonical: only that one is listed.
      if (!/noindex/.test($('meta[name="robots"]').attr('content') ?? '') && !page.seo.canonical)
        indexable.push(url.href);
    }

    // Provenance: nothing that isn't the site's text or reviewed microcopy.
    const allowed = allowedText(content.site, page, copy);
    for (const { where, text } of pageTexts($)) {
      if (!isAllowed(text, allowed)) errors.provenance.push(`${label} ${where}: "${text}"`);
    }

    // Links and assets.
    const fromContent = page ? contentHrefs(page) : new Set<string>();
    for (const href of contentHrefs(content.site)) fromContent.add(href);
    const refs: { attr: string; value: string }[] = [];
    $('a[href], link[href]').each(
      (_, el) => void refs.push({ attr: el.tagName, value: $(el).attr('href')! }),
    );
    $('img[src], script[src], iframe[src], source[src]').each(
      (_, el) => void refs.push({ attr: el.tagName, value: $(el).attr('src')! }),
    );
    $('img[srcset], source[srcset]').each((_, el) => {
      for (const candidate of $(el).attr('srcset')!.split(',')) {
        refs.push({ attr: `${el.tagName}[srcset]`, value: candidate.trim().split(/\s+/)[0]! });
      }
    });
    $('meta[property="og:image"], meta[name="twitter:image"]').each(
      (_, el) => void refs.push({ attr: 'og:image', value: $(el).attr('content')! }),
    );
    // Relative URLs resolve against <base href>, which is "/" on every page.
    const base = new URL($('base').attr('href') ?? '', url);
    for (const { attr, value } of refs) {
      if (/^(?:mailto|tel|data):/i.test(value)) continue;
      if (value.startsWith('#') && base.pathname !== url.pathname) {
        errors.links.push(
          `${label}: ${attr} ${value} resolves against <base href> to another page`,
        );
        continue;
      }
      const target = new URL(value, base);
      if (target.origin !== url.origin) continue;
      const pathname = decodeURIComponent(target.pathname);
      const local = path.join(browser, pathname);
      const resolved = pathname.endsWith('/') ? path.join(local, 'index.html') : local;
      const report = (problem: string) =>
        attr === 'a' && fromContent.has(value)
          ? anomalies.push(`${label}: the site links to ${value}, ${problem}`)
          : errors.links.push(`${label}: ${attr} ${value} ${problem}`);
      if (await isFile(resolved)) {
        if (target.hash && resolved.endsWith('.html')) {
          const id = decodeURIComponent(target.hash.slice(1));
          if (!(await idsOf(resolved)).has(id)) report(`has no #${id} there`);
        }
      } else if (await isDir(local)) {
        report('lacks the trailing slash (a redirect hop)');
      } else {
        report('does not exist in the build');
      }
    }

    // Texture classes paint through a mask, so on anything with content they would hide it.
    $('[class*="texture-contours"]').each((_, el) => {
      if ($(el).children().length || $(el).text().trim() || $(el).attr('aria-hidden') !== 'true') {
        errors.html.push(`${label}: .${$(el).attr('class')} must be an empty aria-hidden layer`);
      }
    });

    // HTML validity.
    const result = await validator.validateString(html, file);
    for (const message of result.results.flatMap((r) => r.messages)) {
      errors.html.push(
        `${label}:${message.line}:${message.column} ${message.ruleId}: ${message.message}`,
      );
    }
  }

  // The sitemap lists exactly the indexable pages.
  const sitemap = await readFile(path.join(browser, 'sitemap.xml'), 'utf8');
  const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    m[1]!.replace(/&amp;/g, '&'),
  );
  for (const url of indexable)
    if (!listed.includes(url)) errors.sitemap.push(`${url} is not in sitemap.xml`);
  for (const url of listed)
    if (!indexable.includes(url)) errors.sitemap.push(`${url} is listed but not an indexable page`);

  return { pages: pages.length, errors, anomalies };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const flag = (name: string) =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const content = flag('content');
  const dist = flag('dist');
  const report = await verifyDist({
    ...(content ? { contentDir: path.resolve(ROOT, content) } : {}),
    ...(dist ? { distDir: path.resolve(ROOT, dist) } : {}),
  });
  let failed = false;
  for (const [check, problems] of Object.entries(report.errors)) {
    if (!problems.length) {
      console.error(`[verify:dist] ${check}: ok`);
      continue;
    }
    failed = true;
    console.error(`[verify:dist] ${check}: ${problems.length} problem(s)`);
    for (const problem of problems.slice(0, 50)) console.error(`  - ${problem}`);
    if (problems.length > 50) console.error(`  … and ${problems.length - 50} more`);
  }
  if (report.anomalies.length) {
    console.error(
      `[verify:dist] content anomalies to review (not failing): ${report.anomalies.length}`,
    );
    for (const anomaly of report.anomalies) console.error(`  - ${anomaly}`);
  }
  console.error(`[verify:dist] ${report.pages} pages checked`);
  if (failed) process.exit(1);
}
