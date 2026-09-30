/**
 * A tiny fake WordPress site for tooling tests. Its content is synthetic test data and never ships.
 * It mimics the quirks the sync must handle: PATHINFO permalinks with redirects, Elementor markup,
 * lazy-loaded images with resized variants, Cloudflare-obfuscated emails, duplicated desktop/mobile
 * menus, a theme-rendered page title, a Contact Form 7 form, a REST API and a WordPress sitemap.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { encodeCfEmail } from '../cfemail.ts';

export interface FakeSite {
  origin: string;
  host: string;
  requests: string[];
  close(): Promise<void>;
}

const nav = (origin: string, id: string) => `
      <ul id="${id}" class="elementor-nav-menu">
        <li class="menu-item"><a href="${origin}/">Home</a></li>
        <li class="menu-item menu-item-has-children"><a href="${origin}/index.php/products/">Products</a>
          <ul class="sub-menu">
            <li class="menu-item"><a href="${origin}/index.php/products/charity-solutions/charity-management/">Charity Management</a></li>
          </ul>
        </li>
        <li class="menu-item"><a href="${origin}/index.php/about-us/">About Us</a></li>
      </ul>`;

const layout = (origin: string, body: string, classes: string, title: string) => `<!doctype html>
<html lang="en-US">
<head>
  <title>${title} &#8211; Test Site</title>
  <meta name="description" content="${title} description">
  <meta name="generator" content="WordPress 6.6">
  <meta name="generator" content="Elementor 3.23.0">
  <meta property="og:site_name" content="Test Site">
  <link rel="https://api.w.org/" href="${origin}/wp-json/">
  <link rel="stylesheet" href="${origin}/wp-content/themes/test-theme/style.css">
  <link rel="stylesheet" href="${origin}/wp-content/uploads/elementor/css/post-12.css">
  <script src="${origin}/wp-content/plugins/elementor/assets/js/frontend.min.js"></script>
</head>
<body class="${classes}">
  <div id="page" class="site">
  <header data-elementor-type="header" class="site-header">
    <a class="custom-logo-link" href="${origin}/"><img class="custom-logo" src="${origin}/wp-content/uploads/2020/01/logo.png" alt="Test logo" width="200" height="60"></a>
    <nav class="elementor-nav-menu--main">${nav(origin, 'menu-main')}</nav>
    <nav class="elementor-nav-menu--dropdown">${nav(origin, 'menu-main-mobile')}</nav>
  </header>
  <main id="main">${body}</main>
  <footer data-elementor-type="footer" class="site-footer">
    <ul class="menu"><li class="menu-item"><a href="${origin}/index.php/contact-us/">Contact Us</a></li></ul>
    <p>Test Tower, Business Bay, Dubai</p>
    <p>Call <a href="tel:+97140000000">+971 4 000 0000</a> or email
      <a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${encodeCfEmail('info@test.example')}">[email&#160;protected]</a></p>
    <p><a href="https://www.facebook.com/test.example">Facebook</a> <a href="https://play.google.com/store/apps/details?id=test.example">Get the app</a></p>
    <p>© 2024 Test Site. All rights reserved.</p>
  </footer>
  </div>
</body>
</html>`;

const pages = (
  origin: string,
): Record<string, { classes: string; title: string; body: string }> => ({
  '/': {
    classes: 'home page-template-default page page-id-2 elementor-page',
    title: 'Test Home',
    body: `<div data-elementor-type="wp-page" data-elementor-id="2" class="elementor elementor-2">
      <section class="elementor-section elementor-top-section" style="background-image:url('/wp-content/uploads/2020/01/hero.jpg')">
        <div class="elementor-container"><div class="elementor-column"><div class="elementor-widget-wrap">
          <div class="elementor-widget elementor-widget-heading"><div class="elementor-widget-container"><h1 class="elementor-heading-title">Test headline</h1></div></div>
          <div class="elementor-widget elementor-widget-text-editor"><div class="elementor-widget-container"><p>Test intro paragraph.</p></div></div>
          <div class="elementor-widget elementor-widget-button"><a class="elementor-button elementor-button-link" href="/index.php/products/"><span class="elementor-button-content-wrapper"><span class="elementor-button-text">Explore products</span></span></a></div>
          <div class="elementor-widget elementor-widget-image"><img data-src="/wp-content/uploads/2020/01/product-1024x683.jpg" data-srcset="/wp-content/uploads/2020/01/product-1024x683.jpg 1024w, /wp-content/uploads/2020/01/product.jpg 1200w" src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" alt=""></div>
        </div></div></div>
      </section>
      <section class="elementor-section elementor-top-section">
        <div class="elementor-widget elementor-widget-heading"><h2 class="elementor-heading-title">Our products</h2></div>
        <div class="elementor-widget elementor-widget-image-box"><div class="elementor-image-box-wrapper">
          <figure class="elementor-image-box-img"><a href="/index.php/products/charity-solutions/charity-management/"><img src="/wp-content/uploads/2020/01/module.png" alt="Module icon"></a></figure>
          <div class="elementor-image-box-content"><h3 class="elementor-image-box-title"><a href="/index.php/products/charity-solutions/charity-management/">Charity Management</a></h3><p class="elementor-image-box-description">Charity summary text.</p></div>
        </div></div>
        <div class="elementor-widget elementor-widget-button"><a class="elementor-button" href="/index.php/products/charity-solutions/charity-management/">Read more</a></div>
        <div class="elementor-widget elementor-widget-image-box"><div class="elementor-image-box-wrapper">
          <div class="elementor-image-box-content"><h3 class="elementor-image-box-title"><a href="/index.php/products/">Smart Collector</a></h3><p class="elementor-image-box-description">Collector summary text.</p></div>
        </div></div>
        <div class="elementor-widget elementor-widget-button"><a class="elementor-button" href="/index.php/products/">Read more</a></div>
        <p><a href="/wp-content/uploads/2020/01/brochure.pdf">Brochure</a></p>
      </section>
      <section class="elementor-section elementor-top-section">
        <div class="elementor-counter"><div class="elementor-counter-number-wrapper"><span class="elementor-counter-number-prefix"></span><span class="elementor-counter-number" data-to-value="20">0</span><span class="elementor-counter-number-suffix">+</span></div><div class="elementor-counter-title">Years</div></div>
        <div class="elementor-counter"><div class="elementor-counter-number-wrapper"><span class="elementor-counter-number" data-to-value="150">0</span></div><div class="elementor-counter-title">Clients</div></div>
      </section>
      <section class="elementor-section elementor-top-section elementor-hidden-desktop"><p>Mobile-only duplicate text.</p></section>
    </div>`,
  },
  '/products/': {
    classes: 'page-template-default page page-id-10',
    title: 'Test Products',
    body: `<article><div class="entry-content"><h1>Products</h1><p>Products intro.</p><p><a href="/index.php/products/charity-solutions/charity-management/">Charity</a></p></div></article>`,
  },
  '/products/charity-solutions/charity-management/': {
    classes: 'page-template-default page page-id-12',
    title: 'Test Charity Management',
    body: `<article><div class="entry-content">
      <h1>Charity Management</h1>
      <p>Charity management lede text.</p>
      <h2>Business Features</h2>
      <ul class="elementor-icon-list-items">
        <li class="elementor-icon-list-item"><span class="elementor-icon-list-icon"><i aria-hidden="true" class="fas fa-check"></i></span><span class="elementor-icon-list-text">Feature one</span></li>
        <li class="elementor-icon-list-item"><span class="elementor-icon-list-icon"><i aria-hidden="true" class="fas fa-check"></i></span><span class="elementor-icon-list-text">Feature two</span></li>
      </ul>
      <h2>Technical Features</h2>
      <ul><li>Web based</li><li>SMS integration</li></ul>
      <h2>Charity Management Modules</h2>
      <h3>Sponsorship</h3><p>Sponsorship text.</p>
      <h3>Social Cases</h3><p>Social cases text.</p>
      <h3>Charity Projects</h3><p>Projects text.</p>
      <figure><img src="/wp-content/uploads/2020/01/module.png" alt=""><figcaption>Module screen caption</figcaption></figure>
    </div></article>`,
  },
  '/about-us/': {
    classes: 'page-template-default page page-id-14',
    title: 'Test About',
    body: `<article><header class="entry-header"><h1 class="entry-title">About</h1></header>
      <div class="entry-content"><p>Lorem ipsum dolor sit amet. See <a href="${origin}/index.php/products/charity-solutions/charity-management/">our charity system</a> and the <a href="/wp-content/uploads/2020/01/brochure.pdf">brochure</a>.</p>
      <p><a href="/index.php/missing/">Old link</a> <a href="/contact-us/">Contact (clean URL)</a></p></div></article>`,
  },
  '/contact-us/': {
    classes: 'page-template-default page page-id-16',
    title: 'Test Contact',
    body: `<article><div class="entry-content"><h1>Contact</h1><p>Send us a message.</p>
      <div class="wpcf7"><form class="wpcf7-form" action="/index.php/contact-us/#wpcf7-f5">
        <p><label>Your name<br><span class="wpcf7-form-control-wrap"><input name="your-name" type="text" class="wpcf7-validates-as-required" aria-required="true"></span></label></p>
        <p><label>Your email<br><input name="your-email" type="email" aria-required="true"></label></p>
        <p><label>Your message<br><textarea name="your-message"></textarea></label></p>
        <input type="hidden" name="_wpcf7" value="5"><p><input type="submit" value="Send"></p>
      </form></div></div></article>`,
  },
});

async function images(): Promise<Record<string, Buffer>> {
  const solid = (width: number, height: number, r: number, g: number, b: number) =>
    sharp({ create: { width, height, channels: 3, background: { r, g, b } } });
  return {
    '/wp-content/uploads/2020/01/logo.png': await solid(200, 60, 16, 38, 61).png().toBuffer(),
    '/wp-content/uploads/2020/01/hero.jpg': await solid(1600, 900, 200, 210, 220).jpeg().toBuffer(),
    '/wp-content/uploads/2020/01/band.jpg': await solid(1400, 500, 120, 140, 160).jpeg().toBuffer(),
    '/wp-content/uploads/2020/01/product.jpg': await solid(1200, 800, 60, 90, 120)
      .jpeg()
      .toBuffer(),
    '/wp-content/uploads/2020/01/product-1024x683.jpg': await solid(1024, 683, 60, 90, 120)
      .jpeg({ quality: 70 })
      .toBuffer(),
    '/wp-content/uploads/2020/01/module.png': await solid(400, 300, 168, 130, 63).png().toBuffer(),
    '/wp-content/uploads/2020/01/icon.png': await solid(512, 512, 16, 38, 61).png().toBuffer(),
  };
}

export async function startFakeWordPress(): Promise<FakeSite> {
  const requests: string[] = [];
  let origin = '';
  const files = await images();

  const rest = () => {
    const site = pages(origin);
    return {
      '/wp-json/': {
        name: 'Test Site',
        description: 'Test tagline',
        home: origin,
        site_icon_url: `${origin}/wp-content/uploads/2020/01/icon.png`,
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
        const path = Object.entries(site).find(([, p]) =>
          new RegExp(`\\bpage-id-${id}\\b`).test(p.classes),
        )![0];
        return {
          id,
          slug: path.split('/').filter(Boolean).pop() ?? 'home',
          link: `${origin}/index.php${path === '/' ? '/' : path}`,
          parent: id === 12 ? 10 : 0,
          status: 'publish',
          modified: '2024-05-01T10:00:00',
          menu_order: id,
          title: {
            rendered: site[path]!.title.replace('Test ', '') + (id === 12 ? ' &amp; More' : ''),
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
          media_details: {
            width: 1200,
            height: 800,
            sizes: {
              large: { source_url: `${origin}/wp-content/uploads/2020/01/product-1024x683.jpg` },
            },
          },
        },
      ],
    };
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', origin);
    requests.push(url.pathname + url.search);
    const send = (
      status: number,
      type: string,
      body: string | Buffer,
      headers: Record<string, string> = {},
    ) => {
      res.writeHead(status, { 'content-type': type, ...headers });
      res.end(body);
    };
    const site = pages(origin);

    if (files[url.pathname]) {
      const type = url.pathname.endsWith('.png') ? 'image/png' : 'image/jpeg';
      return send(200, type, files[url.pathname]!);
    }
    if (url.pathname === '/wp-content/uploads/2020/01/brochure.pdf') {
      return send(200, 'application/pdf', '%PDF-1.4\n% test brochure\n');
    }
    if (url.pathname === '/wp-content/uploads/elementor/css/post-12.css') {
      return send(
        200,
        'text/css',
        `.elementor-12 .band{background-image:url("../../2020/01/band.jpg")}`,
      );
    }
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
    const restMap = rest() as Record<string, unknown>;
    const restKey = url.pathname === '/wp-json/' ? '/wp-json/' : url.pathname.replace(/\/$/, '');
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
    const html = (path: string) => {
      const page = site[path]!;
      return layout(origin, page.body, page.classes, page.title);
    };
    // PATHINFO permalinks: /index.php/x/ is canonical here; the clean URL redirects to it.
    if (url.pathname.startsWith('/index.php/')) {
      const clean = url.pathname.slice('/index.php'.length);
      if (!site[clean])
        return send(
          404,
          'text/html',
          layout(origin, '<h1>Not found</h1>', 'error404', 'Not found'),
        );
      return send(200, 'text/html; charset=UTF-8', html(clean), {
        link: `<${origin}/wp-json/>; rel="https://api.w.org/"`,
      });
    }
    if (url.pathname === '/') {
      return send(200, 'text/html; charset=UTF-8', html('/'), {
        link: `<${origin}/wp-json/>; rel="https://api.w.org/"`,
      });
    }
    if (site[url.pathname])
      return send(301, 'text/html', '', { location: `${origin}/index.php${url.pathname}` });
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
