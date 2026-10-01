/**
 * Lighthouse on the static build, served like production hosting (tools/serve-dist.ts): the home
 * page, a listing, a product and the contact page, with the mobile and desktop presets, each the
 * median of `--runs` runs. HTML reports go to reports/lighthouse/.
 *
 * Targets: every category ≥ 0.95, LCP ≤ 2.5 s (Core Web Vitals "good"), CLS ≤ 0.02. The build fails
 * on the deterministic ones (accessibility, best practices, SEO, CLS) and on performance below 0.9;
 * a miss on the timing targets is reported as a warning, because simulated mobile timings move with
 * the runner's CPU speed and a gate at their edge would fail at random.
 *
 *   node tools/verify/lighthouse.ts [--content=src/content] [--runs=3]
 *
 * Uses CHROME_PATH when set (the sandbox exports the preinstalled Chromium), else a local Chrome.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse, { desktopConfig, type Flags, type RunnerResult } from 'lighthouse';
import type { RouteEntry } from '../../schema/content.ts';
import { CONTENT_DIR, REPORTS_DIR, ROOT } from '../content-sync/config.ts';
import { startDistServer } from '../serve-dist.ts';

export const THRESHOLDS = {
  performance: 0.95,
  accessibility: 0.95,
  'best-practices': 0.95,
  seo: 0.95,
} as const;
/** Below this, performance fails the build; between it and the target it is a warning. */
export const MIN_PERFORMANCE = 0.9;
/**
 * Lighthouse's throttling model adds every early request (fonts, the app bundle) to the LCP
 * estimate even when the unthrottled trace paints the largest element with the first frame.
 */
export const MAX_LCP_MS = 2500;
export const MAX_CLS = 0.02;

type Category = keyof typeof THRESHOLDS;

export interface PageResult {
  page: string;
  preset: 'mobile' | 'desktop';
  scores: Record<Category, number>;
  lcp: number;
  cls: number;
  tbt: number;
  failures: string[];
  warnings: string[];
}

/** One page of each kind the site has (home, listing, product, contact), and the Arabic home. */
export function samplePages(routes: RouteEntry[]): RouteEntry[] {
  const english = routes.filter((route) => (route.lang ?? 'en') === 'en');
  const pick = (kinds: RouteEntry['kind'][], from = english) =>
    from.find((route) => kinds.includes(route.kind));
  const pages = [
    pick(['home']),
    pick(['product-index', 'product-category', 'service-index']),
    pick(['product', 'service']),
    pick(['contact']),
    pick(
      ['home'],
      routes.filter((route) => route.lang === 'ar'),
    ),
  ].filter((route): route is RouteEntry => Boolean(route));
  return [...new Map(pages.map((route) => [route.id, route])).values()];
}

function summarize(result: RunnerResult, page: string, preset: PageResult['preset']): PageResult {
  const { lhr } = result;
  const scores = Object.fromEntries(
    (Object.keys(THRESHOLDS) as Category[]).map((key) => [key, lhr.categories[key]?.score ?? 0]),
  ) as Record<Category, number>;
  const numeric = (id: string) => lhr.audits[id]?.numericValue ?? Number.NaN;
  const lcp = numeric('largest-contentful-paint');
  const cls = numeric('cumulative-layout-shift');
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const [key, min] of Object.entries(THRESHOLDS) as [Category, number][]) {
    if (scores[key] < min) {
      const failing = Object.values(lhr.audits)
        .filter(
          (audit) =>
            audit.score !== null &&
            audit.score < 0.9 &&
            lhr.categories[key]?.auditRefs.some((ref) => ref.id === audit.id && ref.weight > 0),
        )
        .map((audit) => audit.id);
      const message = `${key} ${scores[key].toFixed(2)} < ${min} (${failing.join(', ') || 'see report'})`;
      if (key === 'performance' && scores[key] >= MIN_PERFORMANCE) warnings.push(message);
      else failures.push(message);
    }
  }
  if (!(lcp <= MAX_LCP_MS)) warnings.push(`LCP ${Math.round(lcp)} ms > ${MAX_LCP_MS} ms`);
  if (!(cls <= MAX_CLS)) failures.push(`CLS ${cls.toFixed(3)} > ${MAX_CLS}`);
  const tbt = numeric('total-blocking-time');
  return { page, preset, scores, lcp, cls, tbt, failures, warnings };
}

export async function runLighthouse(
  options: { contentDir?: string; distDir?: string; runs?: number; outDir?: string } = {},
): Promise<PageResult[]> {
  const contentDir = options.contentDir ?? CONTENT_DIR;
  const outDir = options.outDir ?? path.join(REPORTS_DIR, 'lighthouse');
  const runs = options.runs ?? 3;
  await mkdir(outDir, { recursive: true });
  const { routes } = JSON.parse(await readFile(path.join(contentDir, 'index.json'), 'utf8')) as {
    routes: RouteEntry[];
  };
  const { url, server } = await startDistServer({
    ...(options.distDir ? { root: path.join(options.distDir, 'browser') } : {}),
    contentDir,
  });
  const chrome = await chromeLauncher.launch({
    ...(process.env['CHROME_PATH'] ? { chromePath: process.env['CHROME_PATH'] } : {}),
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const results: PageResult[] = [];
  try {
    for (const route of samplePages(routes)) {
      for (const preset of ['mobile', 'desktop'] as const) {
        const flags: Flags = { port: chrome.port, output: 'html', logLevel: 'error' };
        const attempts: RunnerResult[] = [];
        for (let i = 0; i < runs; i++) {
          const result = await lighthouse(
            new URL(route.path, url).href,
            flags,
            preset === 'desktop' ? desktopConfig : undefined,
          );
          if (result) attempts.push(result);
        }
        // The median run by performance score, as Lighthouse CI does.
        attempts.sort(
          (a, b) =>
            (a.lhr.categories['performance']?.score ?? 0) -
            (b.lhr.categories['performance']?.score ?? 0),
        );
        const median = attempts[Math.floor(attempts.length / 2)];
        if (!median) throw new Error(`Lighthouse produced no result for ${route.path}`);
        const slug = route.path.replace(/^\/|\/$/g, '').replace(/\//g, '--') || 'home';
        await writeFile(path.join(outDir, `${slug}.${preset}.html`), median.report as string);
        results.push(summarize(median, route.path, preset));
      }
    }
  } finally {
    chrome.kill();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const flag = (name: string) =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const content = flag('content');
  const results = await runLighthouse({
    ...(content ? { contentDir: path.resolve(ROOT, content) } : {}),
    runs: Number(flag('runs') ?? 3),
  });
  const pct = (score: number) => String(Math.round(score * 100)).padStart(3);
  console.error('[lighthouse] page / preset: perf a11y best seo | LCP ms, CLS, TBT ms');
  for (const r of results) {
    console.error(
      `[lighthouse] ${r.page} ${r.preset}: ${pct(r.scores.performance)} ${pct(r.scores.accessibility)} ${pct(r.scores['best-practices'])} ${pct(r.scores.seo)} | ${Math.round(r.lcp)}, ${r.cls.toFixed(3)}, ${Math.round(r.tbt)}`,
    );
    for (const failure of r.failures) console.error(`  - ${failure}`);
    for (const warning of r.warnings) console.error(`  ~ warning: ${warning}`);
  }
  if (results.some((r) => r.failures.length)) process.exit(1);
}
