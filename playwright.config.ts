import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/** The snapshot the build was made from: the real one once synced, the fixture until then. */
export const CONTENT_DIR =
  process.env['E2E_CONTENT'] ??
  (existsSync('src/content/site.json') ? 'src/content' : '.cache/fixture/content');
const port = Number(process.env['E2E_PORT'] ?? 4310);

// End-to-end tests against the static build, served like production hosting (tools/serve-dist.ts):
// build first (`npm run build` or `npm run build:fixture`), then `npm run e2e`.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
      },
    },
  ],
  webServer: {
    command: `node tools/serve-dist.ts --port=${port} --content=${CONTENT_DIR}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env['CI'],
  },
});
