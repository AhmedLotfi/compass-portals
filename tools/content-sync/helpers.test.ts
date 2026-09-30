import { describe, expect, it } from 'vitest';
import { decodeCfEmail, encodeCfEmail } from './cfemail.ts';
import { decodeEntities } from './discover.ts';
import { archiveFileName } from './http.ts';
import { parseRobots } from './robots.ts';
import { parseSitemap } from './sitemap.ts';
import { classifyPath, crawlKey, resolveUrl, stripIndexPhp } from './url.ts';
import { restRootCandidates, restUrl } from './wp-rest.ts';

describe('Cloudflare email decoding', () => {
  it('round-trips an address', () => {
    const encoded = encodeCfEmail('info@example.org', 0x3c);
    expect(decodeCfEmail(encoded)).toBe('info@example.org');
    expect(decodeCfEmail(`#${encoded}`)).toBe('info@example.org');
  });

  it('decodes a known Cloudflare sample', () => {
    // key 0x42; "a@b.co"
    const encoded =
      '42' +
      [...'a@b.co'].map((c) => (c.charCodeAt(0) ^ 0x42).toString(16).padStart(2, '0')).join('');
    expect(decodeCfEmail(encoded)).toBe('a@b.co');
  });

  it('rejects malformed input', () => {
    expect(decodeCfEmail('xyz')).toBeUndefined();
    expect(decodeCfEmail('abc')).toBeUndefined();
  });
});

describe('robots.txt', () => {
  const robots = parseRobots(
    [
      'User-agent: *',
      'Disallow: /wp-admin/',
      'Allow: /wp-admin/admin-ajax.php',
      'Disallow: /*?s=',
      '',
      'User-agent: BadBot',
      'Disallow: /',
      'Sitemap: https://example.org/wp-sitemap.xml',
    ].join('\n'),
    'CompassPortalSync/1.0',
  );

  it('applies the wildcard group with longest-match precedence', () => {
    expect(robots.isAllowed('/about-us/')).toBe(true);
    expect(robots.isAllowed('/wp-admin/options.php')).toBe(false);
    expect(robots.isAllowed('/wp-admin/admin-ajax.php')).toBe(true);
    expect(robots.isAllowed('/?s=erp')).toBe(false);
  });

  it('collects sitemaps', () => {
    expect(robots.sitemaps).toEqual(['https://example.org/wp-sitemap.xml']);
  });

  it('allows everything for an empty file', () => {
    expect(parseRobots('', 'CompassPortalSync/1.0').isAllowed('/anything')).toBe(true);
  });
});

describe('URL helpers', () => {
  it('normalizes crawl keys without touching paths', () => {
    const key = crawlKey(
      new URL('http://www.example.org/index.php/about/?utm_source=x&b=2&a=1#top'),
      'example.org',
    );
    expect(key).toBe('https://example.org/index.php/about/?a=1&b=2');
  });

  it('classifies WordPress paths', () => {
    expect(classifyPath(new URL('https://e.org/products/erp/'))).toBe('page');
    expect(classifyPath(new URL('https://e.org/wp-content/uploads/2020/01/logo.png'))).toBe(
      'media',
    );
    expect(classifyPath(new URL('https://e.org/wp-content/uploads/brochure.pdf'))).toBe('document');
    expect(classifyPath(new URL('https://e.org/wp-admin/'))).toBe('skip');
    expect(classifyPath(new URL('https://e.org/index.php/wp-json/wp/v2/pages'))).toBe('skip');
    expect(classifyPath(new URL('https://e.org/feed/'))).toBe('skip');
    expect(classifyPath(new URL('https://e.org/?page_id=12'))).toBe('page');
    expect(classifyPath(new URL('https://e.org/?replytocom=5'))).toBe('skip');
    expect(classifyPath(new URL('https://e.org/wp-content/themes/x/style.css'))).toBe('asset');
  });

  it('strips the PATHINFO prefix', () => {
    expect(stripIndexPhp('/index.php/products/x/')).toBe('/products/x/');
    expect(stripIndexPhp('/index.php')).toBe('/');
    expect(stripIndexPhp('/index.phpx/')).toBe('/index.phpx/');
  });

  it('ignores non-http links', () => {
    expect(resolveUrl('mailto:a@b.co', 'https://e.org/')).toBeUndefined();
    expect(resolveUrl('javascript:void(0)', 'https://e.org/')).toBeUndefined();
    expect(resolveUrl('/x/', 'https://e.org/a/')?.href).toBe('https://e.org/x/');
  });
});

describe('sitemaps', () => {
  it('parses an index and a urlset with images', () => {
    const index = parseSitemap(
      '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://e.org/wp-sitemap-posts-page-1.xml</loc></sitemap></sitemapindex>',
    );
    expect(index).toEqual({
      kind: 'index',
      sitemaps: ['https://e.org/wp-sitemap-posts-page-1.xml'],
      urls: [],
    });

    const urlset = parseSitemap(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>https://e.org/</loc><lastmod>2024-01-02</lastmod><image:image><image:loc>https://e.org/a.jpg</image:loc></image:image></url></urlset>',
    );
    expect(urlset.urls).toEqual([
      { loc: 'https://e.org/', lastmod: '2024-01-02', images: ['https://e.org/a.jpg'] },
    ]);
  });

  it('returns unknown for HTML', () => {
    expect(parseSitemap('<html><body>Not found</body></html>').kind).toBe('unknown');
  });
});

describe('WordPress REST helpers', () => {
  it('prefers the Link header base', () => {
    expect(
      restRootCandidates(
        'https://e.org',
        '<https://e.org/index.php/wp-json/>; rel="https://api.w.org/"',
      )[0],
    ).toBe('https://e.org/index.php/wp-json/');
  });

  it('builds path and query route URLs', () => {
    const path = restUrl(
      { base: 'https://e.org/wp-json/', style: 'path', namespaces: [] },
      '/wp/v2/pages',
      { per_page: 100 },
    );
    expect(path).toBe('https://e.org/wp-json/wp/v2/pages?per_page=100');
    const query = restUrl(
      { base: 'https://e.org/?rest_route=', style: 'query', namespaces: [] },
      '/wp/v2/pages',
      { page: 2 },
    );
    expect(query).toBe('https://e.org/?rest_route=%2Fwp%2Fv2%2Fpages&page=2');
  });

  it('decodes rendered title entities', () => {
    expect(decodeEntities('Charity &amp; NGO &#8211; ERP &#x2019;s')).toBe(
      'Charity & NGO – ERP ’s',
    );
  });
});

describe('archive file names', () => {
  it('are readable, stable and typed by content type', () => {
    const name = archiveFileName('https://e.org/products/charity/?x=1', 'text/html; charset=UTF-8');
    expect(name).toMatch(/^e\.org\/products-charity-x-1--[0-9a-f]{10}\.html$/);
    expect(archiveFileName('https://e.org/products/charity/?x=1', 'text/html')).toBe(name);
    expect(archiveFileName('https://e.org/wp-json/', 'application/json; charset=UTF-8')).toMatch(
      /\.json$/,
    );
  });
});
