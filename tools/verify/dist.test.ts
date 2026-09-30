import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import type { PageDoc, Site } from '../../schema/content.ts';
import { allowedText, isAllowed, pageTexts, snapshotText } from './dist.ts';

const site = {
  name: 'Compass International',
  tagline: 'Business software',
  origin: 'https://portal.test',
  contact: {
    emails: ['info@x.test'],
    phones: [{ display: '+971 4 123 4567', tel: 'tel:+97141234567' }],
    address: [],
  },
  navigation: {
    header: [{ label: 'Products', href: '/products/', external: false, children: [] }],
    footer: [],
  },
} as unknown as Site;

const page = {
  id: 'products--erp',
  path: '/products/erp/',
  title: 'ERP & Accounting',
  hero: { title: 'ERP', lede: 'Manage finance, HR and payroll in one system.', ctas: [] },
  sections: [
    {
      id: 's',
      title: 'Modules',
      blocks: [
        { type: 'richText', html: '<p>Runs on the web. See <a href="/p/">the brochure</a>.</p>' },
      ],
    },
  ],
  media: {},
} as unknown as PageDoc;

const copy = {
  contactUs: 'Contact us',
  askAbout: 'Ask about {title}',
  opensInNewTab: '(opens in a new tab)',
  'network.facebook': 'Facebook',
};

describe('provenance', () => {
  const allowed = allowedText(site, page, copy);

  it('collects the text values of the snapshot, not its ids and URLs', () => {
    const text = snapshotText(page);
    expect(text).toContain('runs on the web. see the brochure.');
    expect(text).not.toContain('/products/erp/');
    expect(text).not.toContain('products--erp');
  });

  it('accepts the site text, microcopy, templates filled with site text, and joined microcopy', () => {
    for (const text of [
      'Manage finance, HR and payroll in one system.',
      'the brochure',
      'Runs on the web.',
      '+971 4 123 4567',
      'Contact us',
      'Ask about ERP & Accounting',
      'Facebook (opens in a new tab)',
      'ERP & Accounting | Compass International',
      '*',
    ]) {
      expect(isAllowed(text, allowed), text).toBe(true);
    }
  });

  it('rejects text that is on neither the site nor the microcopy list', () => {
    for (const text of [
      'Trusted by 500+ companies',
      'Ask about our free trial',
      'Book a demo',
      'Contact us today for pricing',
    ]) {
      expect(isAllowed(text, allowed), text).toBe(false);
    }
  });

  it('reads the text people and crawlers get, skipping scripts, styles and graphics', () => {
    const $ = load(`<!doctype html><html><head><title>ERP | Compass International</title>
      <meta name="description" content="Manage finance.">
      <meta property="og:image" content="https://portal.test/x.jpg">
      <script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Compass International","url":"https://portal.test/"}]}</script>
      <style>.a{content:"Invented"}</style></head>
      <body><h1>ERP</h1><img src="/m.webp" alt="Payroll screen"><button aria-label="Menu"></button>
      <svg><text>N</text></svg><script>console.log("x")</script></body></html>`);
    expect(pageTexts($)).toEqual([
      { where: 'title', text: 'ERP | Compass International' },
      { where: 'description', text: 'Manage finance.' },
      { where: 'JSON-LD name', text: 'Compass International' },
      { where: 'h1', text: 'ERP' },
      { where: 'img[alt]', text: 'Payroll screen' },
      { where: 'button[aria-label]', text: 'Menu' },
    ]);
  });
});
