import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaRef, PageDoc, Redirect, RouteEntry, Site } from '../../schema/content.ts';
import { buildFakeSnapshot } from '../content-sync/testing/fake-snapshot.ts';
import { htaccess, netlifyHeaders, netlifyRedirects, nginxConf, webConfig } from './hosting.ts';
import { loadContent, postbuild, PostbuildError } from './index.ts';
import { blockToMarkdown, htmlToMarkdown, type MarkdownContext } from './markdown.ts';
import { llmsFullTxt, llmsTxt, robotsTxt, sitemapXml, type SiteContent } from './site-files.ts';

const ORIGIN = 'https://portal.test';
const image: MediaRef = {
  id: 'm-0123456789',
  mime: 'image/png',
  width: 800,
  height: 600,
  alt: 'Payroll screen',
  widths: [320, 800],
  svg: false,
};
const ctx: MarkdownContext = { origin: ORIGIN, media: { [image.id]: image } };

describe('Markdown for llms-full.txt', () => {
  it('converts the sanitized rich-text tags', () => {
    const html =
      '<p>Hello <strong>bold </strong>and <em>italic</em>, see <a href="/products/">our products</a>.</p>' +
      '<h3>Modules</h3><ul><li>One<ul><li>Nested</li></ul></li><li>Two</li></ul>' +
      '<ol start="3"><li>Third</li><li>Fourth</li></ol>' +
      '<blockquote><p>Quoted</p></blockquote><p>Line<br>break</p>' +
      '<table><thead><tr><th>Plan</th><th>Users</th></tr></thead><tbody><tr><td>A | B</td><td>5</td></tr></tbody></table>';
    expect(htmlToMarkdown(html, ctx)).toBe(
      [
        'Hello **bold** and *italic*, see [our products](https://portal.test/products/).',
        '#### Modules',
        '- One\n  - Nested\n- Two',
        '3. Third\n4. Fourth',
        '> Quoted',
        'Line  \nbreak',
        '| Plan | Users |\n| --- | --- |\n| A \\| B | 5 |',
      ].join('\n\n'),
    );
  });

  it('renders blocks with the site text, absolute links and described images', () => {
    expect(
      blockToMarkdown(
        {
          type: 'moduleGrid',
          items: [
            {
              title: 'Payroll',
              html: '<p>Monthly runs.</p>',
              media: image.id,
              href: '/p/',
              linkLabel: 'Read more',
            },
            { title: 'Leave', href: '/l/' },
          ],
        },
        ctx,
      ),
    ).toBe(
      [
        '#### Payroll',
        '![Payroll screen](https://portal.test/media/m-0123456789.webp)',
        'Monthly runs.',
        '[Read more](https://portal.test/p/)',
        '#### [Leave](https://portal.test/l/)',
      ].join('\n\n'),
    );
    expect(blockToMarkdown({ type: 'stats', items: [{ value: '20+', label: 'Years' }] }, ctx)).toBe(
      '- **20+** Years',
    );
    expect(blockToMarkdown({ type: 'media', media: 'm-9999999999', caption: 'Unknown' }, ctx)).toBe(
      '',
    );
    expect(blockToMarkdown({ type: 'contactForm', fields: [] }, ctx)).toBe('');
  });
});

function route(
  id: string,
  routePath: string,
  parentId: string | null,
  extra: Partial<RouteEntry> = {},
): RouteEntry {
  return {
    id,
    path: routePath,
    kind: 'page',
    params: {},
    parentId,
    order: 0,
    title: id,
    sourceUrl: `https://old.test${routePath}`,
    oldUrls: [],
    ...extra,
  };
}

function page(entry: RouteEntry, extra: Partial<PageDoc> = {}): PageDoc {
  return {
    id: entry.id,
    kind: entry.kind,
    path: entry.path,
    title: entry.title,
    sourceUrl: entry.sourceUrl,
    seo: {},
    hero: { title: entry.title, ctas: [] },
    sections: [],
    breadcrumbs: [],
    children: [],
    media: {},
    ...extra,
  };
}

describe('crawler files', () => {
  const routes = [
    route('home', '/', null, { summary: 'We build software.', modified: '2024-05-01T10:00:00' }),
    route('products', '/products/', 'home', { title: 'Products', kind: 'product-index' }),
    route('products--erp', '/products/erp/', 'products', { title: 'ERP', summary: 'ERP text.' }),
    route('about-us', '/about-us/', 'home', { title: 'About' }),
    route('draft', '/draft/', 'home'),
  ];
  const site = {
    name: 'Compass',
    tagline: 'Software for the Gulf',
    origin: ORIGIN,
    contact: {
      emails: ['info@x.test'],
      phones: [{ display: '+971 4 1', tel: 'tel:+97141' }],
      address: [],
    },
  } as unknown as Site;
  const pages = new Map(
    routes.map((r) => [
      r.id,
      page(r, {
        ...(r.id === 'draft' ? { seo: { noindex: true } } : {}),
        ...(r.id === 'home'
          ? {
              media: {
                [image.id]: image,
                'm-aaaaaaaaaa': { ...image, id: 'm-aaaaaaaaaa', alt: '' },
              },
            }
          : {}),
      }),
    ]),
  );
  const content: SiteContent = {
    site,
    routes,
    pages,
    copy: {
      phone: 'Phone',
      email: 'Email',
      address: 'Address',
      llmsPages: 'Pages',
      llmsFullText: 'Full text',
    },
  };

  it('lists indexable pages in the sitemap, with dates and described images only', () => {
    const xml = sitemapXml(content);
    expect(XMLValidator.validate(xml)).toBe(true);
    const parsed = new XMLParser({
      isArray: (name) => name === 'url' || name === 'image:image',
    }).parse(xml) as {
      urlset: {
        url: { loc: string; lastmod?: string; 'image:image'?: { 'image:loc': string }[] }[];
      };
    };
    expect(parsed.urlset.url.map((u) => u.loc)).toEqual([
      'https://portal.test/',
      'https://portal.test/products/',
      'https://portal.test/products/erp/',
      'https://portal.test/about-us/',
    ]);
    expect(parsed.urlset.url[0]!.lastmod).toBe('2024-05-01');
    expect(parsed.urlset.url[0]!['image:image']).toEqual([
      { 'image:loc': 'https://portal.test/media/m-0123456789.webp' },
    ]);
    expect(robotsTxt(site)).toContain('Sitemap: https://portal.test/sitemap.xml');
  });

  it('writes llms.txt grouped by the site tree, and the full text in the same order', () => {
    expect(llmsTxt(content)).toBe(
      [
        '# Compass',
        '> Software for the Gulf',
        'We build software.',
        '- Phone: +971 4 1\n- Email: info@x.test',
        '## Products',
        '- [Products](https://portal.test/products/)\n- [ERP](https://portal.test/products/erp/): ERP text.',
        '## Pages',
        '- [home](https://portal.test/): We build software.\n- [About](https://portal.test/about-us/)',
        '## Optional',
        '- [Full text](https://portal.test/llms-full.txt)',
      ].join('\n\n') + '\n',
    );
    const full = llmsFullTxt(content);
    const titles = [...full.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(titles).toEqual(['home', 'Products', 'ERP', 'About']);
    expect(full).not.toContain('draft');
  });
});

describe('hosting rules', () => {
  const redirects: Redirect[] = [
    { from: '/?page_id=7', to: '/about-us/', status: 301, reason: 'WordPress short link' },
    { from: '/index.php', to: '/', status: 301, reason: 'PATHINFO front page' },
    { from: '/index.php/about-us/', to: '/about-us/', status: 301, reason: 'PATHINFO permalink' },
    {
      from: '/index.php/من-نحن/',
      to: '/%D9%85%D9%86-%D9%86%D8%AD%D9%86/',
      status: 301,
      reason: 'PATHINFO permalink',
    },
    {
      from: '/old file.pdf',
      to: '/files/old%20file.pdf',
      status: 301,
      reason: 'uploaded document',
    },
    { from: '/wp-login.php', to: '', status: 410, reason: 'retired WordPress endpoint' },
  ];
  const input = {
    redirects,
    bundles: ['main-ABCDEFGH.js', 'chunk-abcd_EF1.js', 'styles-ABCDEFGH.css'],
  };

  it('writes _redirects with both slash forms and the encoded path, without query or 410 rules', () => {
    const lines = netlifyRedirects(input)
      .split('\n')
      .filter((line) => line && !line.startsWith('#'));
    expect(lines).toEqual([
      '/index.php / 301',
      '/index.php/about-us/ /about-us/ 301',
      '/index.php/about-us /about-us/ 301',
      '/index.php/%D9%85%D9%86-%D9%86%D8%AD%D9%86/ /%D9%85%D9%86-%D9%86%D8%AD%D9%86/ 301',
      '/index.php/من-نحن/ /%D9%85%D9%86-%D9%86%D8%AD%D9%86/ 301',
      '/index.php/%D9%85%D9%86-%D9%86%D8%AD%D9%86 /%D9%85%D9%86-%D9%86%D8%AD%D9%86/ 301',
      '/index.php/من-نحن /%D9%85%D9%86-%D9%86%D8%AD%D9%86/ 301',
      '/old%20file.pdf /files/old%20file.pdf 301',
    ]);
  });

  it('writes mod_rewrite rules unquoted, with escaped spaces and percent signs', () => {
    const conf = htaccess(input);
    expect(conf).toContain(
      'RewriteCond %{QUERY_STRING} (?:^|&)page_id=7(?:&|$)\n  RewriteRule ^(?:index\\.php)?$ /about-us/ [R=301,L,QSD]',
    );
    expect(conf).toContain('RewriteRule ^index\\.php/about-us/$ /about-us/ [R=301,L]');
    expect(conf).toContain('RewriteRule ^old\\ file\\.pdf$ /files/old\\%20file.pdf [R=301,L,NE]');
    expect(conf).toContain('RewriteRule ^wp-login\\.php$ - [G,L]');
    expect(conf).not.toMatch(/RewriteRule .*\\\\/);
    // Short links come before the rule that sends /index.php home.
    expect(conf.indexOf('page_id=7')).toBeLessThan(conf.indexOf('RewriteRule ^index\\.php$'));
  });

  it('writes a well-formed web.config', () => {
    const xml = webConfig(input);
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toContain('<match url="^index\\.php/about-us/$" />');
    expect(xml).toContain('pattern="(?:^|&amp;)page_id=7(?:&amp;|$)"');
    expect(xml).toContain('statusCode="410"');
  });

  it('writes nginx locations without duplicates, and refuses paths it cannot quote', () => {
    const conf = nginxConf(input);
    expect(conf.match(/^location = \/index\.php \{/gm)).toHaveLength(1);
    expect(conf).toContain('if ($arg_page_id = "7") { return 301 "/about-us/"; }');
    expect(conf).toContain('location = "/index.php/about-us" { return 301 "/about-us/"; }');
    expect(conf).toContain('location = "/wp-login.php" { return 410; }');
    expect(() =>
      nginxConf({ ...input, redirects: [{ from: '/a$b/', to: '/', status: 301, reason: '' }] }),
    ).toThrow(/unsupported characters/);
  });

  it('lists hashed bundles in _headers, falling back to patterns past the host limit', () => {
    expect(netlifyHeaders(input)).toContain(
      '/main-ABCDEFGH.js\n  Cache-Control: public, max-age=31536000, immutable',
    );
    const many = Array.from({ length: 120 }, (_, i) => `chunk-${String(i).padStart(8, '0')}.js`);
    const headers = netlifyHeaders({ ...input, bundles: many });
    expect(headers).toContain('/chunk-*\n');
    expect(headers).not.toContain('chunk-00000001.js');
  });
});

describe('postbuild', () => {
  let work: string;
  let contentDir: string;
  let distDir: string;
  let content: Awaited<ReturnType<typeof loadContent>>;

  const html = (robots: string, canonical?: string) =>
    `<html><head><meta name="robots" content="${robots}">${canonical ? `<link rel="canonical" href="${canonical}">` : ''}</head><body><h1>x</h1></body></html>`;

  async function fakeDist(): Promise<void> {
    await rm(distDir, { recursive: true, force: true });
    const browser = path.join(distDir, 'browser');
    const keys: string[] = ['/404'];
    for (const r of content.routes) {
      await mkdir(path.join(browser, r.path), { recursive: true });
      await writeFile(
        path.join(browser, r.path, 'index.html'),
        html('index, follow', new URL(r.path, ORIGIN).href),
      );
      keys.push(r.path === '/' ? '/' : r.path.replace(/\/$/, ''));
    }
    await mkdir(path.join(browser, '404'), { recursive: true });
    await writeFile(path.join(browser, '404/index.html'), html('noindex, follow'));
    await writeFile(path.join(browser, 'index.csr.html'), '<html></html>');
    await writeFile(path.join(browser, 'main-ABCDEFGH.js'), '');
    await writeFile(
      path.join(distDir, 'prerendered-routes.json'),
      JSON.stringify({ routes: Object.fromEntries(keys.map((k) => [k, {}])) }),
    );
  }

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), 'postbuild-'));
    contentDir = path.join(work, 'content');
    distDir = path.join(work, 'dist');
    await buildFakeSnapshot({ archiveDir: path.join(work, 'archive'), contentDir, origin: ORIGIN });
    content = await loadContent(contentDir);
  });

  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it('checks the build, places the 404 page and writes every file, idempotently', async () => {
    await fakeDist();
    const run = () => postbuild({ contentDir, distDir, log: () => undefined });
    const result = await run();
    expect(result.routes).toBe(content.routes.length);
    const browser = path.join(distDir, 'browser');
    const exists = (file: string) =>
      stat(path.join(distDir, file)).then(
        () => true,
        () => false,
      );
    expect(await exists('browser/404.html')).toBe(true);
    expect(await exists('browser/404')).toBe(false);
    expect(await exists('browser/index.csr.html')).toBe(false);
    for (const file of result.files) expect(await exists(file)).toBe(true);
    const sitemap = await readFile(path.join(browser, 'sitemap.xml'), 'utf8');
    for (const r of content.routes)
      expect(sitemap).toContain(`<loc>${new URL(r.path, ORIGIN).href}</loc>`);
    expect(await readFile(path.join(browser, '_headers'), 'utf8')).toContain('/main-ABCDEFGH.js');
    await expect(run()).resolves.toMatchObject({ routes: content.routes.length });
  });

  it('refuses to ship a build with missing, stray or mis-tagged pages', async () => {
    await fakeDist();
    const [first, second] = content.routes.filter((r) => r.path !== '/');
    const browser = path.join(distDir, 'browser');
    await rm(path.join(browser, first!.path), { recursive: true });
    await writeFile(
      path.join(browser, second!.path, 'index.html'),
      html('noindex', 'https://elsewhere.test/'),
    );
    const manifest = JSON.parse(
      await readFile(path.join(distDir, 'prerendered-routes.json'), 'utf8'),
    );
    manifest.routes['/design-lab'] = {};
    await writeFile(path.join(distDir, 'prerendered-routes.json'), JSON.stringify(manifest));

    const error = await postbuild({ contentDir, distDir, log: () => undefined }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PostbuildError);
    const message = (error as Error).message;
    expect(message).toContain('/design-lab was prerendered but is not a synced page');
    expect(message).toContain(`${first!.path} has no index.html`);
    expect(message).toContain(`${second!.path} has robots "noindex"`);
    expect(message).toContain(`${second!.path} has canonical https://elsewhere.test/`);
  });
});
