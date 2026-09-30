import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import product from '@content/pages/products--charity-solutions--charity-management.json';
import home from '@content/pages/home.json';
import site from '@content/site.json';
import type { PageDoc, Site } from '@schema/content';
import { buildGraph } from './json-ld';
import { describe as describePage, SeoService } from './seo';

const productPage = product as unknown as PageDoc;
const homePage = home as unknown as PageDoc;

describe('SEO', () => {
  it('derives a description from the page text, verbatim and within 155 characters', () => {
    const page = {
      ...productPage,
      hero: { ...productPage.hero, lede: undefined },
      sections: [
        {
          id: 's',
          blocks: [
            {
              type: 'richText' as const,
              html: `<p>${'A sentence of site text. '.repeat(10)}</p>`,
            },
          ],
        },
      ],
    };
    const description = describePage(page)!;
    expect(description.length).toBeLessThanOrEqual(155);
    expect(description.endsWith('text.')).toBe(true);
  });

  it('builds a JSON-LD graph with only facts from the site', () => {
    const graph = buildGraph(site as unknown as Site, productPage, 'Desc') as {
      '@graph': Record<string, unknown>[];
    };
    const types = graph['@graph'].map((node) => node['@type']);
    expect(types).toEqual([
      'Organization',
      'WebSite',
      'WebPage',
      'BreadcrumbList',
      'SoftwareApplication',
    ]);
    const software = graph['@graph'].find((n) => n['@type'] === 'SoftwareApplication')!;
    expect(software['featureList']).toEqual([
      'Feature one',
      'Feature two',
      'Web based',
      'SMS integration',
    ]);
    expect(software).not.toHaveProperty('offers');
    expect(software).not.toHaveProperty('aggregateRating');
    const org = graph['@graph'][0]!;
    expect(org['telephone']).toBe('+97140000000');
    expect(org['address']).toEqual({
      '@type': 'PostalAddress',
      streetAddress: 'Test Tower, Business Bay, Dubai',
    });
  });

  it('writes title, description, canonical, Open Graph and JSON-LD into the head', () => {
    const seo = TestBed.inject(SeoService);
    const doc = TestBed.inject(DOCUMENT);
    seo.update(homePage, false);
    expect(doc.title).toBe(homePage.seo.title);
    expect(doc.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      homePage.seo.description,
    );
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://compassint.org/',
    );
    expect(doc.querySelector('meta[property="og:image"]')?.getAttribute('content')).toMatch(
      /\/media\/m-[0-9a-f]{10}-og\.jpg$/,
    );
    const ld = JSON.parse(doc.querySelector('script#ld')!.textContent!);
    expect(ld['@graph'][0]['@type']).toBe('Organization');

    seo.update(undefined, true);
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex, follow',
    );
    expect(doc.querySelector('link[rel="canonical"]')).toBeNull();
    expect(doc.querySelector('script#ld')).toBeNull();
  });
});
