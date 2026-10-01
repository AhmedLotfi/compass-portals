/**
 * Markdown for llms.txt / llms-full.txt: the synced pages in the site's own words, without the page
 * chrome. Only the sanitizer's tag allowlist can occur in the HTML, so a small converter suffices.
 */
import { load } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { Block, MediaRef, PageDoc } from '../../schema/content.ts';

export interface MarkdownContext {
  origin: string;
  /** Media records of the page being converted. */
  media: Record<string, MediaRef>;
}

/** Heading levels: the page is `##` under the site's `#`, sections `###`, block titles `####`. */
const PAGE = 2;
const SECTION = 3;
const BLOCK = 4;

const heading = (level: number, text: string) => `${'#'.repeat(Math.min(level, 6))} ${text}`;

export function absoluteUrl(href: string, origin: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : new URL(href, origin).href;
}

export function mediaHref(media: MediaRef, origin: string): string {
  return new URL(`/media/${media.id}.${media.svg ? 'svg' : 'webp'}`, origin).href;
}

function isTag(node: AnyNode, ...names: string[]): node is Element {
  return node.type === 'tag' && (names.length === 0 || names.includes((node as Element).name));
}

/** Emphasis markers must hug the text, so surrounding spaces move outside them. */
function wrap(marker: string, text: string): string {
  const [, lead = '', core = '', trail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];
  return core ? `${lead}${marker}${core}${marker}${trail}` : text;
}

function textOf(node: AnyNode): string {
  if (node.type === 'text') return (node as unknown as { data: string }).data;
  return isTag(node) ? node.children.map(textOf).join('') : '';
}

function inline(nodes: AnyNode[], ctx: MarkdownContext): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += textOf(node).replace(/\s+/g, ' ');
      continue;
    }
    if (!isTag(node)) continue;
    const inner = () => inline(node.children, ctx);
    switch (node.name) {
      case 'br':
        out += '  \n';
        break;
      case 'strong':
        out += wrap('**', inner());
        break;
      case 'em':
        out += wrap('*', inner());
        break;
      case 's':
        out += wrap('~~', inner());
        break;
      case 'code':
        out += `\`${textOf(node)}\``;
        break;
      case 'a': {
        const text = inner().trim();
        const href = node.attribs['href'];
        out += href && text ? `[${text}](${absoluteUrl(href, ctx.origin)})` : text;
        break;
      }
      default:
        out += inner();
    }
  }
  return out;
}

const BLOCK_TAGS = ['p', 'h3', 'h4', 'ul', 'ol', 'blockquote', 'pre', 'table', 'hr', 'li'];

function indent(text: string, pad: string): string {
  return text.replace(/\n(?=.)/g, `\n${pad}`);
}

function list(el: Element, ctx: MarkdownContext): string {
  let n = Number(el.attribs['start'] ?? 1) || 1;
  return el.children
    .filter((child) => isTag(child, 'li'))
    .map((li) => {
      const marker = el.name === 'ol' ? `${n++}. ` : '- ';
      const body = chunks((li as Element).children, ctx).join('\n');
      return marker + indent(body, ' '.repeat(marker.length));
    })
    .join('\n');
}

function table(el: Element, ctx: MarkdownContext): string {
  const rows: Element[] = [];
  const collect = (node: Element) => {
    for (const child of node.children) {
      if (isTag(child, 'tr')) rows.push(child);
      else if (isTag(child, 'thead', 'tbody', 'tfoot')) collect(child);
    }
  };
  collect(el);
  const cells = rows.map((row) =>
    row.children
      .filter((cell) => isTag(cell, 'th', 'td'))
      .map((cell) =>
        inline((cell as Element).children, ctx)
          .replace(/\s*\n\s*/g, ' ')
          .replace(/\|/g, '\\|')
          .trim(),
      ),
  );
  const width = Math.max(0, ...cells.map((row) => row.length));
  if (!width) return '';
  const line = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`;
  const [head = [], ...body] = cells;
  const caption = el.children.find((child) => isTag(child, 'caption'));
  return [
    ...(caption ? [inline((caption as Element).children, ctx).trim(), ''] : []),
    line(head),
    line(Array.from({ length: width }, () => '---')),
    ...body.map(line),
  ].join('\n');
}

/** Converts nodes into Markdown paragraphs (joined with blank lines by the caller). */
function chunks(nodes: AnyNode[], ctx: MarkdownContext): string[] {
  const out: string[] = [];
  let run: AnyNode[] = [];
  const flush = () => {
    const text = inline(run, ctx)
      .replace(/[ \t]*( {2}\n)[ \t]*/g, '$1')
      .trim();
    if (text) out.push(text);
    run = [];
  };
  for (const node of nodes) {
    if (!isTag(node, ...BLOCK_TAGS)) {
      run.push(node);
      continue;
    }
    flush();
    switch (node.name) {
      case 'p':
      case 'li':
        out.push(...chunks(node.children, ctx));
        break;
      case 'h3':
      case 'h4': {
        const text = inline(node.children, ctx).trim();
        if (text) out.push(heading(node.name === 'h3' ? BLOCK : BLOCK + 1, text));
        break;
      }
      case 'ul':
      case 'ol':
        out.push(list(node, ctx));
        break;
      case 'blockquote':
        out.push(
          chunks(node.children, ctx)
            .join('\n\n')
            .split('\n')
            .map((line) => (line ? `> ${line}` : '>'))
            .join('\n'),
        );
        break;
      case 'pre':
        out.push(`\`\`\`\n${textOf(node).replace(/\n$/, '')}\n\`\`\``);
        break;
      case 'table':
        out.push(table(node, ctx));
        break;
      case 'hr':
        out.push('---');
        break;
    }
  }
  flush();
  return out.filter(Boolean);
}

export function htmlToMarkdown(html: string, ctx: MarkdownContext): string {
  const $ = load(html, null, false);
  return chunks($.root().contents().toArray(), ctx).join('\n\n');
}

function image(ctx: MarkdownContext, id: string, caption?: string, href?: string): string {
  const media = ctx.media[id];
  if (!media || (!media.alt && !caption)) return '';
  const img = `![${media.alt}](${mediaHref(media, ctx.origin)})`;
  const linked = href ? `[${img}](${absoluteUrl(href, ctx.origin)})` : img;
  return caption ? `${linked}\n\n${caption}` : linked;
}

export function blockToMarkdown(block: Block, ctx: MarkdownContext): string {
  const md = (html: string) => htmlToMarkdown(html, ctx);
  switch (block.type) {
    case 'richText':
      return md(block.html);
    case 'featureList':
      return [
        block.title && heading(BLOCK, block.title),
        block.items
          .map((item) => {
            const text = md(item.html);
            const body = item.title ? `**${item.title}**${text ? `: ${text}` : ''}` : text;
            return `- ${indent(body, '  ')}`;
          })
          .join('\n'),
      ]
        .filter(Boolean)
        .join('\n\n');
    case 'moduleGrid': {
      const level = block.title ? BLOCK + 1 : BLOCK;
      const items = block.items.map((item) => {
        const link = item.href ? absoluteUrl(item.href, ctx.origin) : undefined;
        const title =
          link && !item.linkLabel
            ? heading(level, `[${item.title}](${link})`)
            : heading(level, item.title);
        return [
          title,
          item.media && image(ctx, item.media),
          item.html && md(item.html),
          link && item.linkLabel && `[${item.linkLabel}](${link})`,
        ]
          .filter(Boolean)
          .join('\n\n');
      });
      return [block.title && heading(BLOCK, block.title), ...items].filter(Boolean).join('\n\n');
    }
    case 'media':
      return image(ctx, block.media, block.caption, block.href);
    case 'gallery':
      return block.items
        .map((item) => image(ctx, item.media, item.caption, item.href))
        .filter(Boolean)
        .join('\n\n');
    case 'cta':
      return `[${block.label}](${absoluteUrl(block.href, ctx.origin)})`;
    case 'stats':
      return block.items.map((item) => `- **${item.value}** ${item.label}`).join('\n');
    case 'quote':
      return [md(block.html), [block.cite, ...(block.role ?? [])].filter(Boolean).join(', ')]
        .filter(Boolean)
        .join('\n\n')
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    case 'faq':
      return block.items
        .map((item) => `${heading(BLOCK, item.question)}\n\n${md(item.html)}`)
        .join('\n\n');
    case 'embed':
      return `[${block.title}](${block.url})`;
    case 'contactForm':
      // The form is an interface, not content; the contact details are listed with the site.
      return '';
  }
}

/** The whole page as Markdown: its H1, URL, lede, hero links, child pages and sections. */
export function pageToMarkdown(page: PageDoc, origin: string): string {
  const ctx: MarkdownContext = { origin, media: page.media };
  const url = absoluteUrl(page.path, origin);
  const parts: string[] = [heading(PAGE, page.hero.title), `<${url}>`];
  if (page.hero.lede) parts.push(page.hero.lede);
  if (page.hero.highlights?.length)
    parts.push(page.hero.highlights.map((h) => `- ${h}`).join('\n'));
  if (page.hero.ctas.length) {
    parts.push(
      page.hero.ctas.map((cta) => `- [${cta.label}](${absoluteUrl(cta.href, origin)})`).join('\n'),
    );
  }
  if (page.hero.media) parts.push(image(ctx, page.hero.media));
  if (page.children.length) {
    parts.push(
      page.children
        .map((child) => {
          const link = `[${child.title}](${absoluteUrl(child.path, origin)})`;
          return `- ${child.summary ? `${link}: ${child.summary}` : link}`;
        })
        .join('\n'),
    );
  }
  for (const section of page.sections) {
    const blocks = section.blocks.map((block) => blockToMarkdown(block, ctx)).filter(Boolean);
    if (!blocks.length && !section.title) continue;
    if (section.title) parts.push(heading(SECTION, section.title));
    parts.push(...blocks);
  }
  return parts.filter(Boolean).join('\n\n');
}
