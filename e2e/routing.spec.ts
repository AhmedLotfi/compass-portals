import { copy, redirects } from './content.ts';
import { expect, hydrated, test } from './fixtures.ts';

test('old WordPress URLs redirect permanently to the new pages', async ({ request }) => {
  const moved = redirects.filter((r) => r.status === 301 && !r.from.includes('?'));
  expect(moved.length).toBeGreaterThan(0);
  for (const redirect of moved) {
    const response = await request.get(encodeURI(redirect.from), { maxRedirects: 0 });
    expect(response.status(), redirect.from).toBe(301);
    expect(response.headers()['location'], redirect.from).toBe(redirect.to);
  }
});

test('retired WordPress endpoints are gone', async ({ request }) => {
  for (const redirect of redirects.filter((r) => r.status === 410)) {
    const response = await request.get(redirect.from, { maxRedirects: 0 });
    expect(response.status(), redirect.from).toBe(410);
  }
});

test('unknown URLs get a real 404 with the not-found page', async ({ page }) => {
  const response = await page.goto('/no-such-page/');
  expect(response?.status()).toBe(404);
  await hydrated(page);
  await expect(page.locator('h1')).toHaveText(copy['notFoundTitle']!);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});
