/**
 * Flattens a cleaned content root into an ordered list of semantic atoms. Page builders wrap content
 * in many layers of layout divs; atoms keep only what a reader sees, in reading order, whatever the
 * builder. Top-level builder sections become `boundary` atoms so the original grouping survives.
 */
import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { normalizeSpace } from '../analyze.ts';

export interface ListItem {
  html: string;
  text: string;
  icon?: string;
}

export interface FormField {
  name: string;
  label: string;
  kind: 'text' | 'email' | 'tel' | 'textarea' | 'select';
  required: boolean;
  options?: string[];
}

export type Atom =
  | { kind: 'boundary'; slider: boolean }
  | { kind: 'heading'; level: number; text: string; icon?: string; href?: string }
  | { kind: 'paragraph'; html: string; text: string }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | {
      kind: 'image';
      src: string;
      alt: string | null;
      srcset?: string;
      width?: number;
      height?: number;
      caption?: string;
      href?: string;
    }
  | { kind: 'button'; label: string; href: string }
  | { kind: 'quote'; html: string; text: string; cite?: string }
  | { kind: 'table'; html: string; text: string }
  | { kind: 'embed'; url: string; title: string }
  | { kind: 'form'; fields: FormField[]; submitLabel?: string }
  | { kind: 'counter'; value: string; label: string };

const INLINE = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'br',
  'cite',
  'code',
  'data',
  'dfn',
  'em',
  'font',
  'i',
  'kbd',
  'label',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
  'wbr',
  'big',
  'del',
  'ins',
]);

const BUTTON_CLASS =
  /\b(?:elementor-button(?:-link)?|btn|button|vc_btn3|et_pb_button|wp-block-button__link|fusion-button|ast-button)\b/;

/** Top-level builder sections: each starts a new group. */
const BOUNDARY_CLASS =
  /\b(?:elementor-top-section|e-parent|vc_row(?!-)|et_pb_section|fl-row|wp-block-group|fusion-fullwidth)\b/;

const SLIDER_CLASS =
  /\b(?:elementor-slides|swiper|slick-slider|owl-carousel|rev_slider|n2-ss-slider)\b/;

export function toAtoms($: CheerioAPI, root: Element): Atom[] {
  const atoms: Atom[] = [];
  const push = (atom: Atom) => atoms.push(atom);

  const isElement = (node: AnyNode): node is Element =>
    node.type === 'tag' || node.type === 'script' || node.type === 'style';
  const cls = (el: Element) => el.attribs['class'] ?? '';

  const imageAtom = (img: Element): Atom | undefined => {
    const $img = $(img);
    const src = $img.attr('src');
    if (!src || src.startsWith('data:')) return undefined;
    const width = Number($img.attr('width'));
    const height = Number($img.attr('height'));
    const link = $img.closest('a').attr('href');
    const caption = normalizeSpace($img.closest('figure').find('figcaption').first().text());
    const srcset = $img.attr('srcset');
    return {
      kind: 'image',
      src,
      alt: $img.attr('alt') ?? null,
      ...(srcset ? { srcset } : {}),
      ...(width > 0 ? { width } : {}),
      ...(height > 0 ? { height } : {}),
      ...(caption ? { caption } : {}),
      ...(link ? { href: link } : {}),
    };
  };

  /** Inline content that contains no text, only an image (e.g. `<a><img></a>`). */
  const onlyImage = (el: Element): Element | undefined => {
    if (normalizeSpace($(el).text())) return undefined;
    const imgs = $(el).find('img');
    return imgs.length === 1 ? (imgs.get(0) as Element) : undefined;
  };

  const hasBlockChild = (el: Element): boolean =>
    el.children.some(
      (child) => isElement(child) && !INLINE.has(child.tagName) && child.tagName !== 'img',
    );

  let run: AnyNode[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const html = run
      .map((node) => $.html(node))
      .join('')
      .trim();
    const text = normalizeSpace(run.map((node) => $(node).text()).join(''));
    run = [];
    if (text) push({ kind: 'paragraph', html, text });
  };

  const visitChildren = (el: Element) => {
    for (const child of el.children) {
      if (child.type === 'text') {
        run.push(child);
        continue;
      }
      if (!isElement(child)) continue;
      const tag = child.tagName;
      if (tag === 'img') {
        flush();
        const atom = imageAtom(child);
        if (atom) push(atom);
        continue;
      }
      if (INLINE.has(tag)) {
        if (tag === 'a' && BUTTON_CLASS.test(cls(child)) && normalizeSpace($(child).text())) {
          flush();
          push({
            kind: 'button',
            label: normalizeSpace($(child).text()),
            href: child.attribs['href'] ?? '',
          });
          continue;
        }
        const image = onlyImage(child);
        if (image) {
          flush();
          const atom = imageAtom(image);
          if (atom) push(atom);
          continue;
        }
        if (hasBlockChild(child)) {
          flush();
          visit(child);
          continue;
        }
        run.push(child);
        continue;
      }
      flush();
      visit(child);
    }
    flush();
  };

  const visit = (el: Element) => {
    const tag = el.tagName;
    const className = cls(el);

    if (BOUNDARY_CLASS.test(className) || (tag === 'section' && el.parent === root)) {
      push({ kind: 'boundary', slider: SLIDER_CLASS.test($.html(el).slice(0, 4000)) });
    }

    if (/^h[1-6]$/.test(tag)) {
      const text = normalizeSpace($(el).text());
      const icon = $(el).closest('[data-icon]').attr('data-icon');
      // Card titles link to their page, either inside the heading or via a wrapping card link.
      const href =
        $(el).find('a[href]').first().attr('href') ?? $(el).closest('a[href]').attr('href');
      if (text) {
        push({
          kind: 'heading',
          level: Number(tag[1]),
          text,
          ...(icon ? { icon } : {}),
          ...(href ? { href } : {}),
        });
      }
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      const items = $(el)
        .children('li')
        .toArray()
        .map((li): ListItem => {
          const $li = $(li);
          const icon = $li.attr('data-icon');
          return {
            html: ($li.html() ?? '').trim(),
            text: normalizeSpace($li.text()),
            ...(icon ? { icon } : {}),
          };
        })
        .filter((item) => item.text);
      if (items.length) push({ kind: 'list', ordered: tag === 'ol', items });
      $(el)
        .find('img')
        .each((_, img) => {
          const atom = imageAtom(img);
          if (atom) push(atom);
        });
      return;
    }
    if (tag === 'blockquote') {
      const cite = normalizeSpace($(el).find('cite, footer').first().text());
      const $clone = $(el).clone();
      $clone.find('cite, footer').remove();
      const text = normalizeSpace($clone.text());
      if (text)
        push({
          kind: 'quote',
          html: ($clone.html() ?? '').trim(),
          text,
          ...(cite ? { cite } : {}),
        });
      return;
    }
    if (tag === 'table') {
      const text = normalizeSpace($(el).text());
      if (text) push({ kind: 'table', html: $.html(el), text });
      return;
    }
    if (tag === 'iframe' || tag === 'video') {
      const src = el.attribs['src'] ?? el.attribs['data-src'] ?? $(el).find('source').attr('src');
      if (src) push({ kind: 'embed', url: src, title: el.attribs['title'] ?? '' });
      return;
    }
    if (tag === 'form') {
      push(formAtom($, el));
      return;
    }
    if (/\belementor-counter\b/.test(className)) {
      const $el = $(el);
      const number = $el.find('.elementor-counter-number');
      const value = normalizeSpace(
        `${$el.find('.elementor-counter-number-prefix').text()}${number.attr('data-to-value') ?? number.text()}${$el.find('.elementor-counter-number-suffix').text()}`,
      );
      const label = normalizeSpace($el.find('.elementor-counter-title').text());
      if (value) push({ kind: 'counter', value, label });
      return;
    }
    if (tag === 'figure') {
      const img = $(el).find('img').get(0) as Element | undefined;
      const atom = img ? imageAtom(img) : undefined;
      if (atom) push(atom);
      $(el).find('figcaption').remove();
      $(el).find('img').remove();
      visitChildren(el);
      return;
    }
    if (tag === 'picture') {
      const img = $(el).find('img').get(0) as Element | undefined;
      const atom = img ? imageAtom(img) : undefined;
      if (atom) push(atom);
      return;
    }
    if (
      tag === 'hr' ||
      tag === 'button' ||
      tag === 'input' ||
      tag === 'select' ||
      tag === 'textarea'
    ) {
      return;
    }
    visitChildren(el);
  };

  visitChildren(root);
  return atoms;
}

function formAtom($: CheerioAPI, form: Element): Atom {
  const $form = $(form);
  const fields: FormField[] = [];
  $form.find('input, textarea, select').each((_, input) => {
    const $input = $(input);
    const type = ($input.attr('type') ?? (input as Element).tagName).toLowerCase();
    if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file'].includes(type)) return;
    const name = $input.attr('name') ?? $input.attr('id') ?? '';
    const id = $input.attr('id');
    const label = normalizeSpace(
      (id ? $form.find(`label[for="${id}"]`).text() : '') ||
        $input.closest('label').clone().children('input, textarea, select').remove().end().text() ||
        $input.attr('placeholder') ||
        $input.attr('aria-label') ||
        name,
    ).replace(/\s*\*$/, '');
    const tag = (input as Element).tagName;
    const kind: FormField['kind'] =
      tag === 'textarea'
        ? 'textarea'
        : tag === 'select'
          ? 'select'
          : type === 'email'
            ? 'email'
            : type === 'tel'
              ? 'tel'
              : 'text';
    const required =
      $input.is('[required], [aria-required="true"]') ||
      /\brequired\b|wpcf7-validates-as-required/.test($input.attr('class') ?? '');
    const options =
      tag === 'select'
        ? $input
            .find('option')
            .toArray()
            .map((o) => normalizeSpace($(o).text()))
            .filter(Boolean)
        : undefined;
    fields.push({ name, label, kind, required, ...(options ? { options } : {}) });
  });
  const submit = normalizeSpace(
    $form.find('button[type="submit"], button:not([type])').first().text() ||
      ($form.find('input[type="submit"]').attr('value') ?? ''),
  );
  return { kind: 'form', fields, ...(submit ? { submitLabel: submit } : {}) };
}
