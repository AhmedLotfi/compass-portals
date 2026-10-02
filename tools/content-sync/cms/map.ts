/**
 * Maps the compassint.org CMS (api.ts) to the portal's pages, in English or Arabic. Every text
 * comes verbatim from an API field, or from the live front end's rendered pages (labels such as
 * "Our Team", checked by `RenderedSite.label`). Nothing is rewritten: only grouped into hero,
 * sections and blocks.
 *
 * Arabic: each field uses its `*Ar` value when that really is Arabic, else the English value,
 * marked as English (rich text is wrapped in `lang="en" dir="ltr"`; plain strings are marked by the
 * app). The old front end has no Arabic interface text, so its labels come from `labels.ar.json`,
 * a hand-written draft for review. Nothing is machine-translated.
 */
import { load } from 'cheerio';
import type { Block, LinkKind, PageKind, Section } from '../../../schema/content.ts';
import { catalogIcon } from '../../../schema/icons.ts';
import { normalizeSpace } from '../analyze.ts';
import type { MediaRegistry } from '../media.ts';
import { toAtoms } from '../normalize/atoms.ts';
import { cleanContent } from '../normalize/clean.ts';
import { escapeHtml, sanitizeRich, type LinkResolver } from '../normalize/sanitize.ts';
import { blockText, htmlBlockText } from '../normalize/sentences.ts';
import { shapePage } from '../normalize/shape.ts';
import type { PageDraft } from '../page.ts';
import {
  collapseSlashes,
  ordered,
  type CmsContent,
  type LandingFeature,
  type LandingLine,
  type PageDetail,
  type WebPage,
} from './api.ts';
import arLabels from './labels.ar.json' with { type: 'json' };
import type { RenderedSite } from './rendered.ts';

export type Lang = 'en' | 'ar';

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** Whether a text has Arabic letters (a `*Ar` field that only copies the English has none). */
export function hasArabic(value: string | null | undefined): boolean {
  return ARABIC.test(value ?? '');
}

/** The value of a field pair for a language, and whether it is the English fallback. */
export function pick(
  lang: Lang,
  en: string | null | undefined,
  ar: string | null | undefined,
): { value: string; english: boolean } {
  if (lang === 'ar' && hasArabic(ar)) return { value: ar ?? '', english: false };
  return { value: en ?? '', english: lang === 'ar' };
}

/** The Arabic for a label the old front end prints in English (draft for review). */
export function arLabel(label: string): string {
  const value = (arLabels as Record<string, string>)[label];
  if (!value) throw new Error(`labels.ar.json has no Arabic for "${label}"`);
  return value;
}

/** A path in a language's tree: `/products/` → `/ar/products/`. */
export function localPath(lang: Lang, path: string): string {
  return lang === 'en' ? path : `/${lang}${path}`;
}

/** A page id in a language's tree: `products--erp` → `ar--products--erp`. */
export function localId(lang: Lang, id: string): string {
  return lang === 'en' ? id : `${lang}--${id}`;
}

/** The site's sections by CMS id, with their new path, the old URL prefixes, and page kinds. */
export const SECTIONS = [
  { cmsId: 31, key: 'about', path: '/about/', old: [], index: 'page', detail: 'page' },
  {
    cmsId: 1,
    key: 'products',
    path: '/products/',
    old: ['/products/', '/solution/'],
    oldIndex: ['/solutions'],
    index: 'product-index',
    detail: 'product',
  },
  {
    cmsId: 2,
    key: 'services',
    path: '/services/',
    old: ['/services/', '/service/'],
    oldIndex: ['/services'],
    index: 'service-index',
    detail: 'service',
  },
  {
    cmsId: 15,
    key: 'features',
    path: '/features/',
    old: ['/features/'],
    oldIndex: ['/features'],
    index: 'product-category',
    detail: 'page',
  },
  {
    cmsId: 16,
    key: 'industries',
    path: '/industries/',
    old: ['/industries/'],
    oldIndex: ['/industries'],
    index: 'product-category',
    detail: 'page',
  },
  // The old front end has /blog routes for this section; the CMS publishes it only when it has
  // posts (it had none when the site was archived), so the section is optional.
  {
    cmsId: 17,
    key: 'blog',
    path: '/blog/',
    old: ['/blog/'],
    oldIndex: ['/blog'],
    index: 'page',
    detail: 'post',
    optional: true,
  },
] as const satisfies readonly {
  cmsId: number;
  key: string;
  path: string;
  old: readonly string[];
  oldIndex?: readonly string[];
  index: PageKind;
  detail: PageKind;
  optional?: boolean;
}[];

/** Sections whose cards carry the old front end's catalog icon. */
const ICON_SECTIONS: readonly SectionSpec['key'][] = ['products', 'industries'];

export type SectionSpec = (typeof SECTIONS)[number];

/** A page of the new site, before media and breadcrumbs are attached. */
export interface CmsPage {
  doc: PageDraft;
  lang: Lang;
  /** The language-neutral id (the English page's id), pairing a page with its translation. */
  key: string;
  /** Arabic pages: whether any of its CMS text really is Arabic (else it only repeats English). */
  translated: boolean;
  parentId: string | null;
  order: number;
  /** Old paths that showed this page (decoded, exact). */
  oldPaths: string[];
  /** Old path prefixes: the old site appended a per-visit ciphertext segment to these. */
  oldPrefixes: string[];
  modified?: string;
  /** The old front end's catalog icon for the page (products and industries). */
  icon?: string;
  /** Every API text the page is meant to show, one block per line: the coverage reference. */
  sourceText: string;
}

/** `HR & Payroll` → `hr-payroll`; `Non- Profit Organizations` → `non-profit-organizations`. */
export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The old front end's slug: the raw English title, lower-cased, spaces as underscores. */
export function oldSlug(title: string): string {
  return title.toLowerCase().replace(/ /g, '_');
}

const text = (value: string | null | undefined) => (value ?? '').trim();
const plain = (html: string | null | undefined) =>
  normalizeSpace(htmlBlockText(html ?? '').replace(/\n+/g, ' '));

/** The first sentence of a text, for compact cards (the old home page shows the same). */
export function firstSentence(value: string): string {
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  for (const { segment } of segmenter.segment(value)) {
    const sentence = segment.trim();
    if (sentence) return sentence;
  }
  return value;
}

export interface MapContext {
  cms: CmsContent;
  rendered: RenderedSite;
  media: MediaRegistry;
  resolve: LinkResolver;
  /** Origin of the old site, for source URLs. */
  source: string;
  lang: Lang;
}

interface Lede {
  lede?: string;
  /** The description's further paragraphs, when it has more than one. */
  rest?: string;
}

/** Rich text that is English on an Arabic page: marked so it is read and laid out as English. */
export function markEnglish(html: string): string {
  return html ? `<div lang="en" dir="ltr">${html}</div>` : html;
}

/** A description as hero lede (its first paragraph) and the rest as rich text. */
function splitLede(html: string, resolve: LinkResolver, english = false): Lede {
  const clean = sanitizeRich(html, resolve);
  if (!clean) return {};
  const $ = load(`<div id="r">${clean}</div>`);
  const first = $('#r').children().first();
  if (!first.is('p') || !normalizeSpace(first.text()))
    return { rest: english ? markEnglish(clean) : clean };
  const lede = normalizeSpace(first.text());
  first.remove();
  const rest = ($('#r').html() ?? '').trim();
  return { lede, ...(rest ? { rest: english ? markEnglish(rest) : rest } : {}) };
}

class Mapper {
  readonly pages: CmsPage[] = [];
  private readonly sectionIds = new Map<string, Set<string>>();
  /** Arabic values used since the last `add`: whether the page has any real Arabic. */
  private arabicUsed = 0;

  private readonly ctx: MapContext;
  readonly lang: Lang;
  /** Links in CMS text, pointed into this language's tree. */
  readonly resolve: LinkResolver;

  constructor(ctx: MapContext) {
    this.ctx = ctx;
    this.lang = ctx.lang;
    this.resolve = (href) => {
      const target = ctx.resolve(href);
      return target.kind === 'internal' && target.href.startsWith('/')
        ? { ...target, href: localPath(this.lang, target.href) }
        : target;
    };
  }

  /** The raw value of a field pair for this language (for coverage and further shaping). */
  raw(en: string | null | undefined, ar: string | null | undefined): string {
    const picked = pick(this.lang, en, ar);
    if (this.lang === 'ar' && !picked.english && picked.value.trim()) this.arabicUsed++;
    return picked.value;
  }

  /** A plain-text field, trimmed. */
  t(en: string | null | undefined, ar?: string | null): string {
    return text(this.raw(en, ar));
  }

  /** A rich-text field, sanitized; English on an Arabic page is marked as English. */
  h(en: string | null | undefined, ar?: string | null): string {
    const english = this.lang === 'ar' && !hasArabic(ar);
    const html = sanitizeRich(this.raw(en, ar), this.resolve);
    return english ? markEnglish(html) : html;
  }

  /** Sanitized HTML the mapper built from plain text (already in this page's language or not). */
  wrap(html: string, english: boolean): string {
    return this.lang === 'ar' && english ? markEnglish(html) : html;
  }

  /** A description split into lede and rich text. */
  lede(en: string | null | undefined, ar?: string | null): Lede {
    const english = this.lang === 'ar' && !hasArabic(ar);
    return splitLede(this.raw(en, ar), this.resolve, english);
  }

  /** A label the old front end prints: verified on the rendered page, then in this language. */
  async label(path: string, label: string, options?: { prefix?: boolean }): Promise<string> {
    await this.ctx.rendered.label(path, label, options);
    return this.lang === 'ar' ? arLabel(label) : label;
  }

  path(path: string): string {
    return localPath(this.lang, path);
  }

  id(id: string): string {
    return localId(this.lang, id);
  }

  /** Registers an image (trying the CMS's doubled-slash spelling too); its alt is the site's. */
  image(url: string | null | undefined, alt: string, pageId: string): string | undefined {
    const src = text(url);
    if (!src || src.startsWith('data:') || !/^https?:/.test(src)) return undefined;
    // The CMS doubles some slashes, and names some images on its plain-HTTP host, which the
    // fetch stage downloads over HTTPS when it can.
    const https = src.replace(/^http:/, 'https:');
    const candidates = [src, collapseSlashes(src), https, collapseSlashes(https)];
    const found = candidates.find((candidate) => this.ctx.media.hrefFor(candidate));
    return this.ctx.media.register(
      { src: found ?? src, alt },
      { id: pageId, url: this.ctx.source },
    );
  }

  rich(html: string | null | undefined): string {
    return sanitizeRich(html ?? '', this.ctx.resolve);
  }

  sectionId(pageId: string, title: string): string {
    const used = this.sectionIds.get(pageId) ?? new Set<string>();
    this.sectionIds.set(pageId, used);
    const base = slugify(title) || 'section';
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  }

  section(pageId: string, title: string | undefined, blocks: Block[]): Section | undefined {
    const kept = blocks.filter(Boolean);
    if (!kept.length) return undefined;
    return {
      id: this.sectionId(pageId, title ?? 'section'),
      ...(title ? { title } : {}),
      blocks: kept,
    };
  }

  /** A landing line: its own section with its picture and text. */
  line(pageId: string, line: LandingLine): Section | undefined {
    const title = this.t(line.titleEn, line.titleAr);
    const html = this.h(line.descriptionEn, line.descriptionAr);
    const media = this.image(line.imageUrl, title, pageId);
    return this.section(pageId, title || undefined, [
      ...(media ? [{ type: 'media', media } as const] : []),
      ...(html ? [{ type: 'richText', html } as const] : []),
    ]);
  }

  features(pageId: string, title: string, items: LandingFeature[]): Section | undefined {
    const active = ordered(items);
    if (!active.length) return undefined;
    return this.section(pageId, title, [
      {
        type: 'featureList',
        items: active.map((item) => ({
          title: this.t(item.titleEn, item.titleAr),
          html: this.h(item.descriptionEn, item.descriptionAr),
        })),
      },
    ]);
  }

  /** Adds a page of this language; `doc.id`, paths and the parent are given language-neutral. */
  add(page: Omit<CmsPage, 'lang' | 'key' | 'translated'>): void {
    const key = page.doc.id;
    this.pages.push({
      ...page,
      lang: this.lang,
      key,
      translated: this.lang === 'ar' && this.arabicUsed > 0,
      parentId: page.parentId === null ? null : this.id(page.parentId),
      doc: { ...page.doc, id: this.id(key), path: this.path(page.doc.path) },
      // Old URLs belong to the English pages (the old site had no Arabic URLs).
      oldPaths: this.lang === 'en' ? page.oldPaths : [],
      oldPrefixes: this.lang === 'en' ? page.oldPrefixes : [],
    });
    this.arabicUsed = 0;
  }
}

function sourceOf(...parts: (string | null | undefined)[]): string {
  return parts
    .map((part) => (part && /</.test(part) ? htmlBlockText(part) : (part ?? '')))
    .join('\n');
}

const latest = (...times: (string | null | undefined)[]) =>
  times
    .filter((t): t is string => Boolean(t))
    .sort()
    .at(-1);

export async function mapSite(ctx: MapContext): Promise<CmsPage[]> {
  const { cms } = ctx;
  const m = new Mapper(ctx);
  const sections = new Map(cms.pages.map((page) => [page.id, page]));
  const sectionOf = (spec: SectionSpec): WebPage => {
    const page = sections.get(spec.cmsId);
    if (!page) throw new Error(`The CMS has no ${spec.key} section (id ${spec.cmsId})`);
    return page;
  };
  /** The sections the CMS publishes (an optional section may have no record yet). */
  const published = SECTIONS.filter(
    (spec) => !('optional' in spec && spec.optional) || sections.has(spec.cmsId),
  );
  const detailPath = (spec: SectionSpec, detail: PageDetail) =>
    `${spec.path}${slugify(text(detail.titleEn))}/`;
  const detailId = (spec: SectionSpec, detail: PageDetail) =>
    `${spec.key}--${slugify(text(detail.titleEn))}`;

  // Section index pages and their detail pages.
  // Labels the old product pages print around the CMS data.
  const features = await m.label('/solution/', 'Features', { prefix: true });
  const requestDemo = await m.label('/solution/', 'Request Your Demo', { prefix: true });
  const demoCta = (): Block => ({
    type: 'cta',
    label: requestDemo,
    href: m.path('/contact/'),
    kind: 'internal',
  });

  for (const spec of published) {
    if (spec.key === 'about') continue;
    const section = sectionOf(spec);
    const indexId = spec.key;
    const sectionTitle = m.t(section.titleEn, section.titleAr);
    const { lede, rest } = m.lede(section.descriptionEn, section.descriptionAr);
    const heroMedia = m.image(section.imageUrl, sectionTitle, m.id(indexId));
    const indexSource = sourceOf(
      m.raw(section.titleEn, section.titleAr),
      m.raw(section.descriptionEn, section.descriptionAr),
    );
    m.add({
      doc: {
        id: indexId,
        kind: spec.index,
        path: spec.path,
        title: sectionTitle,
        sourceUrl: `${ctx.source}${spec.oldIndex[0]}`,
        seo: {},
        hero: {
          title: sectionTitle,
          ...(lede ? { lede } : {}),
          ...(heroMedia ? { media: heroMedia } : {}),
          ctas: [],
        },
        sections: rest ? [{ id: 'introduction', blocks: [{ type: 'richText', html: rest }] }] : [],
      },
      parentId: 'home',
      order: section.order ?? 0,
      oldPaths: [...spec.oldIndex],
      oldPrefixes: [],
      ...(latest(section.lastModificationTime, section.creationTime)
        ? { modified: latest(section.lastModificationTime, section.creationTime)! }
        : {}),
      sourceText: indexSource,
    });

    for (const detail of ordered(section.webPageDetails)) {
      const id = detailId(spec, detail);
      const title = m.t(detail.titleEn, detail.titleAr);
      const split = m.lede(detail.descriptionEn, detail.descriptionAr);
      const media = m.image(detail.imageUrl, title, m.id(id));
      const body: Section[] = [];
      if (split.rest)
        body.push({ id: 'introduction', blocks: [{ type: 'richText', html: split.rest }] });
      if (detail.showlines) {
        for (const line of ordered(detail.webPageLandingLines)) {
          const s = m.line(m.id(id), line);
          // The CMS sometimes reuses the page's picture for its first line: show it once.
          if (s && media)
            s.blocks = s.blocks.filter((b) => !(b.type === 'media' && b.media === media));
          if (s) body.push(s);
        }
      }
      if (detail.showFeatures) {
        const list = m.features(m.id(id), features, detail.webPageLandingFeatures);
        if (list) body.push(list);
      }
      if (detail.videoUrl) {
        body.push({
          id: 'video',
          blocks: [
            {
              type: 'embed',
              provider: /youtu\.?be/.test(detail.videoUrl) ? 'youtube' : 'other',
              url: detail.videoUrl,
              title: text(detail.videoTitle) || title,
            },
          ],
        });
      }
      // The old product and feature pages end with a demo request (the old /request-demo page
      // wasn't archived; it leads to the contact page).
      if (spec.key === 'products' || spec.key === 'features')
        body.push({ id: 'request-demo', blocks: [demoCta()] });
      // From the raw title: the old front end kept trailing spaces (`/industries/government_/…`).
      const slug = oldSlug(detail.titleEn ?? '');
      const activeLines = detail.showlines ? ordered(detail.webPageLandingLines) : [];
      const activeFeatures = detail.showFeatures ? ordered(detail.webPageLandingFeatures) : [];
      const detailSource = sourceOf(
        m.raw(detail.titleEn, detail.titleAr),
        m.raw(detail.descriptionEn, detail.descriptionAr),
        ...activeLines.flatMap((l) => [
          m.raw(l.titleEn, l.titleAr),
          m.raw(l.descriptionEn, l.descriptionAr),
        ]),
        ...activeFeatures.flatMap((f) => [
          m.raw(f.titleEn, f.titleAr),
          m.raw(f.descriptionEn, f.descriptionAr),
        ]),
      );
      m.add({
        doc: {
          id,
          kind: spec.detail,
          path: detailPath(spec, detail),
          title,
          sourceUrl: `${ctx.source}${spec.old[0]}${encodeURIComponent(slug)}`,
          seo: {},
          hero: {
            title,
            ...(split.lede ? { lede: split.lede } : {}),
            ...(media ? { media } : {}),
            ctas: [],
          },
          sections: body,
        },
        parentId: indexId,
        order: detail.order ?? 0,
        ...(ICON_SECTIONS.includes(spec.key) ? { icon: catalogIcon(text(detail.titleEn)) } : {}),
        oldPaths: spec.old.map((prefix) => `${prefix}${slug}`),
        oldPrefixes: spec.old.map((prefix) => `${prefix}${slug}/`),
        ...(latest(detail.lastModificationTime, detail.creationTime)
          ? { modified: latest(detail.lastModificationTime, detail.creationTime)! }
          : {}),
        sourceText: detailSource,
      });
    }
  }

  // About: the section's own lines, the team, and the careers list the front end shows.
  {
    const spec = SECTIONS[0];
    const section = sectionOf(spec);
    const detail = ordered(section.webPageDetails)[0];
    const lines = detail?.showlines ? ordered(detail.webPageLandingLines) : [];
    const body: Section[] = [];
    const [first, ...others] = lines;
    const aboutId = m.id('about');
    if (first) {
      const s = m.line(aboutId, first);
      if (s) body.push(s);
    }
    const team = ordered(cms.team, (member) => Number(member.orderNumber ?? 0));
    if (team.length) {
      const s = m.section(aboutId, await m.label('/about', 'Our Team'), [
        {
          type: 'moduleGrid',
          items: team.map((member) => {
            const name = m.t(member.nameEN, member.nameAR);
            const media = m.image(member.imageUrl, name, aboutId);
            const job = m.t(member.jobEN, member.jobAR);
            return {
              title: name,
              ...(job
                ? { html: m.wrap(`<p>${escapeHtml(job)}</p>`, !hasArabic(member.jobAR)) }
                : {}),
              ...(media ? { media } : {}),
            };
          }),
        },
      ]);
      if (s) body.push(s);
    }
    for (const line of others) {
      const s = m.line(aboutId, line);
      if (s) body.push(s);
    }
    const careers = detail?.showFeatures
      ? m.features(aboutId, await m.label('/about', 'Our Careers'), detail.webPageLandingFeatures)
      : undefined;
    if (careers) body.push(careers);
    const aboutTitle = m.t(section.titleEn, section.titleAr);
    const aboutLede = plain(m.raw(section.descriptionEn, section.descriptionAr));
    const aboutSource = sourceOf(
      m.raw(section.titleEn, section.titleAr),
      m.raw(section.descriptionEn, section.descriptionAr),
      ...lines.flatMap((l) => [
        m.raw(l.titleEn, l.titleAr),
        m.raw(l.descriptionEn, l.descriptionAr),
      ]),
      ...team.flatMap((t) => [m.raw(t.nameEN, t.nameAR), m.raw(t.jobEN, t.jobAR)]),
      ...(detail?.showFeatures
        ? ordered(detail.webPageLandingFeatures).flatMap((f) => [
            m.raw(f.titleEn, f.titleAr),
            m.raw(f.descriptionEn, f.descriptionAr),
          ])
        : []),
    );
    m.add({
      doc: {
        id: 'about',
        kind: 'page',
        path: spec.path,
        title: aboutTitle,
        sourceUrl: `${ctx.source}/about`,
        seo: {},
        hero: {
          title: aboutTitle,
          ...(aboutLede ? { lede: aboutLede } : {}),
          ctas: [],
        },
        sections: body,
      },
      parentId: 'home',
      order: section.order ?? 0,
      oldPaths: ['/about', '/about-us'],
      oldPrefixes: [],
      ...(latest(section.lastModificationTime, detail?.lastModificationTime)
        ? { modified: latest(section.lastModificationTime, detail?.lastModificationTime)! }
        : {}),
      sourceText: aboutSource,
    });
  }

  await mapHome(ctx, m, published, sectionOf, (spec, detail) =>
    m.path(detailPath(spec, detail)),
  );
  await mapStatic(ctx, m);
  return m.pages;
}

/** Card for a detail page, as the old home page lists them: title, first sentence, link. */
function card(
  m: Mapper,
  detail: PageDetail,
  href: string,
  linkLabel: string | undefined,
  icon = false,
): Extract<Block, { type: 'moduleGrid' }>['items'][number] {
  const summary = plain(m.raw(detail.descriptionEn, detail.descriptionAr));
  return {
    title: m.t(detail.titleEn, detail.titleAr),
    ...(icon ? { icon: catalogIcon(text(detail.titleEn)) } : {}),
    ...(summary
      ? {
          html: m.wrap(
            `<p>${escapeHtml(firstSentence(summary))}</p>`,
            !hasArabic(detail.descriptionAr),
          ),
        }
      : {}),
    href,
    ...(linkLabel ? { linkLabel } : {}),
  };
}

async function mapHome(
  ctx: MapContext,
  m: Mapper,
  published: readonly SectionSpec[],
  sectionOf: (spec: SectionSpec) => WebPage,
  detailPath: (spec: SectionSpec, detail: PageDetail) => string,
): Promise<void> {
  const { cms } = ctx;
  const label = (value: string) => m.label('/', value);
  const homeId = m.id('home');
  const body: Section[] = [];
  const sources: (string | null | undefined)[] = [];

  // The hero carousel: in the order the API returns them, as the old home page shows them (not
  // by their `order`). Each slide has a desktop picture and a phone-sized one.
  const slides = cms.slides
    .filter((slide) => slide.isActive)
    .map((slide) => {
      const title = m.t(slide.titleEn, slide.titleAr);
      const lede = m.t(slide.detailsEn, slide.detailsAr);
      const media = m.image(slide.imageImagePath, title, homeId);
      const mobileMedia = m.image(slide.mobileImagePath, title, homeId);
      return {
        title,
        ...(lede ? { lede } : {}),
        ...(media ? { media } : {}),
        // The CMS often holds the same file under both names: then there is no phone variant.
        ...(mobileMedia && mobileMedia !== media ? { mobileMedia } : {}),
      };
    });
  const [lead] = slides;
  if (!lead) throw new Error('The CMS has no home slides');
  sources.push(
    ...cms.slides
      .filter((slide) => slide.isActive)
      .flatMap((s) => [m.raw(s.titleEn, s.titleAr), m.raw(s.detailsEn, s.detailsAr)]),
  );

  for (const slogan of ordered(cms.slogans.map((s) => ({ ...s, order: 0 })))) {
    // The slogan title is styled HTML; its text is "Right Application. Right Direction".
    const title = plain(m.raw(slogan.titleEn, slogan.titleAr));
    const html = m.h(slogan.contentEn, slogan.contentAr);
    const s = m.section(homeId, title || undefined, html ? [{ type: 'richText', html }] : []);
    if (s) body.push(s);
    sources.push(m.raw(slogan.titleEn, slogan.titleAr), m.raw(slogan.contentEn, slogan.contentAr));
  }

  const linkLabels: Record<string, string | undefined> = {
    products: await label('Explore product'),
    services: await label('Explore this service'),
    features: await label('Learn more'),
    industries: undefined,
  };
  // The old home page lists products, services, features and industries (not the blog).
  for (const spec of published.filter((s) => s.key in linkLabels)) {
    const section = sectionOf(spec);
    const details = ordered(section.webPageDetails);
    const s = m.section(homeId, await label(text(section.titleEn)), [
      {
        type: 'moduleGrid',
        items: details.map((detail) =>
          card(
            m,
            detail,
            detailPath(spec, detail),
            linkLabels[spec.key],
            ICON_SECTIONS.includes(spec.key),
          ),
        ),
      },
    ]);
    if (s) body.push(s);
  }

  // The old front end illustrates a story that has no CMS picture with its own drawing
  // (assets/compass/business-apps.svg): the picture under the story's heading on the rendered page.
  const home = await ctx.rendered.page('/');
  const storyPicture = (title: string): string | undefined => {
    const story = home.$('.home-story')
      .toArray()
      .find((el) => normalizeSpace(home.$(el).find('h2').first().text()) === title);
    const src = story ? home.$(story).find('img[src]').first().attr('src') : undefined;
    if (!src || src.startsWith('data:')) return undefined;
    return ctx.media.register({ src, alt: title }, { id: homeId, url: home.url });
  };
  for (const line of ordered(cms.sloganLines.map((l) => ({ ...l, order: 0 })))) {
    const title = m.t(line.titleEn, line.titleAr);
    const media =
      m.image(line.imageUrl, title, homeId) ?? storyPicture(text(line.titleEn) || title);
    // The old front end shows the title, picture and description, not the `message` field
    // ("Try it free for 30 Days…", "m"), so neither does this page.
    const html = m.h(line.descriptionEn, line.descriptionAr);
    const s = m.section(homeId, title || undefined, [
      ...(media ? [{ type: 'media', media } as const] : []),
      ...(html ? [{ type: 'richText', html } as const] : []),
    ]);
    if (s) body.push(s);
    sources.push(m.raw(line.titleEn, line.titleAr), m.raw(line.descriptionEn, line.descriptionAr));
  }

  // The old front end's alt text for every client logo.
  const clientAlt = 'Client logo';
  const clients = ordered(cms.clients)
    .map((client) => m.image(client.imageImagePath, clientAlt, homeId))
    .filter((id): id is string => Boolean(id));
  if (clients.length) {
    const s = m.section(homeId, await label('Our Clients'), [
      { type: 'gallery', variant: 'logos', items: clients.map((media) => ({ media })) },
    ]);
    if (s) body.push(s);
  }

  const feedback = ordered(cms.feedback);
  if (feedback.length) {
    const s = m.section(
      homeId,
      await label('Our Client Feedbacks'),
      feedback.map((item) => {
        const name = m.t(item.nameEn, item.nameAr);
        const media = m.image(item.imageUrl, name, homeId);
        const role = [
          m.t(item.positionNameEn, item.positionNameAr),
          m.t(item.companyNameEn, item.companyNameAr),
        ].filter(Boolean);
        return {
          type: 'quote',
          html: m.wrap(
            `<p>${escapeHtml(m.t(item.messageEn, item.messageAr))}</p>`,
            !hasArabic(item.messageAr),
          ),
          ...(name ? { cite: name } : {}),
          ...(role.length ? { role } : {}),
          ...(media ? { media } : {}),
        } satisfies Block;
      }),
    );
    if (s) body.push(s);
    sources.push(
      ...feedback.flatMap((f) => [
        m.raw(f.nameEn, f.nameAr),
        m.raw(f.positionNameEn, f.positionNameAr),
        m.raw(f.companyNameEn, f.companyNameAr),
        m.raw(f.messageEn, f.messageAr),
      ]),
    );
  }

  const partners = ordered(cms.partners);
  if (partners.length) {
    const s = m.section(homeId, await label('Partners'), [
      {
        type: 'gallery',
        variant: 'logos',
        items: partners
          .map((partner) => m.image(partner.imageImagePath, text(partner.clientName), homeId))
          .filter((id): id is string => Boolean(id))
          .map((media) => ({ media, href: m.path('/partners/') })),
      },
    ]);
    if (s && s.blocks.some((b) => b.type === 'gallery' && b.items.length)) body.push(s);
  }

  const contact = await label('Talk to our team');
  const explore = await label('Explore our solutions');
  m.add({
    doc: {
      id: 'home',
      kind: 'home',
      path: '/',
      title: lead.title,
      sourceUrl: `${ctx.source}/`,
      seo: {},
      hero: {
        title: lead.title,
        ...(lead.lede ? { lede: lead.lede } : {}),
        ...(lead.media ? { media: lead.media } : {}),
        ctas: [
          { label: contact, href: m.path('/contact/'), kind: 'internal' satisfies LinkKind },
          { label: explore, href: m.path('/products/'), kind: 'internal' satisfies LinkKind },
        ],
        slides,
      },
      sections: body,
    },
    parentId: null,
    order: 0,
    oldPaths: ['/home'],
    oldPrefixes: [],
    sourceText: sourceOf(...sources),
  });
}

/** Contact, FAQs, partners and the privacy policy. */
async function mapStatic(ctx: MapContext, m: Mapper): Promise<void> {
  const { cms, rendered } = ctx;
  // Front-end labels: verified on the rendered page, then in this language.
  const local = (label: string) => (m.lang === 'ar' ? arLabel(label) : label);

  // Contact: the form as the site labels it, then each office.
  const contactPage = await rendered.page('/contact');
  const $ = contactPage.$;
  const form = $('app-contact-us-form form').first();
  const fields = form
    .find('input, textarea, select')
    .toArray()
    .map((el) => {
      const $el = $(el);
      const id = $el.attr('id');
      const labelEl = id ? form.find(`label[for="${id}"]`) : $el.closest('label');
      const label = normalizeSpace(labelEl.clone().children().remove().end().text());
      const type = el.tagName === 'textarea' ? 'textarea' : ($el.attr('type') ?? 'text');
      return {
        name: $el.attr('formcontrolname') ?? $el.attr('name') ?? slugify(label),
        label: label ? local(label) : label,
        kind: (['email', 'tel', 'textarea'].includes(type) ? type : 'text') as
          'text' | 'email' | 'tel' | 'textarea',
        required: $el.is('[required]') || /\*/.test(labelEl.text()),
      };
    })
    .filter((field) => field.label);
  const submitText = normalizeSpace(
    form.find('button[type="submit"]').clone().find('[aria-hidden="true"]').remove().end().text(),
  );
  const submitLabel = submitText ? local(submitText) : '';
  // In the API's order, as the old contact page lists them (UAE, then Canada).
  const offices = cms.offices.filter((office) => office.isActive);
  const officeBlocks: Block[] = [];
  for (const office of offices) {
    const lines: string[] = [];
    if (text(office.address)) lines.push(`<p>${escapeHtml(text(office.address))}</p>`);
    for (const raw of [office.phoneNumber, office.mobileNumber, office.whatsappNumber]) {
      const value = text(raw);
      if (!value) continue;
      // Verbatim "Tel : +971 45754693", with the number linked.
      const match = /^(.*?:\s*)?(\+?[\d\s()-]{6,})$/.exec(value);
      lines.push(
        match
          ? `<p>${escapeHtml(match[1] ?? '')}<a href="tel:${match[2]!.replace(/[^\d+]/g, '')}">${escapeHtml(match[2]!.trim())}</a></p>`
          : `<p>${escapeHtml(value)}</p>`,
      );
    }
    const email = text(office.email);
    if (email) {
      const match = /^(.*?:\s*)?([^\s:]+@[^\s]+)$/.exec(email);
      lines.push(
        match
          ? `<p>${escapeHtml(match[1] ?? '')}<a href="mailto:${match[2]}">${escapeHtml(match[2]!)}</a></p>`
          : `<p>${escapeHtml(email)}</p>`,
      );
    }
    // Office records have no Arabic fields: on an Arabic page they read as English.
    officeBlocks.push({
      type: 'featureList',
      items: [{ title: text(office.countryName), html: m.wrap(lines.join(''), true) }],
    });
    const src = /src="([^"]+)"/.exec(office.mapUrl ?? '')?.[1];
    if (src) {
      officeBlocks.push({
        type: 'embed',
        provider: 'map',
        url: src.replace(/&amp;/g, '&'),
        title: text(office.countryName),
      });
    }
  }
  const contactTitle = await m.label('/contact', 'Contact Us');
  m.add({
    doc: {
      id: 'contact',
      kind: 'contact',
      path: '/contact/',
      title: contactTitle,
      sourceUrl: `${ctx.source}/contact`,
      seo: {},
      hero: { title: contactTitle, ctas: [] },
      sections: [
        {
          id: 'form',
          blocks: [{ type: 'contactForm', fields, ...(submitLabel ? { submitLabel } : {}) }],
        },
        ...(officeBlocks.length
          ? [
              {
                id: 'locations',
                title: await m.label('/contact', 'Our Locations'),
                blocks: officeBlocks,
              },
            ]
          : []),
      ],
    },
    parentId: 'home',
    order: 90,
    oldPaths: ['/contact', '/request-demo'],
    oldPrefixes: [],
    sourceText: sourceOf(
      ...offices.flatMap((o) => [o.countryName, o.address, o.phoneNumber, o.email]),
    ),
  });

  // FAQs: the old /faqs path shows the home page, whose FAQ block this is.
  const faqs = ordered(cms.faqs);
  const faqTitle = await m.label('/', 'Frequently Asked Questions');
  const faqSource = sourceOf(
    ...faqs.flatMap((f) => [m.raw(f.questionEn, f.questionAr), m.raw(f.answerEn, f.answerAr)]),
  );
  m.add({
    doc: {
      id: 'faqs',
      kind: 'page',
      path: '/faqs/',
      title: faqTitle,
      sourceUrl: `${ctx.source}/faqs`,
      seo: {},
      hero: { title: faqTitle, ctas: [] },
      sections: [
        {
          id: 'questions',
          blocks: [
            {
              type: 'faq',
              items: faqs.map((faq) => {
                const answer = m.raw(faq.answerEn, faq.answerAr);
                return {
                  question: m.t(faq.questionEn, faq.questionAr),
                  html: m.wrap(
                    m.rich(/</.test(answer) ? answer : `<p>${escapeHtml(text(answer))}</p>`),
                    !hasArabic(faq.answerAr),
                  ),
                };
              }),
            },
          ],
        },
      ],
    },
    parentId: 'home',
    order: 91,
    oldPaths: ['/faqs'],
    oldPrefixes: [],
    sourceText: faqSource,
  });

  // Partners: the old /home/partner-details page, with what the CMS says about each partner.
  const partners = ordered(cms.partners);
  if (partners.length) {
    const visit = await m.label('/home/partner-details', 'Visit Website');
    const title = await m.label('/', 'Partners');
    m.add({
      doc: {
        id: 'partners',
        kind: 'page',
        path: '/partners/',
        title,
        sourceUrl: `${ctx.source}/home/partner-details`,
        seo: {},
        hero: { title, ctas: [] },
        sections: [
          {
            id: 'partners',
            blocks: [
              {
                type: 'moduleGrid',
                items: partners.map((partner) => {
                  const name = text(partner.clientName);
                  const media = m.image(partner.imageImagePath, name, m.id('partners'));
                  const about = text(partner.descriptions);
                  const url = text(partner.otherURL);
                  return {
                    title: name,
                    // Partner records have no Arabic fields.
                    ...(about
                      ? {
                          html: m.wrap(
                            m.rich(/</.test(about) ? about : `<p>${escapeHtml(about)}</p>`),
                            true,
                          ),
                        }
                      : {}),
                    ...(media ? { media } : {}),
                    ...(/^https?:\/\//.test(url) ? { href: url, linkLabel: visit } : {}),
                  };
                }),
              },
            ],
          },
        ],
      },
      parentId: 'home',
      order: 92,
      oldPaths: ['/home/partner-details'],
      oldPrefixes: [],
      sourceText: sourceOf(...partners.flatMap((p) => [p.clientName, p.descriptions])),
    });
  }

  // Privacy policy: front-end page (no CMS record), normalized from the rendered DOM.
  const privacy = await rendered.page('/privacy-policy');
  const $p = privacy.$;
  // A copy: the cached page is shared by every pass, and cleaning edits the tree.
  const root = $p('app-privacy-policy').first().clone();
  const header = root.find('app-others-page-header').first();
  const privacyHeading = normalizeSpace(header.find('h1, h2').first().text()) || 'Privacy Policy';
  // The policy is English only; its heading is also a footer link, which has an Arabic label.
  const privacyTitle = m.lang === 'ar' ? arLabel(privacyHeading) : privacyHeading;
  header.remove();
  cleanContent($p, root as never);
  const reference = blockText(root.get(0)!);
  const shaped = shapePage(
    toAtoms($p, root.get(0)!),
    {
      resolveLink: m.resolve,
      registerImage: (image) =>
        ctx.media.register(image, { id: m.id('privacy-policy'), url: privacy.url }),
    },
    privacyTitle,
  );
  const privacySections =
    m.lang === 'ar'
      ? shaped.sections.map((section) => ({
          ...section,
          blocks: section.blocks.map((block) =>
            block.type === 'richText' ? { ...block, html: markEnglish(block.html) } : block,
          ),
        }))
      : shaped.sections;
  m.add({
    doc: {
      id: 'privacy-policy',
      kind: 'page',
      path: '/privacy-policy/',
      title: privacyTitle,
      sourceUrl: `${ctx.source}/privacy-policy`,
      seo: {},
      hero: { ...shaped.hero, title: privacyTitle },
      sections: privacySections,
    },
    parentId: 'home',
    order: 93,
    oldPaths: ['/privacy-policy'],
    oldPrefixes: [],
    sourceText: `${privacyHeading === privacyTitle ? privacyTitle : ''}\n${reference}`,
  });
}
