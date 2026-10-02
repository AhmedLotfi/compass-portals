# Compass International portal

A static, prerendered Angular 22 marketing site that presents all of the content of https://compassint.org/
(Compass International: UAE software company) with a new "True North" design. The old site is only the source:
its front end loads everything from a CMS API (ASP.NET Boilerplate, `webapi.compassint.org`), and a build-time
sync turns the archived API responses into typed JSON and self-hosted images; every route is prerendered.

## The hard rule: same data as the website

- Every fact, product description, feature, contact detail, and image comes **verbatim** from compassint.org,
  through the content sync. Never invent facts, statistics, testimonials, clients, or offers.
- The only strings that don't come from the site are short UI and marketing microcopy (CTA labels, section
  labels, meta descriptions where the site has none). They all live in `src/app/core/copy/microcopy.en.json`
  and its Arabic twin `microcopy.ar.json` (same keys; a unit test checks them).
- Arabic (`/ar/…`): each CMS field shows its `*Ar` value when that really is Arabic, otherwise the English value,
  marked `lang="en" dir="ltr"` (rich text by the sync, plain strings by the `appAutoLang` directive). The old front
  end has no Arabic interface text, so its labels come from `tools/content-sync/cms/labels.ar.json`. Both Arabic
  files are **hand-written drafts awaiting the owner's review**. An Arabic page with no Arabic CMS text names the
  English page as canonical and has no hreflang pair.
- Typos, demo text, and conflicting facts found on the site are reported to the user, never fixed or dropped silently.
- Mirror the site's languages. Never machine-translate.
- The content parity and provenance checks must pass before anything ships (`npm run verify:dist`).

## Commands

| Command                                           | What it does                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm start`                                       | Dev server on http://localhost:4200                                                                                |
| `npm run build`                                   | Production build with static prerendering into `dist/compass-portal/browser`, then the post-build step             |
| `npm test`                                        | Unit tests (Vitest), single run                                                                                    |
| `npm run lint`                                    | angular-eslint (TypeScript and templates)                                                                          |
| `npm run content:probe`                           | Fingerprint compassint.org (platform, REST API, permalinks) → `reports/probe.json`                                 |
| `npm run content:discover`                        | Full inventory of the site → `reports/inventory.{json,md}` (add `-- --offline` to use the archive only)            |
| `npm run content:render`                          | Render every page in headless Chromium (the site is a client-rendered Angular app) into the archive                |
| `npm run content:fetch`                           | Download every image, document and builder stylesheet the inventory references                                     |
| `npm run content:images`                          | Download the images the archived CMS API names (and the old front end's logo files), without a crawl                |
| `npm run content:sync`                            | Normalize the archive into `src/content/` (offline) and verify sentence coverage → `reports/coverage.md`           |
| `npm run content:all`                             | discover + fetch + sync in one go (needs compassint.org in the allowed domains)                                    |
| `npm run media:build`                             | Responsive AVIF/WebP variants, share images, `/files/` documents, favicons (runs before build/start)               |
| `npm run content:fixture`                         | Synthetic snapshot from the fake WordPress test site into `.cache/fixture/` (never ships)                          |
| `npm run start:fixture` / `npm run build:fixture` | Develop or build against the fixture (before the real sync exists)                                                 |
| `node tools/serve-dist.ts --content=<dir>`        | Serve `dist/` like production hosting (redirect map, trailing slashes, real 404)                                   |
| `npm run verify:dist -- --content=<dir>`          | Parity + provenance of the built HTML against the snapshot, links, sitemap, html-validate                          |
| `npm run e2e`                                     | Playwright e2e + axe (WCAG 2.2 AA) against the build, desktop and mobile (`E2E_CONTENT=<dir>`)                     |
| `npm run lighthouse -- --content=<dir>`           | Lighthouse (mobile + desktop) on home, listing, product, contact → `reports/lighthouse/`                           |
| `npm run verify:hosting -- --content=<dir>`       | Serve the build with real nginx and Apache (generated rules) and check redirects, 404/410, headers                 |
| `npm run test:tools`                              | Tests for the build tooling (Vitest, `tools/**/*.test.ts`)                                                         |
| `npm run typecheck:tools`                         | Type-check `tools/`                                                                                                |
| `npm run design:generate`                         | Regenerate the font faces in `src/index.html`, `src/styles/easing.css` and `public/textures/*.svg` (deterministic) |
| `npm run lint:design`                             | Fail on banned design tells (see Design rules)                                                                     |

Run `ng build` after every change and fix errors before moving on.

`public/media`, `public/icons`, `public/fonts` and `public/manifest.webmanifest` are generated (gitignored) by
`npm run media:build`, which `npm start` and `npm run build` run first. If images or the logo are missing, run
`npm install` (the build needs every devDependency, e.g. `subset-font`) and then `npm run media:build`.

## Architecture

- `src/app/`: the Angular app (standalone components, signals, zoneless, OnPush by default).
  - `app.routes.ts`: one static route per synced page (from `@content/routes.json`), plus `404` and `**`;
    `app.routes.server.ts` prerenders them all (`outputMode: "static"` in `angular.json`).
  - `core/`: `content` (ContentStore, page resolver), `copy` (the microcopy files + `copy` pipe), `i18n` (`Lang`
    service set by the page resolver, `AutoLang` directive, `counterpart()` for the language switch), `media`
    (`MediaImage`, the NgOptimizedImage loader), `seo` (SeoService, title strategy, JSON-LD), `contact`.
  - `layout/`: header (products disclosure, mobile `<dialog>`), footer, breadcrumbs, nav links, icons.
  - `shared/`: section renderer and one component per block type; `SmartLink` for synced hrefs; `Reveal`
    (sections fade up as they scroll into view; cards inside follow one by one); `blocks/logo-strip` (the old
    site's drifting client logos, for logo galleries of six or more).
  - `features/`: page components by kind (home, listing, product, content page, contact, 404).
    `features/home/hero-slider/` is the home carousel (the old site's 5 slides, 8 s apart, paused on hover,
    focus, a hidden tab, reduced motion or the pause button; every slide is prerendered, one is shown);
    `features/home/compass-hero/` is the compass behind its picture (pure-CSS intro, so it runs before hydration).
  - `dev/design-lab/`: dev-only review page at `/design-lab`; guarded by `ngDevMode`, so it is not in production.
- `src/styles/`: global CSS. `theme.css` holds the Tailwind v4 `@theme` tokens; `base.css`, `prose.css` (site rich
  text), `components.css` (buttons, plates, legend lists, rail sections) and `navigation.css`. `easing.css` and the font block in `index.html` (inline, so first paint has the fonts) are generated.
- `schema/content.ts`: the zod content model. The app imports its types only. `schema/icons.ts`: the old front
  end's catalog icons (24px stroke paths and its title rules), named by the sync on product and industry cards
  and drawn by the app's `Icon`.
- `src/content/`: the generated snapshot (`site.json`, `index.json`, `routes.json`, `media.json`, `redirects.json`,
  `pages/*.json`, `page-loaders.ts`). Never edit by hand; re-run the sync.
  - `@content/*` resolves to `src/content/` in production builds and to `.cache/fixture/content/` under the
    `fixture` configuration and in unit tests (`tsconfig.fixture.json`, `tsconfig.spec.json`).
- `tools/`: build and maintenance scripts (TypeScript run directly by Node 24; the repo is ESM).
  - `content-sync/`: reads compassint.org (its CMS API, sitemaps, rendered pages). Every response is
    archived in `source-archive/http/` (with `manifest.json`) so any stage can re-run `--offline`. `normalize/`
    flattens builder HTML into atoms (clean → atoms → shape → sanitize); `sync.ts` emits the snapshot and fails
    when any visible source sentence is missing (waive only with a reason in `waivers.json`).
  - `content-sync/cms/`: the adapter used whenever the archive holds API responses. `api.ts` reads them,
    `map.ts` maps sections and pages to the content model (labels the old front end prints, such as "Our Team",
    come from the rendered pages and fail the sync if the live site doesn't show them), `rendered.ts` reads the
    header and footer, `sync.ts` builds the snapshot and the redirects (old URLs end in a per-visit
    ciphertext, so they redirect by prefix: a redirect `from` ending in `*`), and `fetch.ts` downloads every
    image the API names (the home slides' phone pictures included) and the front end's own logo files
    (`assets/custom/img/Compass-logo*.png`); the full-colour one is the site logo.
  - `media/build.ts`: image variants, share images, documents, favicons and the manifest (before build/start),
    and the Arabic web fonts cut to the letters the Arabic pages use (`public/fonts/*-site.woff2`).
  - `postbuild/`: after `ng build`, fails the build if a synced page wasn't prerendered (or has the wrong
    canonical/robots), moves the 404 page to `/404.html`, removes `index.csr.html`, and writes `sitemap.xml`,
    `robots.txt`, `llms.txt`, `llms-full.txt` and the hosting rules (`_redirects`, `_headers`, `.htaccess`,
    `web.config`, `deploy/nginx.conf`).
  - `verify/`: design lint (`design-tells.ts`), the built-site check (`dist.ts`: every snapshot sentence and image
    is on its page, and every piece of text on a page is site text or microcopy), the hosting smoke test
    (`hosting.ts`) and Lighthouse (`lighthouse.ts`).
- `e2e/`: Playwright tests (pages, redirects/404, keyboard, menus, reduced motion, contact form, axe) run against
  `tools/serve-dist.ts`; config in `playwright.config.ts`.
  - `design/`: generators for fonts (Capsize-matched fallbacks), the needle's spring easing, contour textures
    and brand icon paths.
  - `serve-dist.ts`: static server with the production redirect/404 behaviour, for screenshots and e2e.
  - `screens.ts`: screenshots routes at 390/820/1440px into `reports/screens/` for design review.
  - `mcp/angular-cli-mcp.sh`: starts the Angular CLI MCP server on the `.nvmrc` Node version (`.mcp.json`).
  - `vendor-skills.sh`: refreshes the vendored skills.
- `.claude/skills/`: vendored skills (`angular-developer`, `angular-new-app`, `frontend-design`); see its README.

## Angular 22 conventions for this repo

- Generate files with `ng generate` and use the 2025 suffixless names (`site-header.ts` → `class SiteHeader`).
- `@Service()` for singleton services, `inject()`, `input()` / `output()` / `model()`, `host: {}` metadata.
- Native control flow, self-closing tags, `NgOptimizedImage` for images, Signal Forms for forms.
- Motion uses native CSS and `animate.enter` / `animate.leave`, never `@angular/animations`.
- Browser-only code goes in `afterNextRender`. No direct DOM changes to Angular-managed nodes.
- zod is allowed in `src/` only as `import type` (it must never ship to the browser). Lint enforces this.

## Design rules ("True North")

- Light cartographic look: cool chart-paper white, faint contour lines, and compassint.org's own colours: its
  navy (`#1e2438`, ink) and its teal (`#07a5b6` for graphics and large text, `#067b89` for small text and
  buttons: the portal's button colour, AA on paper and under white text). The logo is the site's full-colour
  file. No brass, no cream.
- Motion as on compassint.org, nothing more: the hero carousel (8 s, pauses as the old one does), the drifting
  client-logo strip, cards lifting under the pointer, sections fading up as they scroll into view, and the
  compass needle settling on north behind the hero picture. All of it stops under `prefers-reduced-motion`
  (the e2e suite checks that nothing animates then).
- The old front end's drawings stay: its catalog icons on product and industry cards (`schema/icons.ts`), its
  page-header drawing behind inner-page headings (`public/textures/page-header.svg`, from
  `assets/img/page-header-bg.svg`), and its "AppStore" illustration on the home page (synced as media).
- Avoid generic tells: all-caps tracked eyebrow labels, `→` appended to links, `·` metadata strings, 01/02 markers
  on things that aren't sequences, identical rounded card grids with grey `rgba(0,0,0,.1)` shadows, cream/terracotta palettes.

## Sandbox notes (Claude Code on the web)

- Angular CLI 22.2 needs Node `^22.22.3 || ^24.15.0`; the repo pins Node 24.21.0 in `.nvmrc`. The SessionStart hook
  (`.claude/hooks/session-start.sh`) installs it via `/opt/nvm`, runs `npm install`, and exports the environment.
- Node's built-in `fetch` needs `NODE_USE_ENV_PROXY=1` behind the session proxy (exported by the hook).
- compassint.org must be in the environment's allowed domains for the content sync to run here. Otherwise the
  **Archive compassint.org** workflow (`.github/workflows/content-archive.yml`, started by hand from the Actions
  tab) runs `content:discover` + `content:render` on a GitHub runner and commits `source-archive/` and the
  reports; after pulling that commit, the offline stages work here.
- compassint.org itself is a client-rendered Angular app on IIS/ASP.NET (not WordPress): its HTML is an empty
  `<app-root>`, so content comes from `content:render` (rendered DOM, API responses), not the raw HTML.
- npm 11 skips unapproved install scripts (esbuild, lmdb, msgpackr-extract, @parcel/watcher); they aren't needed
  because prebuilt binaries are used.

---

# Angular best practices (generated by `ng new --ai-config=claude-code`)

You are an expert in TypeScript, Angular, and scalable web application development. You write functional, maintainable, performant, and accessible code following Angular and TypeScript best practices.

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

## Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default in Angular v20+.
- Do NOT set `changeDetection: ChangeDetectionStrategy.OnPush` explicitly. `OnPush` is the default in Angular v22+.
- Use signals for state management
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.

## Accessibility Requirements

- It MUST pass all AXE checks.
- It MUST follow all WCAG AA minimums, including focus management, color contrast, and ARIA attributes.

### Components

- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `model()` for two-way bound properties with `[(prop)]` syntax instead of pairing `input()` with `output()`
- Use `computed()` for derived state
- Use `linkedSignal()` for state derived from multiple reactive sources that must stay synchronized
- Prefer inline templates for small components
- Prefer Signal Forms (`@angular/forms/signals`) for new forms. They are stable in Angular v22+ and provide signal-based state, type-safe field access, and schema-based validation
- When not using Signal Forms, prefer Reactive forms instead of Template-driven ones
- Do NOT use `ngClass`, use `class` bindings instead
- Do NOT use `ngStyle`, use `style` bindings instead
- Do NOT import `CommonModule`, import only the directives and pipes the template uses, such as `AsyncPipe` or `DatePipe`
- When using external templates/styles, use paths relative to the component TS file.

## State Management

- Use signals for local component state
- Use `computed()` for derived state
- Keep state transformations pure and predictable
- Do NOT use `mutate` on signals, use `update` or `set` instead

## Templates

- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables
- Do not assume globals like (`new Date()`) are available.

## Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Prefer the `@Service` decorator over `@Injectable({providedIn: 'root'})` for new singleton services (Angular v22+)
- Use the `inject()` function instead of constructor injection
