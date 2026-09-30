import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discover, type Inventory } from './discover.ts';
import { HttpClient } from './http.ts';
import { inventoryMarkdown } from './report.ts';
import { startFakeWordPress, type FakeSite } from './testing/fake-wordpress.ts';

describe('discover (against a fake WordPress site)', () => {
  let site: FakeSite;
  let archiveDir: string;
  let inventory: Inventory;

  beforeAll(async () => {
    site = await startFakeWordPress();
    archiveDir = await mkdtemp(path.join(tmpdir(), 'content-sync-'));
    const http = new HttpClient({ archiveDir, gapMs: 0, retries: 0 });
    inventory = await discover({ origin: site.origin, siteHosts: [site.host], http });
    await http.save();
  });

  afterAll(async () => {
    await site.close();
    await rm(archiveDir, { recursive: true, force: true });
  });

  const page = (pathname: string) =>
    inventory.pages.find((p) => new URL(p.finalUrl).pathname === pathname);

  it('fingerprints the platform', () => {
    const { probe } = inventory;
    expect(probe.rest?.base).toBe(`${site.origin}/wp-json/`);
    expect(probe.rest?.namespaces).toContain('contact-form-7/v1');
    expect(probe.platform.theme).toBe('test-theme');
    expect(probe.platform.plugins).toContain('elementor');
    expect(probe.platform.builders).toContain('elementor');
    expect(probe.platform.lang).toBe('en-US');
    expect(probe.platform.cfEmail).toBe(true);
    expect(probe.permalinks?.clean?.status).toBe(200);
    expect(probe.permalinks?.clean?.finalUrl).toContain('/index.php/');
  });

  it('finds every page once, following redirects and PATHINFO permalinks', () => {
    const paths = inventory.pages.map((p) => new URL(p.finalUrl).pathname).sort();
    expect(paths).toEqual([
      '/',
      '/index.php/about-us/',
      '/index.php/contact-us/',
      '/index.php/missing/',
      '/index.php/products/',
      '/index.php/products/charity-solutions/charity-management/',
    ]);
    expect(page('/index.php/missing/')?.status).toBe(404);
    // `/` and `/index.php/` serve the same page (same page-id): one entry with an alias.
    expect(page('/')?.aliases.map((a) => new URL(a).pathname)).toEqual(['/index.php/']);
    // A clean URL that redirects to the PATHINFO one is recorded on the target page.
    expect(page('/index.php/contact-us/')?.requested.map((r) => new URL(r).pathname)).toContain(
      '/contact-us/',
    );
  });

  it('matches REST items to rendered pages and decodes titles', () => {
    const charity = page('/index.php/products/charity-solutions/charity-management/');
    expect(charity?.rest).toMatchObject({ id: 12, parent: 10, title: 'Charity Management & More' });
    expect(inventory.rest?.counts).toMatchObject({ page: 5, attachment: 1 });
    expect(inventory.rest?.media[0]).toMatchObject({ alt: 'Product screenshot', width: 1200 });
  });

  it('extracts navigation once despite duplicated mobile menus', () => {
    expect(inventory.menus.header).toHaveLength(1);
    const [menu] = inventory.menus.header;
    expect(menu!.items.map((i) => i.label)).toEqual(['Home', 'Products', 'About Us']);
    expect(menu!.items[1]!.children[0]).toMatchObject({ label: 'Charity Management' });
    expect(inventory.menus.footer[0]!.items[0]!.label).toBe('Contact Us');
  });

  it('collects media including lazy-loaded and background images', () => {
    const urls = inventory.media.map((m) => new URL(m.url).pathname);
    expect(urls).toEqual(
      expect.arrayContaining([
        '/wp-content/uploads/2020/01/logo.png',
        '/wp-content/uploads/2020/01/product-1024x683.jpg',
        '/wp-content/uploads/2020/01/module.png',
        '/wp-content/uploads/2020/01/hero.jpg',
      ]),
    );
    expect(inventory.documents.map((d) => new URL(d.url).pathname)).toEqual([
      '/wp-content/uploads/2020/01/brochure.pdf',
    ]);
    expect(inventory.pageStylesheets[0]).toContain('/wp-content/uploads/elementor/css/post-12.css');
  });

  it('decodes contact details and forms', () => {
    expect(Object.keys(inventory.contacts.emails)).toEqual(['info@test.example']);
    expect(Object.keys(inventory.contacts.phones)).toContain('+97140000000');
    expect(page('/index.php/contact-us/')?.analysis?.forms[0]).toMatchObject({
      kind: 'contact-form-7',
      fields: ['input:your-name', 'input:your-email', 'textarea:your-message'],
    });
  });

  it('flags anomalies for review', () => {
    const kinds = inventory.anomalies.map((a) => a.kind);
    expect(kinds).toContain('demo-text');
    expect(kinds).toContain('broken-link');
    expect(kinds).toContain('foreign-email');
    // product.jpg has alt text via the REST media library, so it is not reported.
    expect(
      inventory.anomalies.filter((a) => a.kind === 'missing-alt').map((a) => a.detail),
    ).toEqual([]);
  });

  it('renders a markdown report', () => {
    const md = inventoryMarkdown(inventory);
    expect(md).toContain('# Content inventory');
    expect(md).toContain(
      '| /index.php/products/charity-solutions/charity-management/ | 200 | page #12 (parent 10)',
    );
    expect(md).toContain('- Products → /index.php/products/');
  });

  it('rebuilds the same inventory offline from the archive', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(archiveDir, 'manifest.json'), 'utf8'),
    ) as unknown[];
    expect(manifest.length).toBeGreaterThan(10);
    const before = site.requests.length;
    const offline = new HttpClient({ archiveDir, offline: true });
    const again = await discover({ origin: site.origin, siteHosts: [site.host], http: offline });
    expect(site.requests.length).toBe(before);
    const strip = (inv: Inventory) => ({ ...inv, generatedAt: '' });
    expect(strip(again)).toEqual(strip(inventory));
  });
});
