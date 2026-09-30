/**
 * Shapes a page's atoms into the portal's content model: a hero plus sections of typed blocks.
 * No text is rewritten; atoms are only grouped (the coverage check proves nothing was dropped).
 */
import type { Block, LinkKind, Section } from '../../../schema/content.ts';
import type { Atom, ListItem } from './atoms.ts';
import { escapeHtml, sanitizeInline, sanitizeRich, type LinkResolver } from './sanitize.ts';

type ImageAtom = Extract<Atom, { kind: 'image' }>;
type HeadingAtom = Extract<Atom, { kind: 'heading' }>;

export interface ShapeContext {
  resolveLink: LinkResolver;
  /**
   * Registers an image and returns its media id, or undefined if the file is unavailable.
   * `context` is nearby site text (a card or hero title) used only if the image has no alt at all.
   */
  registerImage(image: ImageAtom, context?: string): string | undefined;
}

export interface Hero {
  title: string;
  lede?: string;
  media?: string;
  ctas: { label: string; href: string; kind: LinkKind }[];
}

export interface ShapedPage {
  hero: Hero;
  /** Whether the hero title came from the page content (an H1) rather than the page title. */
  heroFromContent: boolean;
  sections: Section[];
}

const MAX_LEDE_WORDS = 70;

export function shapePage(atoms: Atom[], ctx: ShapeContext, fallbackTitle: string): ShapedPage {
  const groups = splitGroups(atoms);
  const hero: Hero = { title: fallbackTitle, ctas: [] };
  let heroFromContent = false;

  const heroGroupIndex = groups.findIndex((g) =>
    g.some((a) => a.kind === 'heading' && a.level === 1),
  );
  if (heroGroupIndex !== -1 && heroGroupIndex <= 1) {
    const group = groups[heroGroupIndex]!;
    const h1Index = group.findIndex((a) => a.kind === 'heading' && a.level === 1);
    hero.title = (group[h1Index] as HeadingAtom).text;
    heroFromContent = true;
    const remove = new Set<number>([h1Index]);
    const next = group[h1Index + 1];
    if (next?.kind === 'paragraph' && next.text.split(/\s+/).length <= MAX_LEDE_WORDS) {
      hero.lede = next.text;
      remove.add(h1Index + 1);
    }
    for (let i = 0; i < group.length; i++) {
      const atom = group[i]!;
      if (i > h1Index && atom.kind === 'heading') break;
      if (atom.kind === 'button' && !remove.has(i)) {
        const target = ctx.resolveLink(atom.href);
        hero.ctas.push({ label: atom.label, ...target });
        remove.add(i);
      }
      if (atom.kind === 'image' && !hero.media) {
        const id = ctx.registerImage(atom, hero.title);
        if (id) {
          hero.media = id;
          remove.add(i);
        }
      }
    }
    groups[heroGroupIndex] = group.filter((_, i) => !remove.has(i));
  }

  const sections: Section[] = [];
  const ids = new Set<string>();
  groups.forEach((group, index) => {
    const section = buildSection(group, index, ctx);
    if (!section) return;
    let id = section.id;
    for (let n = 2; ids.has(id); n++) id = `${section.id}-${n}`;
    ids.add(id);
    sections.push({ ...section, id });
  });
  return { hero, heroFromContent, sections };
}

/** Groups at builder-section boundaries; also starts a new group at every H1/H2 that follows content. */
export function splitGroups(atoms: Atom[]): Atom[][] {
  const useBoundaries = atoms.filter((a) => a.kind === 'boundary').length > 1;
  const groups: Atom[][] = [[]];
  for (const atom of atoms) {
    const current = groups[groups.length - 1]!;
    if (atom.kind === 'boundary') {
      if (useBoundaries && current.length) groups.push([]);
      continue;
    }
    if (atom.kind === 'heading' && atom.level <= 2 && current.some((a) => a.kind !== 'heading')) {
      groups.push([atom]);
      continue;
    }
    current.push(atom);
  }
  return groups.filter((g) => g.length > 0);
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'section'
  );
}

function buildSection(group: Atom[], index: number, ctx: ShapeContext): Section | undefined {
  let atoms = group;
  let title: string | undefined;
  const first = atoms[0];
  if (first?.kind === 'heading' && first.level <= 3 && !first.href) {
    title = first.text;
    atoms = atoms.slice(1);
  }
  const blocks = buildBlocks(atoms, ctx, Boolean(title));
  if (!title && blocks.length === 0) return undefined;
  return { id: title ? slug(title) : `section-${index + 1}`, ...(title ? { title } : {}), blocks };
}

interface Card {
  title: string;
  html?: string;
  media?: string;
  icon?: string;
  href?: string;
  linkLabel?: string;
}

/** Repeated cards: [image] heading(h3–h6) [paragraphs/lists] [one button], at least two in a row. */
function matchCards(
  atoms: Atom[],
  start: number,
  ctx: ShapeContext,
): { items: Card[]; end: number } | undefined {
  const items: Card[] = [];
  let level: number | undefined;
  let j = start;
  while (j < atoms.length) {
    let k = j;
    let image: ImageAtom | undefined;
    const maybeImage = atoms[k];
    if (maybeImage?.kind === 'image' && atoms[k + 1]?.kind === 'heading') {
      image = maybeImage;
      k++;
    }
    const heading = atoms[k];
    if (heading?.kind !== 'heading' || heading.level < 3) break;
    if (level !== undefined && heading.level !== level) break;
    k++;
    const body: string[] = [];
    for (
      let atom = atoms[k];
      atom?.kind === 'paragraph' || atom?.kind === 'list';
      atom = atoms[++k]
    ) {
      if (atom.kind === 'paragraph') body.push(`<p>${atom.html}</p>`);
      else body.push(listHtml(atom.ordered, atom.items));
    }
    let href = heading.href;
    let linkLabel: string | undefined;
    const button = atoms[k];
    if (button?.kind === 'button' && atoms[k + 1]?.kind !== 'button') {
      href ??= button.href;
      linkLabel = button.label;
      k++;
    }
    level = heading.level;
    const media = image ? ctx.registerImage(image, heading.text) : undefined;
    items.push({
      title: heading.text,
      ...(body.length ? { html: sanitizeRich(body.join(''), ctx.resolveLink) } : {}),
      ...(media ? { media } : {}),
      ...(heading.icon ? { icon: heading.icon } : {}),
      ...(href ? { href: ctx.resolveLink(href).href } : {}),
      ...(linkLabel ? { linkLabel } : {}),
    });
    j = k;
  }
  // A lone heading with text is a subheading, not a card grid; title-only runs need three.
  const withBody = items.filter((i) => i.html || i.media || i.href).length;
  if (items.length >= 2 && (withBody >= 2 || items.length >= 3)) return { items, end: j };
  return undefined;
}

function listHtml(ordered: boolean, items: ListItem[]): string {
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map((i) => `<li>${i.html}</li>`).join('')}</${tag}>`;
}

function embedProvider(url: string): 'youtube' | 'vimeo' | 'map' | 'other' {
  if (/youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(url)) return 'youtube';
  if (/vimeo\.com/i.test(url)) return 'vimeo';
  if (/google\.[a-z.]+\/maps|maps\.google\.|openstreetmap\.org/i.test(url)) return 'map';
  return 'other';
}

function buildBlocks(atoms: Atom[], ctx: ShapeContext, titled: boolean): Block[] {
  const blocks: Block[] = [];
  let rich: string[] = [];
  const flush = () => {
    if (!rich.length) return;
    const html = sanitizeRich(rich.join(''), ctx.resolveLink);
    if (html) blocks.push({ type: 'richText', html });
    rich = [];
  };

  for (let i = 0; i < atoms.length;) {
    const atom = atoms[i]!;

    const cards = matchCards(atoms, i, ctx);
    if (cards) {
      flush();
      blocks.push({ type: 'moduleGrid', items: cards.items });
      i = cards.end;
      continue;
    }

    const next = atoms[i + 1];
    if (atom.kind === 'heading' && atom.level >= 3 && next?.kind === 'list') {
      flush();
      blocks.push(featureList(next.items, ctx, atom.text));
      i += 2;
      continue;
    }
    if (
      atom.kind === 'list' &&
      !atom.ordered &&
      titled &&
      blocks.length === 0 &&
      rich.length === 0
    ) {
      blocks.push(featureList(atom.items, ctx));
      i += 1;
      continue;
    }

    switch (atom.kind) {
      case 'paragraph':
        rich.push(`<p>${atom.html}</p>`);
        i++;
        break;
      case 'heading':
        rich.push(
          atom.level <= 3
            ? `<h3>${escapeHtml(atom.text)}</h3>`
            : `<h4>${escapeHtml(atom.text)}</h4>`,
        );
        i++;
        break;
      case 'list':
        rich.push(listHtml(atom.ordered, atom.items));
        i++;
        break;
      case 'table':
        rich.push(atom.html);
        i++;
        break;
      case 'image': {
        flush();
        const run: { media: string; caption?: string; href?: string }[] = [];
        while (atoms[i]?.kind === 'image') {
          const image = atoms[i] as ImageAtom;
          const media = ctx.registerImage(image);
          if (media) {
            run.push({
              media,
              ...(image.caption ? { caption: image.caption } : {}),
              ...(image.href ? { href: ctx.resolveLink(image.href).href } : {}),
            });
          }
          i++;
        }
        if (run.length === 1) blocks.push({ type: 'media', ...run[0]! });
        else if (run.length > 1) blocks.push({ type: 'gallery', items: run });
        break;
      }
      case 'button': {
        flush();
        const target = ctx.resolveLink(atom.href);
        blocks.push({ type: 'cta', label: atom.label, ...target });
        i++;
        break;
      }
      case 'counter': {
        flush();
        const items: { value: string; label: string }[] = [];
        while (atoms[i]?.kind === 'counter') {
          const counter = atoms[i] as Extract<Atom, { kind: 'counter' }>;
          items.push({ value: counter.value, label: counter.label });
          i++;
        }
        blocks.push({ type: 'stats', items });
        break;
      }
      case 'quote':
        flush();
        blocks.push({
          type: 'quote',
          html: sanitizeRich(atom.html, ctx.resolveLink),
          ...(atom.cite ? { cite: atom.cite } : {}),
        });
        i++;
        break;
      case 'embed': {
        flush();
        try {
          const url = new URL(atom.url, 'https://example.invalid').href;
          blocks.push({ type: 'embed', provider: embedProvider(url), url, title: atom.title });
        } catch {
          // Unparseable embed URL: nothing to embed.
        }
        i++;
        break;
      }
      case 'form':
        flush();
        blocks.push({
          type: 'contactForm',
          fields: atom.fields,
          ...(atom.submitLabel ? { submitLabel: atom.submitLabel } : {}),
        });
        i++;
        break;
      default:
        i++;
    }
  }
  flush();
  return blocks;
}

function featureList(items: ListItem[], ctx: ShapeContext, title?: string): Block {
  return {
    type: 'featureList',
    ...(title ? { title } : {}),
    items: items.map((item) => ({
      html: sanitizeInline(item.html, ctx.resolveLink),
      ...(item.icon ? { icon: item.icon } : {}),
    })),
  };
}
