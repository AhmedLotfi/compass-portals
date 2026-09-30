import { test as base, expect, type Page } from '@playwright/test';

/** Console errors and warnings, uncaught errors, and failed same-origin requests during a test. */
export const test = base.extend<{ problems: string[] }>({
  problems: async ({ page, baseURL }, use) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        problems.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
    page.on('response', (response) => {
      const url = response.url();
      // The document itself may be a deliberate 404 (tested separately).
      if (
        response.status() >= 400 &&
        url.startsWith(baseURL!) &&
        response.request().resourceType() !== 'document'
      ) {
        problems.push(`HTTP ${response.status()}: ${url}`);
      }
    });
    await use(problems);
  },
});

export { expect };

/** Waits until Angular has hydrated the prerendered page (it attaches its context to the root). */
export async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const root = document.querySelector('app-root');
    return Boolean(root && '__ngContext__' in root);
  });
}
