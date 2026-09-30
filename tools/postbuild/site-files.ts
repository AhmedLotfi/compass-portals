/**
 * Crawler-facing files generated from the content snapshot: sitemap.xml, robots.txt, and llms.txt /
 * llms-full.txt (https://llmstxt.org) for AI assistants. Everything in them is the site's own text;
 * the few structural labels come from the microcopy file.
 */
import type { PageDoc, RouteEntry, Site } from '../../schema/content.ts';
import { mediaHref, pageToMarkdown } from './markdown.ts';

export interface SiteContent {
  site: Site;
  /** Route index, in the sync's order. */
  routes: RouteEntry[];
  pages: Map<string, PageDoc>;
  /** The reviewed microcopy (core/copy/microcopy.en.json). */
  copy: Record<string, string>;
}

function xml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Pages search engines may index: every route whose page isn't marked noindex. */
export function indexableRoutes(content: SiteContent): RouteEntry[] {
  return content.routes.filter((route) => !content.pages.get(route.id)?.seo.noindex);
}

export function pageUrl(site: Site, path: string): string {
  return new URL(path, site.origin).href;
}

export function sitemapXml(content: SiteContent): string {
  const { site, pages } = content;
  const urls = indexableRoutes(content).map((route) => {
    const page = pages.get(route.id);
    // WordPress stores local time without a zone, so only the date is certain.
    const lastmod = /^\d{4}-\d{2}-\d{2}/.exec(route.modified ?? '')?.[0];
    const images = [
      ...new Set(
        Object.values(page?.media ?? {})
          .filter((media) => media.alt)
          .map((media) => mediaHref(media, site.origin)),
      ),
    ];
    return [
      '  <url>',
      `    <loc>${xml(pageUrl(site, route.path))}</loc>`,
      ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
      ...images.flatMap((src) => [
        '    <image:image>',
        `      <image:loc>${xml(src)}</image:loc>`,
        '    </image:image>',
      ]),
      '  </url>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

export function robotsTxt(site: Site): string {
  return ['User-agent: *', 'Disallow:', '', `Sitemap: ${pageUrl(site, '/sitemap.xml')}`, ''].join(
    '\n',
  );
}

interface Outline {
  /** Top-level pages that have children, each with its subtree (in route order). */
  groups: { head: RouteEntry; members: RouteEntry[] }[];
  /** Everything else, home first. */
  rest: RouteEntry[];
}

function outline(content: SiteContent): Outline {
  const routes = indexableRoutes(content);
  const childrenOf = (id: string) => routes.filter((route) => route.parentId === id);
  const subtree = (id: string): RouteEntry[] =>
    childrenOf(id).flatMap((child) => [child, ...subtree(child.id)]);
  const home = routes.find((route) => route.path === '/');
  const top = routes.filter((route) =>
    home ? route.parentId === home.id : route.parentId === null,
  );
  const groups = top
    .filter((route) => childrenOf(route.id).length)
    .map((head) => ({ head, members: [head, ...subtree(head.id)] }));
  const grouped = new Set(groups.flatMap((group) => group.members.map((route) => route.id)));
  const rest = routes
    .filter((route) => !grouped.has(route.id))
    .sort((a, b) => Number(b.path === '/') - Number(a.path === '/'));
  return { groups, rest };
}

/** Site name, tagline, the home page's own description and the contact details. */
function preamble(content: SiteContent): string[] {
  const { site, pages, copy } = content;
  const home = content.routes.find((route) => route.path === '/');
  const homePage = home ? pages.get(home.id) : undefined;
  const about = homePage?.seo.description ?? home?.summary;
  const summary = site.tagline ?? about;
  const contact = [
    ...site.contact.phones.map((phone) => `- ${copy['phone']}: ${phone.display}`),
    ...site.contact.emails.map((email) => `- ${copy['email']}: ${email}`),
    ...(site.contact.address.length
      ? [`- ${copy['address']}: ${site.contact.address.join(', ')}`]
      : []),
  ];
  return [
    `# ${site.name}`,
    ...(summary ? [`> ${summary}`] : []),
    ...(about && about !== summary ? [about] : []),
    ...(contact.length ? [contact.join('\n')] : []),
  ];
}

export function llmsTxt(content: SiteContent): string {
  const { site, copy } = content;
  const item = (route: RouteEntry) => {
    const link = `[${route.title}](${pageUrl(site, route.path)})`;
    return `- ${route.summary ? `${link}: ${route.summary}` : link}`;
  };
  const { groups, rest } = outline(content);
  const sections = [
    ...groups.map((group) => [`## ${group.head.title}`, group.members.map(item).join('\n')]),
    ...(rest.length ? [[`## ${copy['llmsPages']}`, rest.map(item).join('\n')]] : []),
    ['## Optional', `- [${copy['llmsFullText']}](${pageUrl(site, '/llms-full.txt')})`],
  ];
  return `${[...preamble(content), ...sections.flat()].join('\n\n')}\n`;
}

export function llmsFullTxt(content: SiteContent): string {
  const { groups, rest } = outline(content);
  const isHome = (route: RouteEntry) => route.path === '/';
  const ordered = [
    ...rest.filter(isHome),
    ...groups.flatMap((group) => group.members),
    ...rest.filter((route) => !isHome(route)),
  ];
  const pages = ordered
    .map((route) => content.pages.get(route.id))
    .filter((page): page is PageDoc => Boolean(page))
    .map((page) => pageToMarkdown(page, content.site.origin));
  return `${[...preamble(content), ...pages].join('\n\n')}\n`;
}
