import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { collapseSlashes, ordered } from './api.ts';
import { firstSentence, oldSlug, slugify, type CmsPage } from './map.ts';
import { readChrome } from './rendered.ts';
import { buildCmsRedirects, oldPathMap } from './sync.ts';

describe('CMS paths', () => {
  it('builds clean slugs from the English titles', () => {
    expect(slugify('HR & Payroll')).toBe('hr-payroll');
    expect(slugify('Non- Profit Organizations')).toBe('non-profit-organizations');
    expect(slugify('Government ')).toBe('government');
    expect(slugify('ICT Manpower & Outsourcing')).toBe('ict-manpower-outsourcing');
  });

  it("reproduces the old front end's slugs, trailing spaces included", () => {
    expect(oldSlug('HR & Payroll')).toBe('hr_&_payroll');
    expect(oldSlug('Government ')).toBe('government_');
    expect(oldSlug('Non- Profit Organizations')).toBe('non-_profit_organizations');
  });

  it('collapses the doubled slashes the CMS writes in image paths', () => {
    expect(collapseSlashes('https://cadmin.compassint.org//ERPAttachments/a.jpg')).toBe(
      'https://cadmin.compassint.org/ERPAttachments/a.jpg',
    );
  });

  it('keeps active records in the site order, unordered ones last', () => {
    const items = [
      { id: 3, isActive: true, order: 2 },
      { id: 1, isActive: false, order: 1 },
      { id: 2, isActive: true, order: 0 },
      { id: 4, isActive: true, order: 1 },
    ];
    expect(ordered(items).map((i) => i.id)).toEqual([4, 3, 2]);
  });

  it('takes the first sentence for cards', () => {
    expect(firstSentence('Our financial solution offers more. It delivers a lot.')).toBe(
      'Our financial solution offers more.',
    );
  });
});

const page = (id: string, path: string, oldPaths: string[], oldPrefixes: string[]): CmsPage =>
  ({
    doc: { id, path },
    parentId: null,
    order: 0,
    oldPaths,
    oldPrefixes,
    sourceText: '',
  }) as unknown as CmsPage;

describe('CMS redirects', () => {
  const pages = [
    page('home', '/', ['/home'], []),
    page('about', '/about/', ['/about', '/about-us'], []),
    page(
      'products--hr-payroll',
      '/products/hr-payroll/',
      ['/products/hr_&_payroll', '/solution/hr_&_payroll'],
      ['/products/hr_&_payroll/', '/solution/hr_&_payroll/'],
    ),
    page(
      'features--invoicing',
      '/features/invoicing/',
      ['/features/invoicing'],
      ['/features/invoicing/'],
    ),
  ];

  it('redirects old paths and ciphertext URLs by prefix, never a page to itself', () => {
    expect(buildCmsRedirects(pages).map((r) => `${r.from} ${r.to}`)).toEqual([
      '/about-us/ /about/',
      '/features/invoicing/* /features/invoicing/',
      '/home/ /',
      '/products/hr_&_payroll/ /products/hr-payroll/',
      '/products/hr_&_payroll/* /products/hr-payroll/',
      '/solution/hr_&_payroll/ /products/hr-payroll/',
      '/solution/hr_&_payroll/* /products/hr-payroll/',
    ]);
  });

  it('maps old links (encoded, with or without the ciphertext) to the new paths', () => {
    const map = oldPathMap(pages);
    expect(map('/about-us')).toBe('/about/');
    expect(map('/solution/hr_%26_payroll/U2FsdGVkX18bhGDj4BDDazsppFAGWDSov6RYukMBxqM%3D')).toBe(
      '/products/hr-payroll/',
    );
    expect(map('/careers/apply')).toBeUndefined();
  });
});

describe('site chrome', () => {
  it('reads the header, footer columns, links, copyright and social links', () => {
    const $ = load(`<app-root>
      <app-header><header><div class="compass-topbar"><div><span>Compass International · Business-driven technology</span></div></div>
      <nav><a href="/"><img alt="Compass International" src="data:image/webp;base64,AAAA"></a>
      <div id="compass-menu"><a href="/">Home</a><a href="/about-us">About US</a>
      <a href="/contact">Get Started <span aria-hidden="true">↗</span></a></div></nav></header></app-header>
      <app-footer><footer><div class="footer-single-col"><h3>Products</h3><ul>
      <li><a href="/products/x/abc">X</a></li></ul></div>
      <a href="/">Home |</a><a href="/faqs">FAQs |</a><a href="/privacy-policy">Privacy Policy</a>
      <p>All Rights Reserved. © Compass International 2021.</p>
      <a href="https://www.linkedin.com/company/compass-int/"></a></footer></app-footer></app-root>`);
    const chrome = readChrome({ url: 'https://compassint.org/', $, text: '' });
    expect(chrome.topbar).toBe('Compass International · Business-driven technology');
    expect(chrome.logo?.alt).toBe('Compass International');
    expect(chrome.header.map((l) => l.label)).toEqual(['Home', 'About US', 'Get Started']);
    expect(chrome.footerGroups).toEqual([
      { title: 'Products', links: [{ label: 'X', href: '/products/x/abc' }] },
    ]);
    expect(chrome.footerLinks.map((l) => l.label)).toEqual(['Home', 'FAQs', 'Privacy Policy']);
    expect(chrome.copyright).toBe('All Rights Reserved. © Compass International 2021.');
    expect(chrome.social).toEqual(['https://www.linkedin.com/company/compass-int/']);
  });
});
