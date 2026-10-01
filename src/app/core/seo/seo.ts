import { DOCUMENT, inject, Injectable, Service } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import {
  TitleStrategy,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';
import type { PageDoc } from '@schema/content';
import { ContentStore } from '../content/content';
import { copy } from '../copy/copy';
import { DIRECTION, type LangCode } from '../i18n/lang';
import { buildGraph, mediaUrl, plainText } from './json-ld';

const MAX_DESCRIPTION = 155;
const LOCALE: Record<LangCode, string> = { en: 'en_US', ar: 'ar_AE' };
/** Let search engines show large image previews and full snippets of the site's text. */
const INDEXABLE = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';

/** Search results cut titles near 70 characters: past that, the page's own title stands alone. */
const MAX_TITLE = 70;

export function withSiteName(title: string, siteName: string): string {
  const full = `${title} | ${siteName}`;
  return full.length <= MAX_TITLE ? full : title;
}

/** First sentence(s) of the page's own text, verbatim, within the description length. */
export function describe(page: PageDoc): string | undefined {
  const text =
    page.hero.lede ??
    page.sections
      .flatMap((s) => s.blocks)
      .map((b) => (b.type === 'richText' ? plainText(b.html) : ''))
      .find(Boolean);
  if (!text) return undefined;
  if (text.length <= MAX_DESCRIPTION) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let out = '';
  for (const sentence of sentences) {
    if ((out + sentence).trim().length > MAX_DESCRIPTION) break;
    out += sentence;
  }
  return out.trim() || undefined;
}

/** Writes the document head for a page: title, description, canonical, Open Graph, Twitter, JSON-LD. */
@Service()
export class SeoService {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly content = inject(ContentStore);

  update(page: PageDoc | undefined, notFound: boolean): void {
    const site = this.content.site;
    const lang = page?.lang ?? 'en';
    const html = this.document.documentElement;
    html.lang = lang;
    html.dir = DIRECTION[lang];

    const home = !page?.breadcrumbs.length;
    const title = page
      ? (page.seo.title ?? (home ? site.name : withSiteName(page.title, site.name)))
      : `${copy('notFoundTitle')} | ${site.name}`;
    const description = page
      ? (page.seo.description ?? describe(page) ?? this.content.tagline(lang))
      : undefined;
    const url = page && !notFound ? new URL(page.path, site.origin).href : undefined;
    // An Arabic page that only repeats the English names the English page as canonical.
    const canonical = page?.seo.canonical ? new URL(page.seo.canonical, site.origin).href : url;
    const imageId = page?.seo.image ?? page?.hero.media;
    const image = imageId ? page?.media[imageId] : undefined;
    const imageUrl = image ? mediaUrl(site, image, 'og') : `${site.origin}/icons/icon-512.png`;

    this.title.setTitle(title);
    this.set('name', 'description', description);
    this.set('name', 'robots', notFound || page?.seo.noindex ? 'noindex, follow' : INDEXABLE);
    this.set('property', 'og:type', 'website');
    this.set('property', 'og:site_name', site.name);
    this.set('property', 'og:locale', LOCALE[lang]);
    const other = page?.alternates?.[lang === 'en' ? 'ar' : 'en'];
    this.set(
      'property',
      'og:locale:alternate',
      other ? LOCALE[lang === 'en' ? 'ar' : 'en'] : undefined,
    );
    this.set('property', 'og:title', page?.seo.title ?? page?.title ?? title);
    this.set('property', 'og:description', description);
    this.set('property', 'og:url', url);
    this.set('property', 'og:image', imageUrl);
    this.set('property', 'og:image:alt', image?.alt || undefined);
    this.set('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    this.set('name', 'twitter:title', page?.seo.title ?? page?.title ?? title);
    this.set('name', 'twitter:description', description);
    this.set('name', 'twitter:image', imageUrl);
    this.setCanonical(canonical);
    this.setAlternates(notFound ? undefined : page?.alternates);
    this.setJsonLd(notFound ? undefined : buildGraph(site, page, description));
  }

  private set(attr: 'name' | 'property', key: string, value: string | undefined): void {
    const selector = `${attr}="${key}"`;
    if (value) this.meta.updateTag({ [attr]: key, content: value }, selector);
    else this.meta.removeTag(selector);
  }

  private setCanonical(url: string | undefined): void {
    let link = this.document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!url) {
      link?.remove();
      return;
    }
    if (!link) {
      link = this.document.createElement('link');
      link.rel = 'canonical';
      this.document.head.appendChild(link);
    }
    link.href = url;
  }

  /** hreflang links for a page and its translation (both ways), with English as x-default. */
  private setAlternates(alternates: Partial<Record<LangCode, string>> | undefined): void {
    for (const link of this.document.head.querySelectorAll('link[rel="alternate"][hreflang]'))
      link.remove();
    if (!alternates?.en || !alternates.ar) return;
    const origin = this.content.site.origin;
    const links: [string, string][] = [
      ['en', alternates.en],
      ['ar', alternates.ar],
      ['x-default', alternates.en],
    ];
    for (const [hreflang, path] of links) {
      const link = this.document.createElement('link');
      link.rel = 'alternate';
      link.hreflang = hreflang;
      link.href = new URL(path, origin).href;
      this.document.head.appendChild(link);
    }
  }

  private setJsonLd(graph: Record<string, unknown> | undefined): void {
    let script = this.document.head.querySelector<HTMLScriptElement>('script#ld');
    if (!graph) {
      script?.remove();
      return;
    }
    if (!script) {
      script = this.document.createElement('script');
      script.id = 'ld';
      script.type = 'application/ld+json';
      this.document.head.appendChild(script);
    }
    // Escape "<" so page text can never close the script element.
    script.textContent = JSON.stringify(graph).replace(/</g, '\\u003c');
  }
}

/** Applies SEO for the deepest route on every navigation (and during prerendering). */
@Injectable()
export class SeoTitleStrategy extends TitleStrategy {
  private readonly seo = inject(SeoService);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    let route: ActivatedRouteSnapshot = snapshot.root;
    while (route.firstChild) route = route.firstChild;
    this.seo.update(route.data['page'] as PageDoc | undefined, Boolean(route.data['notFound']));
  }
}
