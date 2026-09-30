import { load } from 'cheerio';
import type { PageDoc, Provenance } from '../../schema/content.ts';
import { normalizeSpace } from './analyze.ts';
import type { MediaRegistry } from './media.ts';
import { toAtoms } from './normalize/atoms.ts';
import { cleanContent, contentRoot, SITE_CHROME } from './normalize/clean.ts';
import type { LinkResolver } from './normalize/sanitize.ts';
import { blockText } from './normalize/sentences.ts';
import { shapePage } from './normalize/shape.ts';
import type { RouteDraft } from './routes.ts';

/** A page as normalized from its own HTML; breadcrumbs, children and media are added by the sync. */
export type PageDraft = Omit<PageDoc, 'breadcrumbs' | 'children' | 'media'>;

export interface NormalizedPage {
  doc: PageDraft;
  /** Visible text of the page's content area (block breaks kept), the reference for coverage. */
  sourceText: string;
}

export function seoPlugin(html: string): Provenance {
  if (/optimized with the Yoast SEO|yoast-schema-graph/i.test(html)) return 'yoast';
  if (/Search Engine Optimization by Rank Math|rank-math-schema/i.test(html)) return 'rankmath';
  return 'page';
}

export function normalizePage(
  route: RouteDraft,
  html: string,
  resolve: LinkResolver,
  media: MediaRegistry,
): NormalizedPage {
  const url = route.page.finalUrl;
  const $ = load(html, { scriptingEnabled: false, baseURI: url });

  const plugin = seoPlugin(html);
  const title = normalizeSpace($('title').first().text());
  const description = $('meta[name="description"]').attr('content')?.trim();
  const ogImage = $('meta[property="og:image"]').attr('content');
  const noindex = /noindex/i.test($('meta[name="robots"]').attr('content') ?? '');

  const root = contentRoot($);
  const rootEl = root.get(0)!;
  // Themes often print the page title in their own header, outside the content area.
  const themeH1 = normalizeSpace(
    $('h1')
      .filter(
        (_, el) => $(el).closest(SITE_CHROME).length === 0 && $(el).closest(root).length === 0,
      )
      .first()
      .text(),
  );

  cleanContent($, root);
  // Read the reference text now: atomization rearranges figures while it walks the tree.
  const contentText = blockText(rootEl);
  const atoms = toAtoms($, rootEl);

  const pageRef = { id: route.id, url };
  const shaped = shapePage(
    atoms,
    {
      resolveLink: resolve,
      registerImage: (image, context) => media.register(image, pageRef, context),
    },
    themeH1 || route.title,
  );
  const seoImage = ogImage
    ? media.register({ src: ogImage, alt: null }, pageRef, shaped.hero.title)
    : undefined;

  const wp = route.page.rest;
  const doc: PageDraft = {
    id: route.id,
    kind: route.kind,
    path: route.path,
    title: route.title,
    sourceUrl: url,
    ...(wp
      ? { wp: { type: wp.type, id: wp.id, ...(wp.modified ? { modified: wp.modified } : {}) } }
      : {}),
    seo: {
      ...(title ? { title, titleSource: plugin } : {}),
      ...(description ? { description, descriptionSource: plugin } : {}),
      ...(seoImage ? { image: seoImage } : {}),
      ...(noindex ? { noindex } : {}),
    },
    hero: shaped.hero,
    sections: shaped.sections,
  };
  return {
    doc,
    sourceText: [shaped.heroFromContent ? '' : themeH1, contentText].join('\n'),
  };
}
