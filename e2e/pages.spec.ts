import { AxeBuilder } from '@axe-core/playwright';
import { routes, site } from './content.ts';
import { expect, hydrated, test } from './fixtures.ts';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

for (const route of routes) {
  test.describe(route.path, () => {
    test('is prerendered, hydrates cleanly and describes itself', async ({ page, problems }) => {
      const response = await page.goto(route.path);
      expect(response?.status()).toBe(200);
      await hydrated(page);
      await expect(page.locator('h1')).toHaveCount(1);
      expect(await page.title()).not.toBe('');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        new URL(route.path, site.origin).href,
      );
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /\S/);
      const graph = JSON.parse(
        (await page.locator('script[type="application/ld+json"]').textContent()) ?? '',
      ) as { '@graph': { '@type': string }[] };
      expect(graph['@graph'].map((node) => node['@type'])).toContain('Organization');
      expect(problems).toEqual([]);
    });

    test('has no accessibility violations (WCAG 2.2 AA)', async ({ page }) => {
      await page.goto(route.path);
      await hydrated(page);
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(
        violations.map(
          (v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
        ),
      ).toEqual([]);
    });
  });
}

test('the 404 page has no accessibility violations', async ({ page }) => {
  await page.goto('/no-such-page/');
  await hydrated(page);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
