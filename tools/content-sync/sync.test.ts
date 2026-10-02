import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Block, PageDoc } from '../../schema/content.ts';
import { discover } from './discover.ts';
import { buildMedia } from '../media/build.ts';
import { fetchAssets, writeAssetManifest } from './fetch.ts';
import { HttpClient } from './http.ts';
import { coverageGaps, runSync, writeSnapshot, type SyncResult } from './sync.ts';
import { startFakeWordPress, type FakeSite } from './testing/fake-wordpress.ts';

describe('content sync (fake WordPress → snapshot)', () => {
  let site: FakeSite;
  let archiveDir: string;
  let outDir: string;
  let result: SyncResult;

  beforeAll(async () => {
    site = await startFakeWordPress();
    archiveDir = await mkdtemp(path.join(tmpdir(), 'sync-archive-'));
    outDir = await mkdtemp(path.join(tmpdir(), 'sync-out-'));
    const online = new HttpClient({ archiveDir, gapMs: 0, retries: 0 });
    const inventory = await discover({ origin: site.origin, siteHosts: [site.host], http: online });
    const assets = await fetchAssets(inventory, online, { siteHosts: [site.host] });
    await online.save();
    await writeAssetManifest(assets, path.join(archiveDir, 'assets.json'));
    const offline = new HttpClient({ archiveDir, offline: true });
    result = await runSync({
      inventory,
      assets,
      http: offline,
      siteHosts: [site.host],
      origin: 'https://portal.test',
      source: site.origin,
      outDir,
      archiveDir,
      syncedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  afterAll(async () => {
    await site.close();
    await rm(archiveDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  const doc = (id: string) => result.docs.find((d) => d.id === id)!;
  const blocks = (page: PageDoc) => page.sections.flatMap((s) => s.blocks);
  const ofType = <T extends Block['type']>(page: PageDoc, type: T) =>
    blocks(page).filter((b): b is Extract<Block, { type: T }> => b.type === type);

  it('keeps every visible sentence of every page', () => {
    expect(result.gaps).toEqual([]);
  });

  it('maps old permalinks to clean paths with trailing slashes', () => {
    expect(result.routes.map((r) => [r.id, r.path, r.kind])).toEqual([
      ['home', '/', 'home'],
      ['about-us', '/about-us/', 'page'],
      ['contact-us', '/contact-us/', 'contact'],
      ['products', '/products/', 'product-index'],
      [
        'products--charity-solutions--charity-management',
        '/products/charity-solutions/charity-management/',
        'product',
      ],
    ]);
  });

  it('builds the home hero from the first builder section', () => {
    const home = doc('home');
    expect(home.hero).toMatchObject({
      title: 'Test headline',
      lede: 'Test intro paragraph.',
      ctas: [{ label: 'Explore products', href: '/products/', kind: 'internal' }],
    });
    expect(home.hero.media).toMatch(/^m-[0-9a-f]{10}$/);
  });

  it('turns image boxes into a module grid with card links and verbatim link labels', () => {
    const [grid] = ofType(doc('home'), 'moduleGrid');
    expect(grid!.items).toEqual([
      expect.objectContaining({
        title: 'Charity Management',
        href: '/products/charity-solutions/charity-management/',
        linkLabel: 'Read more',
        media: expect.stringMatching(/^m-/),
      }),
      expect.objectContaining({
        title: 'Smart Collector',
        href: '/products/',
        linkLabel: 'Read more',
      }),
    ]);
  });

  it('keeps counters with their real values, and drops mobile-only duplicates', () => {
    expect(ofType(doc('home'), 'stats')[0]!.items).toEqual([
      { value: '20+', label: 'Years' },
      { value: '150', label: 'Clients' },
    ]);
    expect(JSON.stringify(doc('home'))).not.toContain('Mobile-only duplicate');
  });

  it('shapes product pages into feature lists (with icons) and module grids', () => {
    const product = doc('products--charity-solutions--charity-management');
    expect(product.hero).toMatchObject({
      title: 'Charity Management',
      lede: 'Charity management lede text.',
    });
    expect(product.sections.map((s) => s.title)).toEqual([
      'Business Features',
      'Technical Features',
      'Charity Management Modules',
    ]);
    const [business, technical] = ofType(product, 'featureList');
    expect(business!.items).toEqual([
      { html: 'Feature one', icon: 'check' },
      { html: 'Feature two', icon: 'check' },
    ]);
    expect(technical!.items.map((i) => i.html)).toEqual(['Web based', 'SMS integration']);
    const [modules] = ofType(product, 'moduleGrid');
    expect(modules!.items.map((i) => i.title)).toEqual([
      'Sponsorship',
      'Social Cases',
      'Charity Projects',
    ]);
    expect(ofType(product, 'media')[0]).toMatchObject({ caption: 'Module screen caption' });
    expect(product.breadcrumbs).toEqual([
      { label: 'Home', path: '/' },
      { label: 'Products', path: '/products/' },
      {
        label: 'Charity Management & More',
        path: '/products/charity-solutions/charity-management/',
      },
    ]);
  });

  it('uses a theme-rendered H1 as the hero title and rewrites links', () => {
    const about = doc('about-us');
    expect(about.hero.title).toBe('About');
    const html = ofType(about, 'richText')
      .map((b) => b.html)
      .join('');
    expect(html).toContain('href="/products/charity-solutions/charity-management/"');
    expect(html).toContain('href="/files/brochure.pdf"');
    expect(html).toContain('href="/contact-us/"');
    expect(result.unresolvedLinks.map((l) => l.path)).toEqual(['/missing/']);
  });

  it('keeps the contact form fields as on the site', () => {
    const [form] = ofType(doc('contact-us'), 'contactForm');
    expect(form).toEqual({
      type: 'contactForm',
      fields: [
        { name: 'your-name', label: 'Your name', kind: 'text', required: true },
        { name: 'your-email', label: 'Your email', kind: 'email', required: true },
        { name: 'your-message', label: 'Your message', kind: 'textarea', required: false },
      ],
      submitLabel: 'Send',
    });
  });

  it('deduplicates media across resized variants and prefers media-library alt text', () => {
    const product = result.media.find((m) => m.alt === 'Product screenshot');
    expect(product).toMatchObject({ altSource: 'wordpress', width: 1200, height: 800, svg: false });
    expect(product!.widths).toEqual([320, 480, 640, 768, 960, 1200]);
    expect(product!.placeholder).toMatch(/^data:image\/webp;base64,/);
    const logo = result.media.find((m) => m.id === result.site.logo);
    expect(logo).toMatchObject({ alt: 'Test logo', altSource: 'html', width: 200, height: 60 });
    // The module image appears twice (card and figure): one media entry used on both pages.
    const moduleImage = result.media.find((m) => m.alt === 'Module icon');
    expect(moduleImage!.usedOn).toEqual([
      'home',
      'products--charity-solutions--charity-management',
    ]);
  });

  it('extracts site-wide data', () => {
    expect(result.site).toMatchObject({
      name: 'Test Site',
      tagline: 'Test tagline',
      origin: 'https://portal.test',
      languages: [{ code: 'en', dir: 'ltr' }],
      contact: {
        emails: ['info@test.example'],
        phones: [{ display: '+971 4 000 0000', tel: 'tel:+97140000000' }],
        address: ['Test Tower, Business Bay, Dubai'],
      },
      social: [{ network: 'facebook', url: 'https://www.facebook.com/test.example' }],
      apps: [
        { store: 'google-play', url: 'https://play.google.com/store/apps/details?id=test.example' },
      ],
      footer: { copyright: '© 2024 Test Site. All rights reserved.' },
      snapshot: { syncedAt: '2026-01-01T00:00:00.000Z', pages: 5 },
    });
    expect(result.site.navigation.header.map((i) => i.label)).toEqual([
      'Home',
      'Products',
      'About Us',
    ]);
    expect(result.site.navigation.header[1]!.children[0]).toEqual({
      label: 'Charity Management',
      href: '/products/charity-solutions/charity-management/',
      external: false,
      children: [],
    });
    expect(result.site.icon).toMatch(/^m-/);
  });

  it('plans redirects from every old URL', () => {
    const find = (from: string) => result.redirects.find((r) => r.from === from);
    expect(find('/index.php/about-us/')).toMatchObject({ to: '/about-us/', status: 301 });
    expect(find('/?page_id=12')).toMatchObject({
      to: '/products/charity-solutions/charity-management/',
    });
    expect(find('/wp-content/uploads/2020/01/brochure.pdf')).toMatchObject({
      to: '/files/brochure.pdf',
    });
    expect(find('/wp-content/uploads/2020/01/product.jpg')?.to).toMatch(
      /^\/media\/m-[0-9a-f]{10}\.webp$/,
    );
    expect(find('/wp-login.php')).toMatchObject({ status: 410 });
  });

  it('denormalizes what each page renders: its media, and child cards on index pages', () => {
    const home = doc('home');
    expect(Object.keys(home.media)).toContain(home.hero.media);
    expect(home.media[home.hero.media!]).toMatchObject({ alt: 'Product screenshot', width: 1200 });
    const products = doc('products');
    expect(products.children).toEqual([
      expect.objectContaining({
        id: 'products--charity-solutions--charity-management',
        path: '/products/charity-solutions/charity-management/',
        title: 'Charity Management & More',
        summary: 'Charity management lede text.',
      }),
    ]);
    expect(Object.keys(result.site.media)).toEqual(
      expect.arrayContaining([result.site.logo, result.site.icon]),
    );
    const table = JSON.parse(result.files.get('routes.json')!);
    expect(table.routes[0]).toEqual({ id: 'home', path: '/', kind: 'home' });
  });

  it('writes a snapshot with a page loader per page, idempotently', async () => {
    const first = await writeSnapshot(outDir, result.files);
    expect(first).toContain('page-loaders.ts');
    const loaders = await readFile(path.join(outDir, 'page-loaders.ts'), 'utf8');
    expect(loaders).toContain(`"home": () => import('./pages/home.json')`);
    expect(await writeSnapshot(outDir, result.files)).toEqual([]);
  });

  it('builds responsive variants, share images, documents and icons from the snapshot', async () => {
    await writeSnapshot(outDir, result.files);
    const publicDir = path.join(outDir, 'public');
    await buildMedia({
      contentDir: outDir,
      httpArchiveDir: archiveDir,
      assetManifest: path.join(archiveDir, 'assets.json'),
      publicDir,
      log: () => undefined,
    });
    const media = await readdir(path.join(publicDir, 'media'));
    const product = result.media.find((m) => m.alt === 'Product screenshot')!;
    for (const width of product.widths) {
      expect(media).toContain(`${product.id}-${width}.webp`);
      expect(media).toContain(`${product.id}-${width}.avif`);
    }
    expect(media).toContain(`${product.id}.webp`);
    expect(media).toContain(`${doc('home').hero.media}-og.jpg`);
    expect(await readdir(path.join(publicDir, 'files'))).toEqual(['brochure.pdf']);
    expect((await readdir(path.join(publicDir, 'icons'))).sort()).toEqual([
      'apple-touch-icon.png',
      'favicon-32.png',
      'icon-192.png',
      'icon-512.png',
    ]);
    const manifest = JSON.parse(
      await readFile(path.join(publicDir, 'manifest.webmanifest'), 'utf8'),
    );
    expect(manifest).toMatchObject({ name: 'Test Site', theme_color: '#1e2438' });
  });

  it('reports sentences that did not make it into the output', () => {
    const page = doc('about-us');
    const gaps = coverageGaps('about-us', 'About\nA sentence that is not there.', page);
    expect(gaps).toEqual(['a sentence that is not there.']);
    const waived = coverageGaps('about-us', 'A sentence that is not there.', page, [
      { page: 'about-us', match: 'A sentence that is not there.', reason: 'test' },
    ]);
    expect(waived).toEqual([]);
  });
});
