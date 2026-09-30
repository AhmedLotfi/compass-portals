import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpClient, renderedKey } from './http.ts';

describe('rendered pages in the archive client', () => {
  let dir: string;
  let http: HttpClient;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'rendered-'));
    const archiveDir = path.join(dir, 'http');
    const renderedDir = path.join(dir, 'rendered');
    await mkdir(path.join(renderedDir, 'compassint.org'), { recursive: true });
    await mkdir(path.join(archiveDir, 'compassint.org'), { recursive: true });
    await writeFile(
      path.join(renderedDir, 'compassint.org/products--1.html'),
      '<html><body><h1>Products</h1></body></html>',
    );
    await writeFile(
      path.join(renderedDir, 'manifest.json'),
      JSON.stringify({
        origin: 'https://compassint.org',
        pages: [
          {
            url: 'https://compassint.org/products',
            finalUrl: 'https://compassint.org/products',
            file: 'compassint.org/products--1.html',
          },
        ],
      }),
    );
    await writeFile(path.join(archiveDir, 'compassint.org/logo.png'), 'png');
    await writeFile(
      path.join(archiveDir, 'manifest.json'),
      JSON.stringify([
        {
          url: 'https://compassint.org/products',
          status: 200,
          headers: { 'content-type': 'text/html' },
          file: null,
          sha256: null,
          bytes: 0,
          fetchedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          url: 'https://compassint.org/logo.png',
          status: 200,
          headers: { 'content-type': 'image/png' },
          file: 'compassint.org/logo.png',
          sha256: null,
          bytes: 3,
          fetchedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    );
    http = new HttpClient({ offline: true, archiveDir, renderedDir });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('keys pages by path, ignoring host form, trailing slash and plain fragments', () => {
    expect(renderedKey('https://www.compassint.org/products/#top')).toBe('/products');
    expect(renderedKey('https://compassint.org/#/products')).toBe('/#/products');
    expect(renderedKey('https://compassint.org/')).toBe('/');
  });

  it('serves the rendered DOM for HTML requests to a rendered page', async () => {
    for (const url of ['https://compassint.org/products/', 'https://www.compassint.org/products']) {
      const response = await http.get(url, 'text/html');
      expect(response.status).toBe(200);
      expect(response.body.toString()).toContain('<h1>Products</h1>');
      expect(response.finalUrl).toBe('https://compassint.org/products');
    }
    expect(http.renderedPages).toBe(1);
  });

  it('leaves other requests to the archive', async () => {
    const logo = await http.get('https://compassint.org/logo.png', 'image/*');
    expect(logo.body.toString()).toBe('png');
    await expect(http.get('https://compassint.org/unknown', 'text/html')).rejects.toThrow(
      /Not in the archive/,
    );
  });
});
