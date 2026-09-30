/**
 * A tiny fake WordPress site for tooling tests. Its content is synthetic test data and never ships.
 * It mimics the quirks the sync must handle: PATHINFO permalinks with redirects, lazy-loaded images,
 * Cloudflare-obfuscated emails, duplicated desktop/mobile menus, a REST API and a WordPress sitemap.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { encodeCfEmail } from '../cfemail.ts';

export interface FakeSite {
  origin: string;
  host: string;
  requests: string[];
  close(): Promise<void>;
}

const layout = (origin: string, body: string, classes: string, title: string) => `<!doctype html>
<html lang="en-US">
<head>
  <title>${title}</title>
  <meta name="description" content="${title} description">
  <meta name="generator" content="WordPress 6.6">
  <meta name="generator" content="Elementor 3.23.0">
  <link rel="https://api.w.org/" href="${origin}/wp-json/">
  <link rel="stylesheet" href="${origin}/wp-content/themes/test-theme/style.css">
  <link rel="stylesheet" href="${origin}/wp-content/uploads/elementor/css/post-12.css">
  <script src="${origin}/wp-content/plugins/elementor/assets/js/frontend.min.js"></script>
</head>
<body class="${classes}">
  <header data-elementor-type="header">
    <nav class="elementor-nav-menu--main">
      <ul id="menu-main" class="elementor-nav-menu">
        <li class="menu-item"><a href="${origin}/">Home</a></li>
        <li class="menu-item menu-item-has-children"><a href="${origin}/index.php/products/">Products</a>
          <ul class="sub-menu">
            <li class="menu-item"><a href="${origin}/index.php/products/charity-solutions/charity-management/">Charity Management</a></li>
          </ul>
        </li>
        <li class="menu-item"><a href="${origin}/index.php/about-us/">About Us</a></li>
      </ul>
    </nav>
    <nav class="elementor-nav-menu--dropdown">
      <ul id="menu-main-mobile" class="elementor-nav-menu">
        <li class="menu-item"><a href="${origin}/">Home</a></li>
        <li class="menu-item menu-item-has-children"><a href="${origin}/index.php/products/">Products</a>
          <ul class="sub-menu">
            <li class="menu-item"><a href="${origin}/index.php/products/charity-solutions/charity-management/">Charity Management</a></li>
          </ul>
        </li>
        <li class="menu-item"><a href="${origin}/index.php/about-us/">About Us</a></li>
      </ul>
    </nav>
    <img src="${origin}/wp-content/uploads/2020/01/logo.png" alt="Test logo" width="200" height="60">
  </header>
  <main class="elementor elementor-12">${body}</main>
  <footer data-elementor-type="footer">
    <ul class="menu"><li class="menu-item"><a href="${origin}/index.php/contact-us/">Contact Us</a></li></ul>
    <p>Call <a href="tel:+97140000000">+971 4 000 0000</a> or email
      <a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${encodeCfEmail('info@test.example')}">[email&#160;protected]</a></p>
  </footer>
</body>
</html>`;

export async function startFakeWordPress(): Promise<FakeSite> {
  const requests: string[] = [];
  let origin = '';

  const pages: Record<string, { classes: string; title: string; body: string }> = {
    '/': {
      classes: 'home page-template-default page page-id-2 elementor-page',
      title: 'Test Home',
      body: `<section class="elementor-section" style="background-image:url('/wp-content/uploads/2020/01/hero.jpg')">
        <h1 class="elementor-heading-title">Test headline</h1>
        <p>Test intro paragraph.</p>
        <img data-src="/wp-content/uploads/2020/01/product.jpg" src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" alt="">
        <a href="/index.php/products/charity-solutions/charity-management/">Read more</a>
        <a href="/wp-content/uploads/2020/01/brochure.pdf">Brochure</a>
      </section>`,
    },
    '/products/': {
      classes: 'page-template-default page page-id-10 elementor-page',
      title: 'Test Products',
      body: `<h1>Products</h1><a href="/index.php/products/charity-solutions/charity-management/">Charity</a>`,
    },
    '/products/charity-solutions/charity-management/': {
      classes: 'page-template-default page page-id-12 elementor-page',
      title: 'Test Charity Management',
      body: `<h1>Charity Management</h1><h2>Business Features</h2><ul><li>Feature one</li></ul>`,
    },
    '/about-us/': {
      classes: 'page-template-default page page-id-14',
      title: 'Test About',
      body: `<h1>About</h1><p>Lorem ipsum dolor sit amet.</p><a href="/index.php/missing/">Old link</a>
        <a href="/contact-us/">Contact (clean URL)</a>`,
    },
    '/contact-us/': {
      classes: 'page-template-default page page-id-16',
      title: 'Test Contact',
      body: `<h1>Contact</h1><div class="wpcf7"><form class="wpcf7-form" action="/index.php/contact-us/#wpcf7-f5">
        <input name="your-name" type="text"><input name="your-email" type="email"><textarea name="your-message"></textarea>
        <input type="hidden" name="_wpcf7" value="5"><input type="submit" value="Send"></form></div>`,
    },
  };

  const rest = () => ({
    '/wp-json/': {
      name: 'Test Site',
      description: 'Test tagline',
      home: origin,
      namespaces: ['oembed/1.0', 'wp/v2', 'contact-form-7/v1'],
    },
    '/wp-json/wp/v2/types': {
      page: {
        name: 'Pages',
        slug: 'page',
        rest_base: 'pages',
        rest_namespace: 'wp/v2',
        hierarchical: true,
      },
      attachment: {
        name: 'Media',
        slug: 'attachment',
        rest_base: 'media',
        rest_namespace: 'wp/v2',
        hierarchical: false,
      },
    },
    '/wp-json/wp/v2/pages': [2, 10, 12, 14, 16].map((id) => {
      const path = Object.entries(pages).find(
        ([, p]) => p.classes.includes(`page-id-${id} `) || p.classes.endsWith(`page-id-${id}`),
      )![0];
      return {
        id,
        slug: path.split('/').filter(Boolean).pop() ?? 'home',
        link: `${origin}/index.php${path === '/' ? '/' : path}`,
        parent: id === 12 ? 10 : 0,
        status: 'publish',
        modified: '2024-05-01T10:00:00',
        title: {
          rendered: pages[path]!.title.replace('Test ', '') + (id === 12 ? ' &amp; More' : ''),
        },
      };
    }),
    '/wp-json/wp/v2/media': [
      {
        id: 30,
        source_url: `${origin}/wp-content/uploads/2020/01/product.jpg`,
        alt_text: 'Product screenshot',
        caption: { rendered: '' },
        mime_type: 'image/jpeg',
        post: 2,
        media_details: { width: 1200, height: 800 },
      },
    ],
  });

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', origin);
    requests.push(url.pathname + url.search);
    const send = (
      status: number,
      type: string,
      body: string,
      headers: Record<string, string> = {},
    ) => {
      res.writeHead(status, { 'content-type': type, ...headers });
      res.end(body);
    };

    if (url.pathname === '/robots.txt') {
      return send(
        200,
        'text/plain',
        `User-agent: *\nDisallow: /wp-admin/\nSitemap: ${origin}/wp-sitemap.xml\n`,
      );
    }
    if (url.pathname === '/wp-sitemap.xml') {
      return send(
        200,
        'application/xml',
        `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${origin}/wp-sitemap-posts-page-1.xml</loc></sitemap></sitemapindex>`,
      );
    }
    if (url.pathname === '/wp-sitemap-posts-page-1.xml') {
      const locs = ['/', '/index.php/products/', '/index.php/about-us/']
        .map((p) => `<url><loc>${origin}${p}</loc></url>`)
        .join('');
      return send(
        200,
        'application/xml',
        `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs}</urlset>`,
      );
    }
    const restPath = url.pathname.replace(/\/$/, '') || '/';
    const restMap = rest() as Record<string, unknown>;
    const restKey = url.pathname === '/wp-json/' ? '/wp-json/' : restPath;
    if (restKey in restMap) {
      const body = restMap[restKey];
      const headers: Record<string, string> = Array.isArray(body)
        ? { 'x-wp-total': String(body.length), 'x-wp-totalpages': '1' }
        : {};
      if (Array.isArray(body) && Number(url.searchParams.get('page') ?? 1) > 1) {
        return send(400, 'application/json', '{"code":"rest_post_invalid_page_number"}');
      }
      return send(200, 'application/json; charset=UTF-8', JSON.stringify(body), headers);
    }
    // PATHINFO permalinks: /index.php/x/ is canonical here; the clean URL redirects to it.
    if (url.pathname.startsWith('/index.php/')) {
      const clean = url.pathname.slice('/index.php'.length);
      const page = pages[clean];
      if (!page)
        return send(
          404,
          'text/html',
          layout(origin, '<h1>Not found</h1>', 'error404', 'Not found'),
        );
      return send(
        200,
        'text/html; charset=UTF-8',
        layout(origin, page.body, page.classes, page.title),
        { link: `<${origin}/wp-json/>; rel="https://api.w.org/"` },
      );
    }
    if (url.pathname === '/') {
      const page = pages['/']!;
      return send(
        200,
        'text/html; charset=UTF-8',
        layout(origin, page.body, page.classes, page.title),
        { link: `<${origin}/wp-json/>; rel="https://api.w.org/"` },
      );
    }
    if (pages[url.pathname]) {
      return send(301, 'text/html', '', { location: `${origin}/index.php${url.pathname}` });
    }
    return send(404, 'text/html', layout(origin, '<h1>Not found</h1>', 'error404', 'Not found'));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    host: '127.0.0.1',
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
