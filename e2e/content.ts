import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PageDoc, Redirect, RouteEntry, Site } from '../schema/content.ts';
import { CONTENT_DIR } from '../playwright.config.ts';

const read = <T>(file: string): T =>
  JSON.parse(readFileSync(path.join(CONTENT_DIR, file), 'utf8')) as T;

/** The snapshot the build under test was made from. */
export const site = read<Site>('site.json');
export const routes = read<{ routes: RouteEntry[] }>('index.json').routes;
export const redirects = read<{ redirects: Redirect[] }>('redirects.json').redirects;
export const copy = JSON.parse(
  readFileSync('src/app/core/copy/microcopy.en.json', 'utf8'),
) as Record<string, string>;

export function pageDoc(route: RouteEntry): PageDoc {
  return read<PageDoc>(`pages/${route.id}.json`);
}
