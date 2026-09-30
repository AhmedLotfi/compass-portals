import sanitizeHtml from 'sanitize-html';
import type { LinkKind } from '../../../schema/content.ts';

export interface LinkTarget {
  href: string;
  kind: LinkKind;
}

export type LinkResolver = (href: string) => LinkTarget;

const RICH_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'u',
  's',
  'sub',
  'sup',
  'small',
  'a',
  'abbr',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'h3',
  'h4',
  'blockquote',
  'table',
  'caption',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'hr',
];

const INLINE_TAGS = [
  'br',
  'strong',
  'em',
  'u',
  's',
  'sub',
  'sup',
  'small',
  'a',
  'abbr',
  'code',
  'ul',
  'ol',
  'li',
];

function options(allowedTags: string[], resolve: LinkResolver): sanitizeHtml.IOptions {
  return {
    allowedTags,
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      abbr: ['title'],
      th: ['colspan', 'rowspan', 'scope'],
      td: ['colspan', 'rowspan'],
      ol: ['start', 'type'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    // Keep the text of anything unwrapped (spans, divs, fonts); drop only non-text containers.
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'template', 'svg'],
    transformTags: {
      b: 'strong',
      i: 'em',
      strike: 's',
      del: 's',
      h1: 'h3',
      h2: 'h3',
      h5: 'h4',
      h6: 'h4',
      a: (tagName, attribs) => {
        const target = attribs['href'] ? resolve(attribs['href']) : undefined;
        const attrs: Record<string, string> = {};
        if (target) attrs['href'] = target.href;
        if (attribs['title']) attrs['title'] = attribs['title'];
        if (target?.kind === 'external' && attribs['target'] === '_blank') {
          attrs['target'] = '_blank';
          attrs['rel'] = 'noopener';
        }
        return { tagName, attribs: attrs };
      },
    },
    exclusiveFilter: (frame) =>
      ['p', 'li', 'strong', 'em', 'a', 'span'].includes(frame.tag) &&
      !frame.text.trim() &&
      !frame.mediaChildren.length,
  };
}

/** Collapses whitespace between tags and inside text, without touching `pre`. */
function tidy(html: string): string {
  if (/<pre\b/i.test(html)) return html.trim();
  return html
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, (match) => (match.includes('\n') ? '><' : '> <'))
    .replace(/\s*<br\s*\/?>\s*/g, '<br>')
    .replace(/<(p|li|h3|h4|td|th)>\s+/g, '<$1>')
    .replace(/\s+<\/(p|li|h3|h4|td|th)>/g, '</$1>')
    .trim();
}

export function sanitizeRich(html: string, resolve: LinkResolver): string {
  return tidy(sanitizeHtml(html, options(RICH_TAGS, resolve)));
}

export function sanitizeInline(html: string, resolve: LinkResolver): string {
  return tidy(sanitizeHtml(html, options(INLINE_TAGS, resolve)));
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
