/**
 * Sentence extraction for the content-coverage check. Source text is read from the cleaned DOM with
 * block boundaries preserved (independently of the atom code, so atomization bugs can't hide losses).
 */
import { load } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

const BLOCK = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tr',
  'td',
  'th',
  'ul',
  'label',
  'option',
  'button',
  'select',
]);

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

/** Normalizes typography so the same words compare equal (quotes, dashes, spacing, case). */
export function comparable(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Visible text with a newline at every block boundary and `<br>`. */
export function blockText(root: AnyNode): string {
  const parts: string[] = [];
  const walk = (node: AnyNode) => {
    if (node.type === 'text') {
      parts.push((node as unknown as { data: string }).data);
      return;
    }
    if (node.type !== 'tag') return;
    const el = node as Element;
    if (el.tagName === 'br') {
      parts.push('\n');
      return;
    }
    const block = BLOCK.has(el.tagName);
    if (block) parts.push('\n');
    for (const child of el.children) walk(child);
    if (block) parts.push('\n');
  };
  walk(root);
  return parts.join('');
}

export function htmlBlockText(html: string): string {
  const $ = load(`<div id="r">${html}</div>`);
  return blockText($('#r').get(0)!);
}

/** Sentences (comparable form) that contain at least one letter or digit. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    for (const { segment } of segmenter.segment(line)) {
      const sentence = comparable(segment);
      if (/[\p{L}\p{N}]/u.test(sentence)) out.push(sentence);
    }
  }
  return out;
}
