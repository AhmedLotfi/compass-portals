import { load } from 'cheerio';
import type { NavItem, Site } from '../../schema/content.ts';
import type { NavItem as SourceNavItem } from './analyze.ts';
import { normalizeSpace } from './analyze.ts';
import type { Inventory } from './discover.ts';
import type { MediaRegistry } from './media.ts';
import type { LinkResolver } from './normalize/sanitize.ts';
import { blockText } from './normalize/sentences.ts';

const SOCIAL: [RegExp, string][] = [
  [/(^|\.)facebook\.com$/, 'facebook'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)(twitter|x)\.com$/, 'x'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)youtube\.com$|^youtu\.be$/, 'youtube'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)snapchat\.com$/, 'snapchat'],
  [/(^|\.)wa\.me$|(^|\.)whatsapp\.com$/, 'whatsapp'],
];

/** Lines that read like a postal address (verbatim; flagged for review in the sync report). */
const ADDRESS_HINT =
  /\b(tower|building|street|st\.|road|rd\.|floor|office|suite|p\.?\s?o\.?\s?box|dubai|abu dhabi|sharjah|ajman|u\.?a\.?e\.?|united arab emirates|business bay|sheikh zayed)\b/i;

export interface SiteInput {
  inventory: Inventory;
  homeHtml: string;
  homeUrl: string;
  resolve: LinkResolver;
  media: MediaRegistry;
  origin: string;
  source: string;
  syncedAt: string;
}

export function buildSite(
  input: SiteInput,
): Omit<Site, 'snapshot'> & { snapshot: Site['snapshot'] } {
  const { inventory, homeHtml, homeUrl, resolve, media } = input;
  const $ = load(homeHtml, { scriptingEnabled: false, baseURI: homeUrl });
  const probe = inventory.probe;
  const siteRef = { id: 'site', url: homeUrl };

  const ogSiteName = $('meta[property="og:site_name"]').attr('content')?.trim();
  const titleParts = normalizeSpace($('title').text()).split(/\s[|–—-]\s/);
  const name = probe.rest?.name?.trim() || ogSiteName || titleParts[titleParts.length - 1] || '';
  const description = probe.rest?.description?.trim();
  const tagline =
    description && !/just another wordpress site/i.test(description) ? description : undefined;

  const header = $('header, [data-elementor-type="header"], #masthead, .site-header').first();
  const logoImg =
    header
      .find('img')
      .filter((_, img) =>
        /logo/i.test(
          `${$(img).attr('class')} ${$(img).attr('id')} ${$(img).attr('src')} ${$(img).attr('alt')} ${$(img).parent().attr('class')}`,
        ),
      )
      .first()
      .get(0) ?? header.find('img').first().get(0);
  const logo = logoImg
    ? media.register(
        {
          src: $(logoImg).attr('data-src') ?? $(logoImg).attr('src') ?? '',
          srcset: $(logoImg).attr('srcset'),
          alt: $(logoImg).attr('alt') ?? null,
        },
        siteRef,
        name,
      )
    : undefined;
  const icon = probe.rest?.siteIcon
    ? media.register({ src: probe.rest.siteIcon, alt: '' }, siteRef)
    : undefined;

  const toNav = (items: SourceNavItem[]): NavItem[] =>
    items
      .filter((item) => item.label)
      .map((item) => {
        const target = item.href ? resolve(item.href) : { href: '#', kind: 'internal' as const };
        return {
          label: item.label,
          href: target.href,
          external: target.kind === 'external',
          children: toNav(item.children),
        };
      });

  const footerEl = $('footer, [data-elementor-type="footer"], #colophon, .site-footer').last();
  const footerLines = footerEl.length
    ? blockText(footerEl.get(0)!).split('\n').map(normalizeSpace).filter(Boolean)
    : [];

  const siteDomains = new Set([new URL(input.source).hostname.replace(/^www\./, '')]);
  const emails = Object.entries(inventory.contacts.emails)
    .sort(([a, pa], [b, pb]) => {
      const own = (e: string) => (siteDomains.has(e.split('@')[1] ?? '') ? 0 : 1);
      return own(a) - own(b) || pb.length - pa.length || a.localeCompare(b);
    })
    .map(([email]) => email);

  const phoneForms = new Map<string, { display: string; count: number }>();
  for (const [raw, onPages] of Object.entries(inventory.contacts.phones)) {
    const digits = raw.replace(/[^\d+]/g, '').replace(/^00/, '+');
    if (digits.replace(/\D/g, '').length < 7) continue;
    const key = digits.replace(/\D/g, '');
    const existing = phoneForms.get(key);
    // Prefer the human-formatted variant (with spaces) as the display form.
    if (!existing || (raw.includes(' ') && !existing.display.includes(' '))) {
      phoneForms.set(key, { display: raw, count: (existing?.count ?? 0) + onPages.length });
    } else {
      existing.count += onPages.length;
    }
  }
  const phones = [...phoneForms.entries()]
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([key, { display }]) => ({
      display,
      tel: `tel:${display.trim().startsWith('+') || display.startsWith('00') ? '+' : ''}${key}`,
    }));

  const address = [
    ...new Set(
      footerLines.filter(
        (line) => ADDRESS_HINT.test(line) && line.length < 160 && !/@|©/.test(line),
      ),
    ),
  ];

  const allLinks = inventory.pages.flatMap((p) => p.analysis?.links ?? []);
  const allFrames = inventory.pages.flatMap((p) => p.analysis?.iframes ?? []);
  const mapUrl =
    allLinks.find((l) => /google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(l.href))
      ?.href ?? allFrames.find((src) => /google\.[a-z.]+\/maps/i.test(src));

  const social = new Map<string, string>();
  for (const link of allLinks) {
    if (link.internal || link.region === 'content') continue;
    const host = new URL(link.href).hostname.replace(/^www\./, '');
    const network = SOCIAL.find(([pattern]) => pattern.test(host))?.[1];
    if (network && !social.has(network)) social.set(network, link.href);
  }
  const apps = new Map<'google-play' | 'app-store', string>();
  for (const link of allLinks) {
    if (/play\.google\.com\/store\/apps/i.test(link.href) && !apps.has('google-play'))
      apps.set('google-play', link.href);
    if (/apps\.apple\.com\//i.test(link.href) && !apps.has('app-store'))
      apps.set('app-store', link.href);
  }

  const copyright = footerLines.find((line) => /©|&copy;|copyright/i.test(line));
  const lang = ($('html').attr('lang') ?? 'en').toLowerCase();
  const dir = $('html').attr('dir') === 'rtl' ? 'rtl' : 'ltr';

  return {
    name,
    ...(tagline ? { tagline } : {}),
    origin: input.origin,
    source: input.source,
    ...(logo ? { logo } : {}),
    ...(icon ? { icon } : {}),
    languages: [{ code: lang.split('-')[0] ?? 'en', dir }],
    navigation: {
      header: toNav(inventory.menus.header[0]?.items ?? []),
      footer: toNav(inventory.menus.footer.flatMap((m) => m.items)),
    },
    contact: { emails, phones, address, ...(mapUrl ? { mapUrl } : {}) },
    social: [...social.entries()].map(([network, url]) => ({ network, url })),
    apps: [...apps.entries()].map(([store, url]) => ({ store, url })),
    footer: { ...(copyright ? { copyright } : {}) },
    snapshot: { syncedAt: input.syncedAt, pages: 0, media: 0 },
  };
}
