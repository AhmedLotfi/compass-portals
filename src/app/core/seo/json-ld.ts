import type { MediaRef, PageDoc, Site } from '@schema/content';

/** Public URL of an image variant suitable for structured data and link previews. */
export function mediaUrl(
  site: Site,
  media: MediaRef | undefined,
  variant: 'full' | 'og' = 'full',
): string | undefined {
  if (!media) return undefined;
  if (media.svg) return `${site.origin}/media/${media.id}.svg`;
  return `${site.origin}/media/${media.id}${variant === 'og' ? '-og.jpg' : '.webp'}`;
}

export function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function pageType(page: PageDoc): string {
  switch (page.kind) {
    case 'contact':
      return 'ContactPage';
    case 'product-index':
    case 'product-category':
    case 'service-index':
      return 'CollectionPage';
    default:
      return /\/about/i.test(page.path) ? 'AboutPage' : 'WebPage';
  }
}

/** One JSON-LD `@graph` per page. Only facts that are on the site; no invented offers or ratings. */
export function buildGraph(
  site: Site,
  page: PageDoc | undefined,
  description?: string,
): Record<string, unknown> {
  const origin = site.origin;
  const orgId = `${origin}/#organization`;
  const websiteId = `${origin}/#website`;
  const language = site.languages[0]?.code ?? 'en';
  const logo = site.logo ? site.media[site.logo] : undefined;

  const organization: Record<string, unknown> = {
    '@type': 'Organization',
    '@id': orgId,
    name: site.name,
    url: `${origin}/`,
    ...(logo
      ? {
          logo: {
            '@type': 'ImageObject',
            url: mediaUrl(site, logo),
            width: logo.width,
            height: logo.height,
          },
        }
      : {}),
    ...(site.contact.emails[0] ? { email: site.contact.emails[0] } : {}),
    ...(site.contact.phones[0]
      ? { telephone: site.contact.phones[0].tel.replace(/^tel:/, '') }
      : {}),
    ...(site.contact.address.length
      ? { address: { '@type': 'PostalAddress', streetAddress: site.contact.address.join(', ') } }
      : {}),
    ...(site.social.length ? { sameAs: site.social.map((s) => s.url) } : {}),
  };
  const website = {
    '@type': 'WebSite',
    '@id': websiteId,
    url: `${origin}/`,
    name: site.name,
    ...(site.tagline ? { description: site.tagline } : {}),
    publisher: { '@id': orgId },
    inLanguage: language,
  };
  const graph: Record<string, unknown>[] = [organization, website];

  if (page) {
    const url = new URL(page.path, origin).href;
    const image = page.hero.media ? page.media[page.hero.media] : undefined;
    graph.push({
      '@type': pageType(page),
      '@id': `${url}#webpage`,
      url,
      name: page.title,
      ...(description ? { description } : {}),
      isPartOf: { '@id': websiteId },
      inLanguage: language,
      ...(image
        ? { primaryImageOfPage: { '@type': 'ImageObject', url: mediaUrl(site, image) } }
        : {}),
      ...(page.wp?.modified ? { dateModified: page.wp.modified } : {}),
      ...(page.breadcrumbs.length > 1 ? { breadcrumb: { '@id': `${url}#breadcrumb` } } : {}),
    });
    if (page.breadcrumbs.length > 1) {
      graph.push({
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: page.breadcrumbs.map((crumb, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: crumb.label,
          item: new URL(crumb.path, origin).href,
        })),
      });
    }
    if (page.kind === 'product') {
      const features = page.sections
        .flatMap((s) => s.blocks)
        .flatMap((b) => (b.type === 'featureList' ? b.items.map((i) => plainText(i.html)) : []))
        .filter(Boolean);
      graph.push({
        '@type': 'SoftwareApplication',
        '@id': `${url}#software`,
        name: page.title,
        url,
        applicationCategory: 'BusinessApplication',
        ...(description ? { description } : {}),
        ...(image ? { image: mediaUrl(site, image) } : {}),
        ...(features.length ? { featureList: features } : {}),
        publisher: { '@id': orgId },
      });
    }
    if (page.kind === 'service') {
      graph.push({
        '@type': 'Service',
        '@id': `${url}#service`,
        name: page.title,
        url,
        ...(description ? { description } : {}),
        provider: { '@id': orgId },
      });
    }
    if (page.children.length) {
      graph.push({
        '@type': 'ItemList',
        '@id': `${url}#children`,
        itemListElement: page.children.map((child, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: new URL(child.path, origin).href,
          name: child.title,
        })),
      });
    }
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}
