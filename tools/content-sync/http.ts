import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';
import {
  CONCURRENCY,
  HTTP_ARCHIVE_DIR,
  REQUEST_GAP_MS,
  REQUEST_TIMEOUT_MS,
  USER_AGENT,
} from './config.ts';

/** Response headers worth keeping in the archive. */
const KEPT_HEADERS = [
  'content-type',
  'content-language',
  'etag',
  'last-modified',
  'location',
  'link',
  'x-wp-total',
  'x-wp-totalpages',
  'server',
  'x-powered-by',
  'x-pingback',
  'cf-ray',
  'retry-after',
];

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** One archived HTTP hop. Bodies live next to the manifest so `--offline` can rebuild everything. */
export interface ArchiveEntry {
  url: string;
  status: number;
  headers: Record<string, string>;
  /** Path relative to the archive directory, or null when the response had no body. */
  file: string | null;
  sha256: string | null;
  bytes: number;
  fetchedAt: string;
}

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export interface HttpResponse {
  /** The URL that was requested. */
  url: string;
  /** The URL that produced the final response, after redirects. */
  finalUrl: string;
  status: number;
  redirects: RedirectHop[];
  headers: Record<string, string>;
  body: Buffer;
  fromArchive: boolean;
  file: string | null;
  sha256: string | null;
}

export interface HttpClientOptions {
  offline?: boolean;
  archiveDir?: string;
  concurrency?: number;
  gapMs?: number;
  userAgent?: string;
  maxRedirects?: number;
  /** Retries for network errors, 429 and 5xx responses (with exponential backoff). */
  retries?: number;
  /**
   * Pages rendered in a browser (content:render). A client-rendered site's HTML is an empty shell,
   * so HTML requests for these pages get the rendered DOM instead.
   */
  renderedDir?: string;
}

interface RenderedIndex {
  origin: string;
  pages: { url: string; finalUrl: string; file: string }[];
}

/** The page a URL shows, independent of host form, trailing slash and plain fragments. */
export function renderedKey(url: string): string {
  const parsed = new URL(url);
  const hashRoute = parsed.hash.startsWith('#/') ? parsed.hash : '';
  return `${parsed.pathname.replace(/\/+$/, '') || '/'}${parsed.search}${hashRoute}`;
}

/** Thrown when the environment's egress proxy refuses a host. Retrying won't help. */
export class NetworkPolicyError extends Error {
  readonly host: string;
  constructor(host: string, detail: string) {
    super(
      `${host} is blocked by this environment's network policy (${detail}). ` +
        `Add it to the allowed domains, then re-run.`,
    );
    this.name = 'NetworkPolicyError';
    this.host = host;
  }
}

/**
 * Archive-first HTTP client: polite (limited concurrency, retries with backoff, conditional requests),
 * follows redirects hop by hop so chains are recorded, and writes every response to the archive.
 */
export class HttpClient {
  readonly offline: boolean;
  private readonly archiveDir: string;
  private readonly limit: ReturnType<typeof pLimit>;
  private readonly gapMs: number;
  private readonly userAgent: string;
  private readonly maxRedirects: number;
  private readonly maxAttempts: number;
  private readonly manifest = new Map<string, ArchiveEntry>();
  private readonly inflight = new Map<string, Promise<HttpResponse>>();
  private readonly renderedDir: string | undefined;
  private readonly rendered = new Map<string, { file: string; finalUrl: string }>();
  private readonly renderedHosts = new Set<string>();
  private loading: Promise<void> | undefined;

  constructor(options: HttpClientOptions = {}) {
    this.offline = options.offline ?? false;
    this.archiveDir = options.archiveDir ?? HTTP_ARCHIVE_DIR;
    this.limit = pLimit(options.concurrency ?? CONCURRENCY);
    this.gapMs = options.gapMs ?? REQUEST_GAP_MS;
    this.userAgent = options.userAgent ?? USER_AGENT;
    this.maxRedirects = options.maxRedirects ?? 10;
    this.maxAttempts = (options.retries ?? 4) + 1;
    this.renderedDir = options.renderedDir;
  }

  get manifestPath(): string {
    return path.join(this.archiveDir, 'manifest.json');
  }

  /** Reads the archive manifests once; concurrent callers share the same read. */
  load(): Promise<void> {
    this.loading ??= this.readManifests();
    return this.loading;
  }

  private async readManifests(): Promise<void> {
    try {
      const entries = JSON.parse(await readFile(this.manifestPath, 'utf8')) as ArchiveEntry[];
      for (const entry of entries) this.manifest.set(entry.url, entry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!this.renderedDir) return;
    try {
      const index = JSON.parse(
        await readFile(path.join(this.renderedDir, 'manifest.json'), 'utf8'),
      ) as RenderedIndex;
      const host = new URL(index.origin).hostname.toLowerCase().replace(/^www\./, '');
      this.renderedHosts.add(host).add(`www.${host}`);
      for (const page of index.pages) {
        this.rendered.set(renderedKey(page.url), { file: page.file, finalUrl: page.finalUrl });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  /** How many rendered pages this client serves in place of raw HTML. */
  get renderedPages(): number {
    return this.rendered.size;
  }

  /** Writes the manifest in a stable order so re-runs produce minimal diffs. */
  async save(): Promise<void> {
    const entries = [...this.manifest.values()].sort((a, b) => a.url.localeCompare(b.url));
    await mkdir(this.archiveDir, { recursive: true });
    await writeFile(this.manifestPath, JSON.stringify(entries, null, 2) + '\n');
  }

  entries(): ArchiveEntry[] {
    return [...this.manifest.values()];
  }

  /** Fetches a URL (following redirects), memoized per run. */
  get(url: string, accept = '*/*'): Promise<HttpResponse> {
    const existing = this.inflight.get(url);
    if (existing) return existing;
    const pending = this.load().then(
      () => this.fromRendered(url, accept) ?? this.limit(() => this.follow(url, accept)),
    );
    this.inflight.set(url, pending);
    return pending;
  }

  /** The browser-rendered DOM of a page, when one was archived and HTML is wanted. */
  private fromRendered(url: string, accept: string): Promise<HttpResponse> | undefined {
    if (!this.renderedDir || !this.rendered.size || !/text\/html|\*\/\*/.test(accept))
      return undefined;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return undefined;
    }
    if (!this.renderedHosts.has(parsed.hostname.toLowerCase())) return undefined;
    const hit = this.rendered.get(renderedKey(url));
    if (!hit) return undefined;
    const file = path.join(this.renderedDir, hit.file);
    return readFile(file).then((body) => ({
      url,
      finalUrl: hit.finalUrl,
      status: 200,
      redirects: [],
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body,
      fromArchive: true,
      file: path.relative(this.archiveDir, file),
      sha256: createHash('sha256').update(body).digest('hex'),
    }));
  }

  private async follow(url: string, accept: string): Promise<HttpResponse> {
    await this.load();
    const redirects: RedirectHop[] = [];
    let current = url;
    for (let hop = 0; ; hop++) {
      const { entry, body, fromArchive } = await this.fetchHop(current, accept);
      const location = entry.headers['location'];
      if (REDIRECT_STATUSES.has(entry.status) && location && hop < this.maxRedirects) {
        const next = new URL(location, current).href;
        redirects.push({ url: current, status: entry.status, location: next });
        if (redirects.some((r) => r.url === next)) break; // redirect loop
        current = next;
        continue;
      }
      return {
        url,
        finalUrl: current,
        status: entry.status,
        redirects,
        headers: entry.headers,
        body,
        fromArchive,
        file: entry.file,
        sha256: entry.sha256,
      };
    }
    throw new Error(`Redirect loop starting at ${url}`);
  }

  private async fetchHop(
    url: string,
    accept: string,
  ): Promise<{ entry: ArchiveEntry; body: Buffer; fromArchive: boolean }> {
    const previous = this.manifest.get(url);
    if (this.offline) {
      if (!previous) throw new Error(`Not in the archive (offline mode): ${url}`);
      return { entry: previous, body: await this.readBody(previous), fromArchive: true };
    }

    const headers: Record<string, string> = { 'user-agent': this.userAgent, accept };
    if (previous?.headers['etag']) headers['if-none-match'] = previous.headers['etag'];
    if (previous?.headers['last-modified']) {
      headers['if-modified-since'] = previous.headers['last-modified'];
    }

    const response = await this.fetchWithRetries(url, headers);
    if (response.status === 304 && previous) {
      await response.body?.cancel();
      return { entry: previous, body: await this.readBody(previous), fromArchive: true };
    }

    const body = Buffer.from(await response.arrayBuffer());
    const kept: Record<string, string> = {};
    for (const name of KEPT_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) kept[name] = value;
    }
    const entry: ArchiveEntry = {
      url,
      status: response.status,
      headers: kept,
      file: null,
      sha256: null,
      bytes: body.length,
      fetchedAt: new Date().toISOString(),
    };
    if (body.length > 0) {
      entry.sha256 = createHash('sha256').update(body).digest('hex');
      entry.file = archiveFileName(url, kept['content-type']);
      const target = path.join(this.archiveDir, entry.file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body);
    }
    this.manifest.set(url, entry);
    if (this.gapMs > 0) await sleep(this.gapMs);
    return { entry, body, fromArchive: false };
  }

  private async readBody(entry: ArchiveEntry): Promise<Buffer> {
    return entry.file ? readFile(path.join(this.archiveDir, entry.file)) : Buffer.alloc(0);
  }

  private async fetchWithRetries(url: string, headers: Record<string, string>): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetch(url, {
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if ((response.status === 429 || response.status >= 500) && attempt < this.maxAttempts) {
          const wait =
            retryAfterMs(response.headers.get('retry-after')) ?? 1000 * 2 ** (attempt - 1);
          await response.body?.cancel();
          await sleep(Math.min(wait, 30_000));
          continue;
        }
        return response;
      } catch (error) {
        const policy = policyDenial(error);
        if (policy) throw new NetworkPolicyError(new URL(url).host, policy);
        if (attempt >= this.maxAttempts) {
          throw new Error(`GET ${url} failed after ${attempt} attempts: ${describe(error)}`, {
            cause: error,
          });
        }
        await sleep(1000 * 2 ** (attempt - 1));
      }
    }
  }
}

export function bodyText(response: Pick<HttpResponse, 'body' | 'headers'>): string {
  const charset = /charset=([^;]+)/i.exec(response.headers['content-type'] ?? '')?.[1]?.trim();
  try {
    return new TextDecoder(charset || 'utf-8').decode(response.body);
  } catch {
    return new TextDecoder('utf-8').decode(response.body);
  }
}

export function bodyJson<T>(response: Pick<HttpResponse, 'body' | 'headers'>): T {
  // WordPress sometimes prefixes JSON with a UTF-8 BOM or stray whitespace from plugins.
  return JSON.parse(
    bodyText(response)
      .replace(/^\uFEFF/, '')
      .trim(),
  ) as T;
}

export function isHtml(response: Pick<HttpResponse, 'headers'>): boolean {
  return /text\/html|application\/xhtml/i.test(response.headers['content-type'] ?? '');
}

const EXTENSIONS: [RegExp, string][] = [
  [/text\/html|xhtml/, 'html'],
  [/json/, 'json'],
  [/xml/, 'xml'],
  [/text\/plain/, 'txt'],
  [/text\/css/, 'css'],
  [/javascript/, 'js'],
  [/image\/jpe?g/, 'jpg'],
  [/image\/png/, 'png'],
  [/image\/gif/, 'gif'],
  [/image\/webp/, 'webp'],
  [/image\/avif/, 'avif'],
  [/image\/svg/, 'svg'],
  [/image\/(?:x-icon|vnd\.microsoft\.icon)/, 'ico'],
  [/application\/pdf/, 'pdf'],
  [/font\/woff2/, 'woff2'],
  [/font\/woff/, 'woff'],
];

/** `<host>/<readable-slug>--<hash>.<ext>`: readable when browsing the archive, unique per URL. */
export function archiveFileName(url: string, contentType = ''): string {
  const parsed = new URL(url);
  const ext = EXTENSIONS.find(([pattern]) => pattern.test(contentType.toLowerCase()))?.[1] ?? 'bin';
  const slug =
    (parsed.pathname + parsed.search)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'index';
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 10);
  return `${parsed.host}/${slug}--${hash}.${ext}`;
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** Recognizes a CONNECT refusal from the session's egress proxy (policy 403/407). */
function policyDenial(error: unknown): string | undefined {
  const text = describe(error);
  const match = /Proxy response \((40[37])\)|CONNECT tunnel failed, response (40[37])/i.exec(text);
  return match ? `proxy answered ${match[1] ?? match[2]}` : undefined;
}

function describe(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(' <- ');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
