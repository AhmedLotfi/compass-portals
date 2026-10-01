/**
 * Maps the compassint.org CMS (api.ts) to the portal's pages. Every text comes verbatim from an
 * API field, or from the live front end's rendered pages (labels such as "Our Team", checked by
 * `RenderedSite.label`). Nothing is rewritten: only grouped into hero, sections and blocks.
 */
import { load } from 'cheerio';
import type { Block, LinkKind, PageKind, Section } from '../../../schema/content.ts';
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
import type { RenderedSite } from './rendered.ts';

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
] as const satisfies readonly {
  cmsId: number;
  key: string;
  path: string;
  old: readonly string[];
  oldIndex?: readonly string[];
  index: PageKind;
  detail: PageKind;
}[];

export type SectionSpec = (typeof SECTIONS)[number];

/** A page of the new site, before media and breadcrumbs are attached. */
export interface CmsPage {
  doc: PageDraft;
  parentId: string | null;
  order: number;
  /** Old paths that showed this page (decoded, exact). */
  oldPaths: string[];
  /** Old path prefixes: the old site appended a per-visit ciphertext segment to these. */
  oldPrefixes: string[];
  modified?: string;
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
}

interface Lede {
  lede?: string;
  /** The description's further paragraphs, when it has more than one. */
  rest?: string;
}

/** A description as hero lede (its first paragraph) and the rest as rich text. */
function splitLede(html: string, resolve: LinkResolver): Lede {
  const clean = sanitizeRich(html, resolve);
  if (!clean) return {};
  const $ = load(`<div id="r">${clean}</div>`);
  const first = $('#r').children().first();
  if (!first.is('p') || !normalizeSpace(first.text())) return { rest: clean };
  const lede = normalizeSpace(first.text());
  first.remove();
  const rest = ($('#r').html() ?? '').trim();
  return { lede, ...(rest ? { rest } : {}) };
}

class Mapper {
  readonly pages: CmsPage[] = [];
  private readonly sectionIds = new Map<string, Set<string>>();

  private readonly ctx: MapContext;

  constructor(ctx: MapContext) {
    this.ctx = ctx;
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
    const title = text(line.titleEn);
    const html = this.rich(line.descriptionEn);
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
          title: text(item.titleEn),
          html: this.rich(item.descriptionEn),
        })),
      },
    ]);
  }

  add(page: CmsPage): CmsPage {
    this.pages.push(page);
    return page;
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
  const { cms, rendered } = ctx;
  const m = new Mapper(ctx);
  const sections = new Map(cms.pages.map((page) => [page.id, page]));
  const sectionOf = (spec: SectionSpec): WebPage => {
    const page = sections.get(spec.cmsId);
    if (!page) throw new Error(`The CMS has no ${spec.key} section (id ${spec.cmsId})`);
    return page;
  };
  const detailPath = (spec: SectionSpec, detail: PageDetail) =>
    `${spec.path}${slugify(text(detail.titleEn))}/`;
  const detailId = (spec: SectionSpec, detail: PageDetail) =>
    `${spec.key}--${slugify(text(detail.titleEn))}`;

  // Section index pages and their detail pages.
  // Labels the old product pages print around the CMS data.
  const features = await rendered.label('/solution/', 'Features', { prefix: true });
  const requestDemo = await rendered.label('/solution/', 'Request Your Demo', { prefix: true });
  const demoCta = (): Block => ({
    type: 'cta',
    label: requestDemo,
    href: '/contact/',
    kind: 'internal',
  });

  for (const spec of SECTIONS) {
    if (spec.key === 'about') continue;
    const section = sectionOf(spec);
    const indexId = spec.key;
    const { lede, rest } = splitLede(section.descriptionEn ?? '', ctx.resolve);
    const heroMedia = m.image(section.imageUrl, text(section.titleEn), indexId);
    m.add({
      doc: {
        id: indexId,
        kind: spec.index,
        path: spec.path,
        title: text(section.titleEn),
        sourceUrl: `${ctx.source}${spec.oldIndex[0]}`,
        seo: {},
        hero: {
          title: text(section.titleEn),
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
      sourceText: sourceOf(section.titleEn, section.descriptionEn),
    });

    for (const detail of ordered(section.webPageDetails)) {
      const id = detailId(spec, detail);
      const title = text(detail.titleEn);
      const split = splitLede(detail.descriptionEn ?? '', ctx.resolve);
      const media = m.image(detail.imageUrl, title, id);
      const body: Section[] = [];
      if (split.rest)
        body.push({ id: 'introduction', blocks: [{ type: 'richText', html: split.rest }] });
      if (detail.showlines) {
        for (const line of ordered(detail.webPageLandingLines)) {
          const s = m.line(id, line);
          // The CMS sometimes reuses the page's picture for its first line: show it once.
          if (s && media)
            s.blocks = s.blocks.filter((b) => !(b.type === 'media' && b.media === media));
          if (s) body.push(s);
        }
      }
      if (detail.showFeatures) {
        const list = m.features(id, features, detail.webPageLandingFeatures);
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
        oldPaths: spec.old.map((prefix) => `${prefix}${slug}`),
        oldPrefixes: spec.old.map((prefix) => `${prefix}${slug}/`),
        ...(latest(detail.lastModificationTime, detail.creationTime)
          ? { modified: latest(detail.lastModificationTime, detail.creationTime)! }
          : {}),
        sourceText: sourceOf(
          detail.titleEn,
          detail.descriptionEn,
          ...activeLines.flatMap((l) => [l.titleEn, l.descriptionEn]),
          ...activeFeatures.flatMap((f) => [f.titleEn, f.descriptionEn]),
        ),
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
    if (first) {
      const s = m.line('about', first);
      if (s) body.push(s);
    }
    const team = ordered(cms.team, (member) => Number(member.orderNumber ?? 0));
    if (team.length) {
      const s = m.section('about', await rendered.label('/about', 'Our Team'), [
        {
          type: 'moduleGrid',
          items: team.map((member) => {
            const name = text(member.nameEN);
            const media = m.image(member.imageUrl, name, 'about');
            const job = text(member.jobEN);
            return {
              title: name,
              ...(job ? { html: `<p>${escapeHtml(job)}</p>` } : {}),
              ...(media ? { media } : {}),
            };
          }),
        },
      ]);
      if (s) body.push(s);
    }
    for (const line of others) {
      const s = m.line('about', line);
      if (s) body.push(s);
    }
    const careers = detail?.showFeatures
      ? m.features(
          'about',
          await rendered.label('/about', 'Our Careers'),
          detail.webPageLandingFeatures,
        )
      : undefined;
    if (careers) body.push(careers);
    m.add({
      doc: {
        id: 'about',
        kind: 'page',
        path: spec.path,
        title: text(section.titleEn),
        sourceUrl: `${ctx.source}/about`,
        seo: {},
        hero: {
          title: text(section.titleEn),
          ...(plain(section.descriptionEn) ? { lede: plain(section.descriptionEn) } : {}),
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
      sourceText: sourceOf(
        section.titleEn,
        section.descriptionEn,
        ...lines.flatMap((l) => [l.titleEn, l.descriptionEn]),
        ...team.flatMap((t) => [t.nameEN, t.jobEN]),
        ...(detail?.showFeatures
          ? ordered(detail.webPageLandingFeatures).flatMap((f) => [f.titleEn, f.descriptionEn])
          : []),
      ),
    });
  }

  await mapHome(ctx, m, sectionOf, detailPath);
  await mapStatic(ctx, m);
  return m.pages;
}

/** Card for a detail page, as the old home page lists them: title, first sentence, link. */
function card(
  detail: PageDetail,
  href: string,
  linkLabel: string | undefined,
): Extract<Block, { type: 'moduleGrid' }>['items'][number] {
  const summary = plain(detail.descriptionEn);
  return {
    title: text(detail.titleEn),
    ...(summary ? { html: `<p>${escapeHtml(firstSentence(summary))}</p>` } : {}),
    href,
    ...(linkLabel ? { linkLabel } : {}),
  };
}

async function mapHome(
  ctx: MapContext,
  m: Mapper,
  sectionOf: (spec: SectionSpec) => WebPage,
  detailPath: (spec: SectionSpec, detail: PageDetail) => string,
): Promise<void> {
  const { cms, rendered } = ctx;
  const label = (value: string) => rendered.label('/', value);
  const body: Section[] = [];
  const sources: (string | null | undefined)[] = [];

  // In the order the API returns them, as the old home page shows them (not by their `order`).
  const slides = cms.slides.filter((slide) => slide.isActive);
  const [lead, ...more] = slides;
  if (!lead) throw new Error('The CMS has no home slides');
  const heroMedia = m.image(lead.imageImagePath, text(lead.titleEn), 'home');
  sources.push(...slides.flatMap((s) => [s.titleEn, s.detailsEn]));
  if (more.length) {
    const s = m.section('home', undefined, [
      {
        type: 'moduleGrid',
        items: more.map((slide) => {
          const title = text(slide.titleEn);
          const media = m.image(slide.imageImagePath, title, 'home');
          return {
            title,
            ...(text(slide.detailsEn)
              ? { html: `<p>${escapeHtml(text(slide.detailsEn))}</p>` }
              : {}),
            ...(media ? { media } : {}),
          };
        }),
      },
    ]);
    if (s) body.push({ ...s, id: 'highlights' });
  }

  for (const slogan of ordered(cms.slogans.map((s) => ({ ...s, order: 0 })))) {
    // The slogan title is styled HTML; its text is "Right Application. Right Direction".
    const title = plain(slogan.titleEn);
    const html = m.rich(slogan.contentEn);
    const s = m.section('home', title || undefined, html ? [{ type: 'richText', html }] : []);
    if (s) body.push(s);
    sources.push(slogan.titleEn, slogan.contentEn);
  }

  const linkLabels: Record<string, string | undefined> = {
    products: await label('Explore product'),
    services: await label('Explore this service'),
    features: await label('Learn more'),
    industries: undefined,
  };
  for (const spec of SECTIONS.slice(1)) {
    const section = sectionOf(spec);
    const details = ordered(section.webPageDetails);
    const s = m.section('home', await label(text(section.titleEn)), [
      {
        type: 'moduleGrid',
        items: details.map((detail) =>
          card(detail, detailPath(spec, detail), linkLabels[spec.key]),
        ),
      },
    ]);
    if (s) body.push(s);
  }

  for (const line of ordered(cms.sloganLines.map((l) => ({ ...l, order: 0 })))) {
    const title = text(line.titleEn);
    const media = m.image(line.imageUrl, title, 'home');
    // The old front end shows the title, picture and description, not the `message` field
    // ("Try it free for 30 Days…", "m"), so neither does this page.
    const html = m.rich(line.descriptionEn);
    const s = m.section('home', title || undefined, [
      ...(media ? [{ type: 'media', media } as const] : []),
      ...(html ? [{ type: 'richText', html } as const] : []),
    ]);
    if (s) body.push(s);
    sources.push(line.titleEn, line.descriptionEn);
  }

  // The old front end's alt text for every client logo.
  const clientAlt = 'Client logo';
  const clients = ordered(cms.clients)
    .map((client) => m.image(client.imageImagePath, clientAlt, 'home'))
    .filter((id): id is string => Boolean(id));
  if (clients.length) {
    const s = m.section('home', await label('Our Clients'), [
      { type: 'gallery', variant: 'logos', items: clients.map((media) => ({ media })) },
    ]);
    if (s) body.push(s);
  }

  const feedback = ordered(cms.feedback);
  if (feedback.length) {
    const s = m.section(
      'home',
      await label('Our Client Feedbacks'),
      feedback.map((item) => {
        const name = text(item.nameEn);
        const media = m.image(item.imageUrl, name, 'home');
        const role = [text(item.positionNameEn), text(item.companyNameEn)].filter(Boolean);
        return {
          type: 'quote',
          html: `<p>${escapeHtml(text(item.messageEn))}</p>`,
          ...(name ? { cite: name } : {}),
          ...(role.length ? { role } : {}),
          ...(media ? { media } : {}),
        } satisfies Block;
      }),
    );
    if (s) body.push(s);
    sources.push(
      ...feedback.flatMap((f) => [f.nameEn, f.positionNameEn, f.companyNameEn, f.messageEn]),
    );
  }

  const partners = ordered(cms.partners);
  if (partners.length) {
    const s = m.section('home', await label('Partners'), [
      {
        type: 'gallery',
        variant: 'logos',
        items: partners
          .map((partner) => m.image(partner.imageImagePath, text(partner.clientName), 'home'))
          .filter((id): id is string => Boolean(id))
          .map((media) => ({ media, href: '/partners/' })),
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
      title: text(lead.titleEn),
      sourceUrl: `${ctx.source}/`,
      seo: {},
      hero: {
        title: text(lead.titleEn),
        ...(text(lead.detailsEn) ? { lede: text(lead.detailsEn) } : {}),
        ...(heroMedia ? { media: heroMedia } : {}),
        ctas: [
          { label: contact, href: '/contact/', kind: 'internal' satisfies LinkKind },
          { label: explore, href: '/products/', kind: 'internal' satisfies LinkKind },
        ],
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
        label,
        kind: (['email', 'tel', 'textarea'].includes(type) ? type : 'text') as
          'text' | 'email' | 'tel' | 'textarea',
        required: $el.is('[required]') || /\*/.test(labelEl.text()),
      };
    })
    .filter((field) => field.label);
  const submitLabel = normalizeSpace(
    form.find('button[type="submit"]').clone().find('[aria-hidden="true"]').remove().end().text(),
  );
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
    officeBlocks.push({
      type: 'featureList',
      items: [{ title: text(office.countryName), html: lines.join('') }],
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
  const contactTitle = await rendered.label('/contact', 'Contact Us');
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
                title: await rendered.label('/contact', 'Our Locations'),
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
  const faqTitle = await rendered.label('/', 'Frequently Asked Questions');
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
              items: faqs.map((faq) => ({
                question: text(faq.questionEn),
                html: m.rich(
                  /</.test(faq.answerEn ?? '')
                    ? faq.answerEn
                    : `<p>${escapeHtml(text(faq.answerEn))}</p>`,
                ),
              })),
            },
          ],
        },
      ],
    },
    parentId: 'home',
    order: 91,
    oldPaths: ['/faqs'],
    oldPrefixes: [],
    sourceText: sourceOf(...faqs.flatMap((f) => [f.questionEn, f.answerEn])),
  });

  // Partners: the old /home/partner-details page, with what the CMS says about each partner.
  const partners = ordered(cms.partners);
  if (partners.length) {
    const visit = await rendered.label('/home/partner-details', 'Visit Website');
    const title = await rendered.label('/', 'Partners');
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
                  const media = m.image(partner.imageImagePath, name, 'partners');
                  const about = text(partner.descriptions);
                  const url = text(partner.otherURL);
                  return {
                    title: name,
                    ...(about
                      ? { html: m.rich(/</.test(about) ? about : `<p>${escapeHtml(about)}</p>`) }
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
  const root = $p('app-privacy-policy').first();
  const header = root.find('app-others-page-header').first();
  const privacyTitle = normalizeSpace(header.find('h1, h2').first().text()) || 'Privacy Policy';
  header.remove();
  cleanContent($p, root as never);
  const reference = blockText(root.get(0)!);
  const shaped = shapePage(
    toAtoms($p, root.get(0)!),
    {
      resolveLink: ctx.resolve,
      registerImage: (image) =>
        ctx.media.register(image, { id: 'privacy-policy', url: privacy.url }),
    },
    privacyTitle,
  );
  m.add({
    doc: {
      id: 'privacy-policy',
      kind: 'page',
      path: '/privacy-policy/',
      title: privacyTitle,
      sourceUrl: `${ctx.source}/privacy-policy`,
      seo: {},
      hero: { ...shaped.hero, title: privacyTitle },
      sections: shaped.sections,
    },
    parentId: 'home',
    order: 93,
    oldPaths: ['/privacy-policy'],
    oldPrefixes: [],
    sourceText: `${privacyTitle}\n${reference}`,
  });
}
