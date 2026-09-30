import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The only source of truth for content. */
export const SOURCE_ORIGIN = process.env.CONTENT_SOURCE_ORIGIN ?? 'https://compassint.org';

/** Hosts that count as "the site" when crawling and rewriting links. */
export const SITE_HOSTS = (process.env.CONTENT_SITE_HOSTS ?? 'compassint.org,www.compassint.org')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

export const ARCHIVE_DIR = path.join(ROOT, 'source-archive');
export const HTTP_ARCHIVE_DIR = path.join(ARCHIVE_DIR, 'http');
export const REPORTS_DIR = path.join(ROOT, 'reports');

export const USER_AGENT =
  'CompassPortalSync/1.0 (+https://github.com/AhmedLotfi/compass-portals; content sync for the site owner)';

/** Polite crawling: a few requests at a time, with a pause between them. */
export const CONCURRENCY = 3;
export const REQUEST_GAP_MS = 150;
export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_CRAWL_PAGES = 1_000;
