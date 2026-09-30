import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { decodeCfEmail } from './cfemail.ts';
import { classifyPath, isSiteHost, resolveUrl, type LinkKind } from './url.ts';

export interface NavItem {
  label: string;
  href: string | null;
  children: NavItem[];
}

export interface NavMenu {
  location: 'header' | 'footer' | 'other';
  selector: string;
  items: NavItem[];
}

export type Region = 'header' | 'footer' | 'content';

export interface ImageRef {
  src: string;
  alt: string | null;
  srcset?: string;
  width?: number;
  height?: number;
  region: Region;
}

export interface FormRef {
  kind: string;
  id?: string;
  action?: string;
  fields: string[];
}

export interface LinkRef {
  href: string;
  text: string;
  internal: boolean;
  kind: LinkKind | 'external';
  region: Region;
}

export interface PageAnalysis {
  url: string;
  title: string;
  metaDescription?: string;
  canonical?: string;
  robots?: string;
  lang?: string;
  dir?: string;
  hreflang: { lang: string; href: string }[];
  meta: Record<string, string>;
  jsonLd: unknown[];
  generator: string[];
  restLink?: string;
  shortlink?: string;
  bodyClasses: string[];
  wpId?: number;
  wpKind?: string;
  template?: string;
  builders: string[];
  unrenderedShortcodes: boolean;
  theme?: string;
  plugins: string[];
  translationWidgets: string[];
  headings: { level: number; text: string }[];
  h1: string[];
  wordCount: number;
  menus: NavMenu[];
  links: LinkRef[];
  images: ImageRef[];
  backgroundImages: string[];
  pageStylesheets: string[];
  documents: string[];
  forms: FormRef[];
  emails: string[];
  phones: string[];
  cfEmailCount: number;
  iframes: string[];
  demoTextHits: string[];
}

const BUILDERS: [string, RegExp][] = [
  ['elementor', /\belementor-(?:widget|section|element|page)\b|data-elementor-type/],
  ['wpbakery', /\bvc_row\b|\bwpb_wrapper\b|\bvc_column/],
  ['divi', /\bet_pb_(?:section|row|module)/],
  ['gutenberg', /\bwp-block-[a-z]/],
  ['beaver-builder', /\bfl-builder\b|\bfl-row\b/],
  ['siteorigin', /\bpanel-grid\b|\bso-panel\b/],
  ['oxygen', /\bct-section\b|\boxy-[a-z]/],
  ['bricks', /\bbrxe-[a-z]/],
  ['avada', /\bfusion-builder-row\b|\bfusion-layout-column\b/],
  ['themify', /\bthemify_builder/],
  ['visual-composer', /\bvce-row\b/],
  ['revolution-slider', /<rs-module|\brev_slider\b/],
  ['layerslider', /\bls-container\b|\blayerslider\b/i],
  ['slick', /\bslick-(?:slider|slide|track)\b/],
  ['swiper', /\bswiper-(?:container|wrapper|slide)\b/],
  ['owl-carousel', /\bowl-carousel\b/],
];

const TRANSLATION_WIDGETS: [string, RegExp][] = [
  ['gtranslate', /gtranslate/i],
  ['google-translate', /google_translate_element|goog-te-/i],
  ['wpml', /wpml-ls|icl_lang_sel/i],
  ['polylang', /\blang-item\b|\bpll_/i],
  ['weglot', /weglot/i],
  ['translatepress', /\btrp-language|translatepress/i],
  ['conveythis', /conveythis/i],
];

const DEMO_TEXT =
  /lorem ipsum|dolor sit amet|consectetur adipiscing|just another wordpress site|hello world!|sample page|this is an example page/gi;

const MENU_ITEM_CLASS = /\b(?:menu-item|page_item|nav-item)\b/;
const HEADER_SELECTOR =
  'header, [data-elementor-type="header"], #masthead, .site-header, #header, .header';
const FOOTER_SELECTOR =
  'footer, [data-elementor-type="footer"], #colophon, .site-footer, #footer, .footer';
const IMAGE_URL = /\.(?:jpe?g|png|gif|webp|avif|svg)(?:\?.*)?$/i;

export function analyzePage(html: string, url: string, siteHosts: readonly string[]): PageAnalysis {
  const $ = load(html, { scriptingEnabled: false, baseURI: url });
  const $body = $('body');
  const bodyClasses = ($body.attr('class') ?? '').split(/\s+/).filter(Boolean);
  const idMatch = bodyClasses.map((c) => /^(?:page-id|postid)-(\d+)$/.exec(c)).find(Boolean);
  const template = bodyClasses
    .map((c) => /^page-template-(.+)$/.exec(c)?.[1])
    .find((t) => t && t !== 'default');

  const meta: Record<string, string> = {};
  $('meta[property^="og:"], meta[name^="twitter:"], meta[property^="article:"]').each((_, el) => {
    const key = $(el).attr('property') ?? $(el).attr('name');
    const value = $(el).attr('content');
    if (key && value !== undefined && !(key in meta)) meta[key] = value;
  });

  const jsonLd: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      jsonLd.push(JSON.parse($(el).text()));
    } catch {
      // Ignore malformed JSON-LD.
    }
  });

  const headings = $('h1, h2, h3, h4, h5, h6')
    .toArray()
    .map((el) => ({ level: Number(el.tagName.slice(1)), text: normalizeSpace($(el).text()) }))
    .filter((h) => h.text);

  const text = mainText($);
  const allText = visibleText($);
  const images = extractImages($, url);
  const links = extractLinks($, url, siteHosts);

  const analysis: PageAnalysis = {
    url,
    title: normalizeSpace($('title').first().text()),
    hreflang: $('link[rel="alternate"][hreflang]')
      .toArray()
      .map((el) => ({
        lang: $(el).attr('hreflang') ?? '',
        href: resolveUrl($(el).attr('href'), url)?.href ?? '',
      }))
      .filter((h) => h.lang && h.href),
    meta,
    jsonLd,
    generator: $('meta[name="generator"]')
      .toArray()
      .map((el) => $(el).attr('content') ?? '')
      .filter(Boolean),
    bodyClasses,
    builders: BUILDERS.filter(([, pattern]) => pattern.test(html)).map(([name]) => name),
    unrenderedShortcodes: /\[(?:vc_row|vc_column|et_pb_section|fusion_builder)/.test($body.text()),
    plugins: unique(
      [...html.matchAll(/\/wp-content\/plugins\/([a-z0-9_-]+)\//gi)].map((m) =>
        m[1]!.toLowerCase(),
      ),
    ),
    translationWidgets: TRANSLATION_WIDGETS.filter(([, pattern]) => pattern.test(html)).map(
      ([name]) => name,
    ),
    headings,
    h1: headings.filter((h) => h.level === 1).map((h) => h.text),
    wordCount: text.split(/\s+/).filter(Boolean).length,
    menus: extractMenus($),
    links,
    images,
    backgroundImages: extractBackgroundImages($, url),
    pageStylesheets: $('link[rel="stylesheet"][href*="/wp-content/uploads/"]')
      .toArray()
      .map((el) => resolveUrl($(el).attr('href'), url)?.href)
      .filter(isDefined),
    documents: unique(links.filter((l) => l.kind === 'document').map((l) => l.href)),
    forms: extractForms($, url),
    emails: extractEmails($, allText),
    phones: extractPhones($, allText),
    cfEmailCount: $('[data-cfemail], a[href*="/cdn-cgi/l/email-protection"]').length,
    iframes: $('iframe[src], iframe[data-src]')
      .toArray()
      .map((el) => resolveUrl($(el).attr('src') ?? $(el).attr('data-src'), url)?.href)
      .filter(isDefined),
    demoTextHits: unique([...text.matchAll(DEMO_TEXT)].map((m) => m[0].toLowerCase())),
  };

  const optional: Partial<PageAnalysis> = {
    metaDescription: $('meta[name="description"]').attr('content')?.trim(),
    canonical: resolveUrl($('link[rel="canonical"]').attr('href'), url)?.href,
    robots: $('meta[name="robots"]').attr('content'),
    lang: $('html').attr('lang'),
    dir: $('html').attr('dir'),
    restLink: resolveUrl($('link[rel="https://api.w.org/"]').attr('href'), url)?.href,
    shortlink: resolveUrl($('link[rel="shortlink"]').attr('href'), url)?.href,
    wpId: idMatch ? Number(idMatch[1]) : undefined,
    wpKind: wpKind(bodyClasses),
    template,
    theme: /\/wp-content\/themes\/([a-z0-9_-]+)\//i.exec(html)?.[1]?.toLowerCase(),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined && value !== '')
      (analysis as unknown as Record<string, unknown>)[key] = value;
  }
  return analysis;
}

function wpKind(classes: string[]): string | undefined {
  const has = (c: string) => classes.includes(c);
  if (has('error404')) return '404';
  if (has('home') && has('blog')) return 'home-blog';
  if (has('home')) return 'home';
  if (has('search')) return 'search';
  if (has('single-post')) return 'post';
  if (has('attachment')) return 'attachment';
  if (has('page') || classes.some((c) => c.startsWith('page-id-'))) return 'page';
  const single = classes.find((c) => /^single-(?!format)/.test(c));
  if (single) return single.slice('single-'.length);
  if (has('blog')) return 'blog';
  if (has('archive') || has('category') || has('tag')) return 'archive';
  return undefined;
}

/** All visible body text, including header and footer (where contact details usually live). */
function visibleText($: CheerioAPI): string {
  const $clone = $('body').clone();
  $clone.find('script, style, noscript, template').remove();
  return normalizeSpace($clone.text());
}

/** Visible body text without chrome (header, footer, nav) or non-content elements. */
function mainText($: CheerioAPI): string {
  const $clone = $('body').clone();
  $clone
    .find(
      `script, style, noscript, template, svg, iframe, form, nav, ${HEADER_SELECTOR}, ${FOOTER_SELECTOR}`,
    )
    .remove();
  return normalizeSpace($clone.text());
}

function region($el: Cheerio<AnyNode>): Region {
  if ($el.closest(HEADER_SELECTOR).length) return 'header';
  if ($el.closest(FOOTER_SELECTOR).length) return 'footer';
  return 'content';
}

function extractMenus($: CheerioAPI): NavMenu[] {
  const menus: NavMenu[] = [];
  const seen = new Set<string>();
  $('ul').each((_, ul) => {
    const $ul = $(ul);
    const $items = $ul.children('li');
    if ($items.length === 0) return;
    const looksLikeMenu =
      $items.toArray().some((li) => MENU_ITEM_CLASS.test($(li).attr('class') ?? '')) ||
      /menu|nav/i.test(`${$ul.attr('class') ?? ''} ${$ul.attr('id') ?? ''}`);
    if (!looksLikeMenu) return;
    const nested = $ul
      .parents('li')
      .toArray()
      .some((li) => MENU_ITEM_CLASS.test($(li).attr('class') ?? ''));
    if (nested) return;
    const items = parseMenuItems($, $ul);
    if (items.length === 0) return;
    const signature = JSON.stringify(items);
    if (seen.has(signature)) return; // e.g. duplicated desktop/mobile menus
    seen.add(signature);
    const r = region($ul);
    menus.push({ location: r === 'content' ? 'other' : r, selector: describe($ul), items });
  });
  return menus;
}

function parseMenuItems($: CheerioAPI, $ul: Cheerio<Element>): NavItem[] {
  return $ul
    .children('li')
    .toArray()
    .map((li) => {
      const $li = $(li);
      let $a = $li.children('a').first();
      if (!$a.length) $a = $li.children(':not(ul)').find('a').first();
      const $sub = $li.children('ul').first().length
        ? $li.children('ul').first()
        : $li.children(':not(a)').find('ul').first();
      const label = normalizeSpace(
        $a.length ? $a.text() : $li.clone().children('ul').remove().end().text(),
      );
      return {
        label,
        href: $a.attr('href') ?? null,
        children: $sub.length ? parseMenuItems($, $sub as Cheerio<Element>) : [],
      };
    })
    .filter((item) => item.label || item.href);
}

function extractLinks($: CheerioAPI, base: string, siteHosts: readonly string[]): LinkRef[] {
  const links: LinkRef[] = [];
  $('a[href]').each((_, a) => {
    const $a = $(a);
    const resolved = resolveUrl($a.attr('href'), base);
    if (!resolved || !/^https?:$/.test(resolved.protocol)) return;
    const internal = isSiteHost(resolved.hostname, siteHosts);
    links.push({
      href: resolved.href,
      text: normalizeSpace($a.text()) || ($a.attr('aria-label') ?? $a.attr('title') ?? ''),
      internal,
      kind: internal ? classifyPath(resolved) : 'external',
      region: region($a),
    });
  });
  return links;
}

function extractImages($: CheerioAPI, base: string): ImageRef[] {
  const images = new Map<string, ImageRef>();
  $('img').each((_, img) => {
    const $img = $(img);
    const candidates = ['data-src', 'data-lazy-src', 'data-original', 'data-orig-file', 'src'];
    const raw = candidates
      .map((name) => $img.attr(name))
      .find((value) => value && !value.startsWith('data:'));
    const src = resolveUrl(raw, base)?.href;
    if (!src || images.has(src)) return;
    const width = Number($img.attr('width'));
    const height = Number($img.attr('height'));
    const srcset = $img.attr('data-srcset') ?? $img.attr('data-lazy-srcset') ?? $img.attr('srcset');
    images.set(src, {
      src,
      alt: $img.attr('alt') ?? null,
      ...(srcset ? { srcset } : {}),
      ...(Number.isFinite(width) && width > 0 ? { width } : {}),
      ...(Number.isFinite(height) && height > 0 ? { height } : {}),
      region: region($img),
    });
  });
  return [...images.values()];
}

function extractBackgroundImages($: CheerioAPI, base: string): string[] {
  const urls = new Set<string>();
  const add = (value: string | undefined) => {
    const resolved = resolveUrl(value, base)?.href;
    if (resolved && IMAGE_URL.test(new URL(resolved).pathname)) urls.add(resolved);
  };
  const fromCss = (css: string) => {
    for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) add(match[2]);
  };
  $('[style*="url("]').each((_, el) => fromCss($(el).attr('style') ?? ''));
  $('style').each((_, el) => fromCss($(el).text()));
  $('[data-bg], [data-background], [data-bg-image], [data-background-image], [data-img]').each(
    (_, el) => {
      const $el = $(el);
      for (const name of [
        'data-bg',
        'data-background',
        'data-bg-image',
        'data-background-image',
        'data-img',
      ]) {
        const value = $el.attr(name);
        if (!value) continue;
        if (value.includes('url(')) fromCss(value);
        else add(value);
      }
    },
  );
  return [...urls];
}

function extractForms($: CheerioAPI, base: string): FormRef[] {
  return $('form')
    .toArray()
    .map((form) => {
      const $form = $(form);
      const cls = `${$form.attr('class') ?? ''} ${$form.parent().attr('class') ?? ''}`;
      const kind = /wpcf7/.test(cls)
        ? 'contact-form-7'
        : /wpforms/.test(cls)
          ? 'wpforms'
          : /gform/.test(cls)
            ? 'gravity-forms'
            : /elementor-form/.test(cls)
              ? 'elementor'
              : /nf-form|ninja/.test(cls)
                ? 'ninja-forms'
                : $form.attr('role') === 'search' || $form.find('input[name="s"]').length
                  ? 'search'
                  : 'other';
      const fields = $form
        .find('input, select, textarea')
        .toArray()
        .filter((el) => !['hidden', 'submit', 'button'].includes($(el).attr('type') ?? ''))
        .map((el) => `${el.tagName}:${$(el).attr('name') ?? $(el).attr('id') ?? '?'}`);
      const action = resolveUrl($form.attr('action'), base)?.href;
      const id = $form.attr('id');
      return { kind, fields, ...(action ? { action } : {}), ...(id ? { id } : {}) };
    });
}

function extractEmails($: CheerioAPI, text: string): string[] {
  const emails = new Set<string>();
  const add = (value: string | undefined) => {
    const email = value?.trim().toLowerCase();
    if (email && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) && !IMAGE_URL.test(email)) {
      emails.add(email);
    }
  };
  $('a[href^="mailto:" i]').each((_, a) => {
    const target = decodeURIComponent(($(a).attr('href') ?? '').slice('mailto:'.length)).split(
      '?',
    )[0];
    target?.split(',').forEach(add);
  });
  $('[data-cfemail]').each((_, el) => add(decodeCfEmail($(el).attr('data-cfemail') ?? '')));
  $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, a) => {
    const hash = ($(a).attr('href') ?? '').split('#')[1];
    if (hash) add(decodeCfEmail(hash));
  });
  for (const match of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) add(match[0]);
  return [...emails].sort();
}

function extractPhones($: CheerioAPI, text: string): string[] {
  const phones = new Set<string>();
  $('a[href^="tel:" i]').each((_, a) => {
    const value = decodeURIComponent(($(a).attr('href') ?? '').slice('tel:'.length)).trim();
    if (value) phones.add(value);
  });
  const patterns = [
    /(?:\+|00)\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}/g,
    /\(?\b0\d{1,2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) phones.add(normalizeSpace(match[0]));
  }
  return [...phones].sort();
}

function describe($el: Cheerio<AnyNode>): string {
  const el = $el.get(0) as Element | undefined;
  if (!el) return '';
  const id = el.attribs['id'] ? `#${el.attribs['id']}` : '';
  const cls = (el.attribs['class'] ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((c) => `.${c}`)
    .join('');
  return `${el.tagName}${id}${cls}`;
}

export function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
