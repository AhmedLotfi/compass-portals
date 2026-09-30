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
import { buildGraph, mediaUrl, plainText } from './json-ld';

const MAX_DESCRIPTION = 155;

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
    const language = site.languages[0] ?? { code: 'en', dir: 'ltr' as const };
    const html = this.document.documentElement;
    html.lang = language.code;
    html.dir = language.dir;

    const title = page
      ? (page.seo.title ?? (page.path === '/' ? site.name : `${page.title} | ${site.name}`))
      : `${copy('notFoundTitle')} | ${site.name}`;
    const description = page ? (page.seo.description ?? describe(page) ?? site.tagline) : undefined;
    const url = page && !notFound ? new URL(page.path, site.origin).href : undefined;
    const imageId = page?.seo.image ?? page?.hero.media;
    const image = imageId ? page?.media[imageId] : undefined;
    const imageUrl = image ? mediaUrl(site, image, 'og') : `${site.origin}/icons/icon-512.png`;

    this.title.setTitle(title);
    this.set('name', 'description', description);
    this.set('name', 'robots', notFound || page?.seo.noindex ? 'noindex, follow' : 'index, follow');
    this.set('property', 'og:type', 'website');
    this.set('property', 'og:site_name', site.name);
    this.set('property', 'og:locale', language.code === 'ar' ? 'ar_AE' : 'en_US');
    this.set('property', 'og:title', page?.seo.title ?? page?.title ?? title);
    this.set('property', 'og:description', description);
    this.set('property', 'og:url', url);
    this.set('property', 'og:image', imageUrl);
    this.set('property', 'og:image:alt', image?.alt || undefined);
    this.set('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    this.set('name', 'twitter:title', page?.seo.title ?? page?.title ?? title);
    this.set('name', 'twitter:description', description);
    this.set('name', 'twitter:image', imageUrl);
    this.setCanonical(url);
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
