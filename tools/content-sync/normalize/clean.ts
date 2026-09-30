import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { decodeCfEmail } from '../cfemail.ts';

/** Where the page's own content lives, most specific first (builders, themes, then landmarks). */
const CONTENT_ROOTS = [
  '[data-elementor-type="wp-page"]',
  '[data-elementor-type="wp-post"]',
  '[data-elementor-type="single-page"]',
  '[data-elementor-type="single-post"]',
  '[data-elementor-type="single"]',
  '.entry-content',
  '.page-content',
  '#et-main-area .et_pb_section',
  'main',
  '#main',
  '[role="main"]',
  '#primary',
  '#content',
  '.site-content',
];

/** Site chrome (not article headers such as `.entry-header`, which hold the page title). */
export const SITE_CHROME =
  'nav, #masthead, .site-header, #colophon, .site-footer, body > header, body > footer, #page > header, #page > footer, .site > header, .site > footer, [data-elementor-type="header"], [data-elementor-type="footer"], [data-elementor-type="popup"]';

/** Builder classes that hide an element on desktop: the desktop rendering is the reference. */
const HIDDEN_ON_DESKTOP =
  '.elementor-hidden-desktop, .elementor-hidden-widescreen, .vc_hidden-lg, .et_pb_section_hidden_desktop, .et_pb_hidden_desktop, .hidden-desktop, .fusion-no-large-visibility';

const CAROUSEL_CLONES = '.slick-cloned, .swiper-slide-duplicate, .owl-item.cloned, .rs-clone';

const DECORATIVE =
  'script, style, link, meta, template, [hidden], [aria-hidden="true"], .screen-reader-text, .sr-only, .elementor-screen-only, .elementor-background-overlay, .elementor-shape, .rs-bg-elem';

export function contentRoot($: CheerioAPI): Cheerio<Element> {
  for (const selector of CONTENT_ROOTS) {
    const candidates = ($(selector) as Cheerio<Element>).filter(
      (_, el) => $(el).closest(SITE_CHROME).length === 0,
    );
    if (candidates.length === 1) return candidates.first();
    if (candidates.length > 1 && selector.startsWith('#et-main-area')) {
      return $('#et-main-area').first();
    }
    if (candidates.length > 1) {
      // Several matches (e.g. an article list): use their common parent.
      return candidates.first().parent() as Cheerio<Element>;
    }
  }
  const $body = $('body').clone();
  $body.find(SITE_CHROME).remove();
  return $body as unknown as Cheerio<Element>;
}

/** Icon name from Font Awesome / Elementor SVG icon classes, e.g. `fas fa-check` → `check`. */
export function iconName(className: string): string | undefined {
  const match =
    /\be-(?:fas|far|fab)-([a-z0-9-]+)/.exec(className) ??
    /\bfa-(?!solid|regular|brands|light|thin|duotone|fw|lg|xs|sm|[0-9]x\b)([a-z0-9-]+)/.exec(
      className,
    ) ??
    /\b(?:eicon|ti|la|lnr|dashicons)-([a-z0-9-]+)/.exec(className);
  return match?.[1];
}

/**
 * Cleans a content root in place so only the visitor-visible desktop content remains, with lazy
 * images resolved, obfuscated emails decoded, and icon names kept as `data-icon` on their owners.
 */
export function cleanContent($: CheerioAPI, root: Cheerio<Element>): void {
  // Lazy-loading: promote the real image URLs.
  root.find('img').each((_, img) => {
    const $img = $(img);
    const real = ['data-src', 'data-lazy-src', 'data-original', 'data-orig-file']
      .map((name) => $img.attr(name))
      .find((value) => value && !value.startsWith('data:'));
    if (real) $img.attr('src', real);
    const srcset = $img.attr('data-srcset') ?? $img.attr('data-lazy-srcset');
    if (srcset) $img.attr('srcset', srcset);
  });
  // Lazy loaders often add a <noscript> copy next to the real image: drop the copy, keep lone ones.
  root.find('noscript').each((_, el) => {
    const $el = $(el);
    if ($el.prev('img').length || $el.parent().find('img').not($el.find('img')).length)
      $el.remove();
    else $el.replaceWith($el.contents());
  });

  // Icons: remember the name on the nearest owner, then drop the glyph.
  root.find('i[class], svg[class]').each((_, el) => {
    const $el = $(el);
    const name = iconName($el.attr('class') ?? '');
    if (!name) return;
    const owner = $el.closest(
      'li, .elementor-icon-box-wrapper, .elementor-image-box-wrapper, .elementor-widget, .vc_column-inner, .et_pb_module, a',
    );
    if (owner.length && !owner.attr('data-icon')) owner.attr('data-icon', name);
    $el.remove();
  });
  root.find('svg').remove();

  // Cloudflare email obfuscation.
  root.find('[data-cfemail]').each((_, el) => {
    const email = decodeCfEmail($(el).attr('data-cfemail') ?? '');
    if (email) $(el).replaceWith(email);
  });
  root.find('a[href*="/cdn-cgi/l/email-protection"]').each((_, a) => {
    const hash = ($(a).attr('href') ?? '').split('#')[1];
    const email = hash ? decodeCfEmail(hash) : undefined;
    if (email) $(a).attr('href', `mailto:${email}`);
  });

  root.find(`${CAROUSEL_CLONES}, ${HIDDEN_ON_DESKTOP}, ${DECORATIVE}`).remove();
  root.find('[style]').each((_, el) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(el).attr('style') ?? ''))
      $(el).remove();
  });
}
