import { pageDoc, routes, site } from './content.ts';
import { expect, hydrated, test } from './fixtures.ts';

const arabic = routes.filter((route) => route.lang === 'ar');
const paired = arabic.filter((route) => pageDoc(route).alternates?.en);
const untranslated = arabic.find((route) => !pageDoc(route).alternates);

test.describe('Arabic', () => {
  test.skip(!arabic.length, 'The site has no Arabic pages.');

  test('translated pages link to each other with hreflang, both ways', async ({ page }) => {
    const route = paired[0]!;
    const { alternates } = pageDoc(route);
    for (const path of [alternates!.ar!, alternates!.en!]) {
      await page.goto(path);
      const links: [string, string][] = [
        ['en', alternates!.en!],
        ['ar', alternates!.ar!],
        ['x-default', alternates!.en!],
      ];
      for (const [hreflang, target] of links) {
        await expect(page.locator(`link[rel="alternate"][hreflang="${hreflang}"]`)).toHaveAttribute(
          'href',
          new URL(target, site.origin).href,
        );
      }
    }
  });

  test('an untranslated page has no hreflang pair', async ({ page }) => {
    test.skip(!untranslated, 'Every Arabic page is translated.');
    await page.goto(untranslated!.path);
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
  });

  test('the language switch opens the same page in the other language', async ({ page }) => {
    const route = paired[0]!;
    const english = pageDoc(route).alternates!.en!;
    await page.goto(english);
    await hydrated(page);
    const toArabic = page.locator('a.lang-switch');
    await expect(toArabic).toHaveAttribute('lang', 'ar');
    await toArabic.click();
    await expect(page).toHaveURL(new URL(route.path, page.url()).href);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('h1')).toHaveText(pageDoc(route).title);
    await page.locator('a.lang-switch').click();
    await expect(page).toHaveURL(new URL(english, page.url()).href);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('English text on an Arabic page is marked as English', async ({ page }) => {
    // A page whose CMS text has an English-only title somewhere (the CMS's Arabic is partial).
    const route = paired.find((r) =>
      JSON.stringify(pageDoc(r).sections).match(/"title":"[A-Za-z][^"؀-ۿ]*"/),
    );
    test.skip(!route, 'No English text on the Arabic pages.');
    await page.goto(route!.path);
    await hydrated(page);
    const marked = page.locator('main [lang="en"]');
    expect(await marked.count()).toBeGreaterThan(0);
    await expect(marked.first()).toHaveAttribute('dir', 'ltr');
  });
});
