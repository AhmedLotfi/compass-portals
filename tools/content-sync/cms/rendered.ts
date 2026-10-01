/**
 * The pages as the live site's front end rendered them (content:render). The content itself comes
 * from the API; these supply what only the front end holds: the header and footer, the labels the
 * front end prints around the API data ("Our Team", "Request Your Demo"), and pages the API has no
 * record for (the privacy policy).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load, type CheerioAPI } from 'cheerio';
import { normalizeSpace } from '../analyze.ts';
import { comparable } from '../normalize/sentences.ts';

interface RenderedIndex {
  origin: string;
  pages: { url: string; finalUrl: string; status: number; file: string }[];
}

export interface RenderedPage {
  url: string;
  $: CheerioAPI;
  /** Visible text, comparable form, for label checks. */
  text: string;
}

export class RenderedSite {
  private readonly cache = new Map<string, RenderedPage>();
  private readonly dir: string;
  private readonly index: RenderedIndex;

  private constructor(dir: string, index: RenderedIndex) {
    this.dir = dir;
    this.index = index;
  }

  static async open(dir: string): Promise<RenderedSite> {
    const index = JSON.parse(
      await readFile(path.join(dir, 'manifest.json'), 'utf8'),
    ) as RenderedIndex;
    return new RenderedSite(dir, index);
  }

  get origin(): string {
    return this.index.origin;
  }

  /** The rendered page at a path of the old site (`/about`), or the first one under a prefix. */
  async page(pathname: string, { prefix = false } = {}): Promise<RenderedPage> {
    const key = `${prefix ? '^' : '='}${pathname}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const entry = [...this.index.pages]
      .sort((a, b) => a.url.localeCompare(b.url))
      .find((p) => {
        if (p.status !== 200) return false;
        const actual = decodeURIComponent(new URL(p.url).pathname);
        return prefix ? actual.startsWith(pathname) : actual === pathname;
      });
    if (!entry) throw new Error(`No rendered page for ${pathname} in the archive`);
    const html = await readFile(path.join(this.dir, entry.file), 'utf8');
    const $ = load(html, { scriptingEnabled: false, baseURI: entry.url });
    $('script, style, svg, template').remove();
    const page = { url: entry.url, $, text: comparable($('app-root').text()) };
    this.cache.set(key, page);
    return page;
  }

  /**
   * A label exactly as the front end prints it on that page. Fails the sync when the live site
   * doesn't show it, so no label in the snapshot is invented.
   */
  async label(pathname: string, label: string, options?: { prefix?: boolean }): Promise<string> {
    const page = await this.page(pathname, options);
    if (!page.text.includes(comparable(label)))
      throw new Error(`"${label}" is not on the rendered ${pathname} page`);
    return label;
  }
}

export interface Chrome {
  /** The front end's top bar, e.g. "Compass International · Business-driven technology". */
  topbar: string;
  logo?: { src: string; alt: string };
  header: { label: string; href: string }[];
  footerGroups: { title: string; links: { label: string; href: string }[] }[];
  footerLinks: { label: string; href: string }[];
  copyright?: string;
  social: string[];
}

/** Header, footer and logo from the rendered home page. */
export function readChrome(page: RenderedPage): Chrome {
  const { $ } = page;
  const text = (el: Parameters<CheerioAPI>[0]) => normalizeSpace($(el).text());
  const header = $('app-header').first();
  const logoImg = header.find('nav img').first();
  const links = (scope: ReturnType<CheerioAPI>) =>
    scope
      .find('a[href]')
      .toArray()
      .map((a) => ({
        // The front end ends some labels with a decorative arrow (aria-hidden) or a " |" separator.
        label: normalizeSpace(
          $(a).clone().find('[aria-hidden="true"]').remove().end().text(),
        ).replace(/\s*\|$/, ''),
        href: $(a).attr('href')!,
      }))
      .filter((link) => link.label);
  const footer = $('app-footer').first();
  const footerGroups = footer
    .find('.footer-single-col')
    .toArray()
    .filter((col) => $(col).children('h3').length)
    .map((col) => ({ title: text($(col).children('h3')), links: links($(col).find('ul')) }));
  const grouped = new Set(footerGroups.flatMap((g) => g.links.map((l) => l.href)));
  const social = footer
    .find('a[href^="http"]')
    .toArray()
    .map((a) => $(a).attr('href')!)
    .filter((href) => !/compassint\.org/i.test(new URL(href).hostname));
  const copyright = footer
    .find('p, span, div')
    .toArray()
    .map((el) => text(el))
    .find((t) => /©|all rights reserved/i.test(t) && t.length < 120);
  const src = logoImg.attr('src');
  return {
    topbar: text(header.find('.compass-topbar span').first()),
    ...(src ? { logo: { src, alt: logoImg.attr('alt')?.trim() ?? '' } } : {}),
    header: links(header.find('#compass-menu')),
    footerGroups,
    footerLinks: links(footer)
      .filter((l) => !grouped.has(l.href) && l.href.startsWith('/'))
      .filter((l, i, all) => all.findIndex((o) => o.href === l.href) === i),
    ...(copyright ? { copyright } : {}),
    social: [...new Set(social)],
  };
}
