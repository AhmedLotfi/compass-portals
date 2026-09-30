# Compass International portal

A modern, SEO-first rebuild of [compassint.org](https://compassint.org/) in **Angular 22**. The site's content
is pulled from compassint.org at build time and every page is prerendered to static HTML.

## Requirements

- Node **24.21.0** (see `.nvmrc`; Angular CLI 22.2 needs `^22.22.3 || ^24.15.0`)
- npm 11

## Commands

```bash
npm install
npm start          # dev server at http://localhost:4200
npm run build      # static, prerendered production build in dist/compass-portal/browser
npm test           # unit tests (Vitest)
npm run lint       # angular-eslint
```

## How it works

1. **Content sync** (build time): a script reads compassint.org (WordPress REST API, sitemaps and rendered
   pages) and writes typed JSON plus optimized, self-hosted images. The site's text is kept verbatim.
2. **Static prerendering**: Angular's `outputMode: "static"` renders every route to HTML, so pages are fast and
   fully crawlable, with no runtime dependency on WordPress.
3. **SEO**: per-page titles, descriptions, canonical URLs, Open Graph and JSON-LD, plus a sitemap, robots.txt,
   llms.txt and 301 redirects from the old `/index.php/...` URLs.

See `CLAUDE.md` for the content rules, conventions and architecture.
