/**
 * Serves the build with real nginx and Apache, using the generated deploy/nginx.conf and .htaccess,
 * and checks what visitors and crawlers get: pages, trailing-slash and old-URL 301s, WordPress short
 * links, 410s, the 404 page, security headers and immutable caching. The Node server used for e2e
 * (tools/serve-dist.ts) is checked the same way for the rules it mimics.
 *
 *   node tools/verify/hosting.ts [--server=nginx,apache,node] [--content=src/content]
 *
 * Needs `nginx` and `apache2` on PATH (both preinstalled on GitHub's Ubuntu runners).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Redirect, RouteIndex } from '../../schema/content.ts';
import { CONTENT_DIR, ROOT } from '../content-sync/config.ts';
import { HASHED_BUNDLE, IMMUTABLE, SECURITY_HEADERS } from '../postbuild/hosting.ts';
import { startDistServer } from '../serve-dist.ts';

export interface Check {
  name: string;
  path: string;
  status: number;
  location?: string;
  headers?: Record<string, string | RegExp>;
  body?: RegExp;
  /** Only real servers apply these (serve-dist mimics routing, not headers). */
  serverOnly?: boolean;
}

const NOT_FOUND_BODY = /<meta name="robots" content="noindex/;

export async function hostingChecks(contentDir: string, browserDir: string): Promise<Check[]> {
  const read = async <T>(file: string) =>
    JSON.parse(await readFile(path.join(contentDir, file), 'utf8')) as T;
  const { routes } = await read<RouteIndex>('index.json');
  const { redirects } = await read<{ redirects: Redirect[] }>('redirects.json');
  const inner = routes.find((route) => route.path !== '/');
  const security = Object.fromEntries(SECURITY_HEADERS.map(([name, value]) => [name, value]));
  const checks: Check[] = [
    { name: 'home page', path: '/', status: 200, headers: { 'content-type': /^text\/html/ } },
    { name: 'security headers', path: '/', status: 200, headers: security, serverOnly: true },
    { name: 'unknown URL', path: '/no-such-page/', status: 404, body: NOT_FOUND_BODY },
    { name: 'sitemap', path: '/sitemap.xml', status: 200, body: /<urlset/ },
    { name: 'robots.txt', path: '/robots.txt', status: 200, body: /^Sitemap: /m },
    { name: 'llms.txt', path: '/llms.txt', status: 200 },
    {
      name: 'manifest type',
      path: '/manifest.webmanifest',
      status: 200,
      headers: { 'content-type': /^application\/manifest\+json/ },
      serverOnly: true,
    },
  ];
  if (inner) {
    const bare = inner.path.replace(/\/$/, '');
    checks.push(
      { name: 'page', path: inner.path, status: 200, body: /<h1\b/ },
      { name: 'trailing slash', path: bare, status: 301, location: inner.path },
    );
  }
  const moved = redirects.find((r) => r.status === 301 && !r.from.includes('?'));
  if (moved) {
    checks.push({ name: 'old URL', path: encodeURI(moved.from), status: 301, location: moved.to });
    if (moved.from.endsWith('/') && moved.from.length > 1) {
      checks.push({
        name: 'old URL without slash',
        path: encodeURI(moved.from.slice(0, -1)),
        status: 301,
        location: moved.to,
        serverOnly: true,
      });
    }
  }
  const short = redirects.find((r) => /^\/\?(?:page_id|p)=\d+$/.test(r.from) && r.to !== '/');
  if (short) {
    checks.push(
      { name: 'short link', path: short.from, status: 301, location: short.to },
      {
        name: 'short link via index.php',
        path: `/index.php${short.from.slice(1)}`,
        status: 301,
        location: short.to,
        serverOnly: true,
      },
    );
  }
  const gone = redirects.find((r) => r.status === 410);
  if (gone) {
    checks.push({ name: 'retired endpoint', path: gone.from, status: 410, body: NOT_FOUND_BODY });
  }
  const upload = redirects.find((r) => r.to.startsWith('/media/'));
  if (upload) {
    checks.push({
      name: 'uploaded image',
      path: encodeURI(upload.from),
      status: 301,
      location: upload.to,
    });
  }
  const media = (await readdir(path.join(browserDir, 'media'))).find((f) => f.endsWith('.webp'));
  if (media) {
    checks.push({
      name: 'media caching',
      path: `/media/${media}`,
      status: 200,
      headers: { 'content-type': /^image\/webp/, 'cache-control': IMMUTABLE },
      serverOnly: true,
    });
  }
  const bundle = (await readdir(browserDir)).find(
    (f) => HASHED_BUNDLE.test(f) && f.endsWith('.js'),
  );
  if (bundle) {
    checks.push({
      name: 'bundle caching',
      path: `/${bundle}`,
      status: 200,
      headers: { 'cache-control': IMMUTABLE },
      serverOnly: true,
    });
  }
  checks.push({
    name: 'missing media is not cached forever',
    path: '/media/m-0000000000.webp',
    status: 404,
    headers: { 'cache-control': /^(?!.*immutable)/ },
    serverOnly: true,
  });
  return checks;
}

export async function runChecks(base: string, checks: Check[], server = true): Promise<string[]> {
  const failures: string[] = [];
  for (const check of checks) {
    if (check.serverOnly && !server) continue;
    const res = await fetch(base + check.path, { redirect: 'manual' });
    const body = await res.text();
    const problems: string[] = [];
    if (res.status !== check.status)
      problems.push(`status ${res.status}, expected ${check.status}`);
    if (check.location !== undefined) {
      const location = res.headers.get('location') ?? '';
      const target = location
        ? new URL(location, base).pathname + new URL(location, base).search
        : '';
      if (target !== check.location) problems.push(`location ${location || '(none)'}`);
    }
    for (const [name, expected] of Object.entries(check.headers ?? {})) {
      const value = res.headers.get(name) ?? '';
      const ok = typeof expected === 'string' ? value === expected : expected.test(value);
      if (!ok) problems.push(`${name}: ${value || '(none)'}`);
    }
    if (check.body && !check.body.test(body)) problems.push('unexpected body');
    if (problems.length) failures.push(`${check.name} (${check.path}): ${problems.join('; ')}`);
  }
  return failures;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(
  base: string,
  child: ChildProcess,
  log: () => Promise<string>,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`server exited (${child.exitCode}):\n${await log()}`);
    try {
      await fetch(base, { redirect: 'manual' });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`server did not start:\n${await log()}`);
}

interface Running {
  base: string;
  stop: () => Promise<void>;
}

function launch(command: string, args: string[]): { child: ChildProcess; output: () => string } {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  return { child, output: () => output };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}

export async function startNginx(distDir: string, work: string): Promise<Running> {
  const port = await freePort();
  const prefix = path.join(work, 'nginx');
  await mkdir(path.join(prefix, 'temp'), { recursive: true });
  const conf = path.join(prefix, 'nginx.conf');
  await writeFile(
    conf,
    [
      'daemon off;',
      'worker_processes 1;',
      `pid ${prefix}/nginx.pid;`,
      `error_log ${prefix}/error.log warn;`,
      'events {}',
      'http {',
      '  include /etc/nginx/mime.types;',
      '  default_type application/octet-stream;',
      '  access_log off;',
      ...['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].map(
        (name) => `  ${name}_temp_path ${prefix}/temp/${name};`,
      ),
      '  server {',
      `    listen 127.0.0.1:${port};`,
      `    root ${path.join(distDir, 'browser')};`,
      `    include ${path.join(distDir, 'deploy/nginx.conf')};`,
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  const { child, output } = launch('nginx', [
    '-p',
    prefix,
    '-e',
    `${prefix}/error.log`,
    '-c',
    conf,
  ]);
  const base = `http://127.0.0.1:${port}`;
  await waitFor(
    base,
    child,
    async () => output() + (await readFile(`${prefix}/error.log`, 'utf8').catch(() => '')),
  );
  return { base, stop: () => stopChild(child) };
}

export async function startApache(distDir: string, work: string): Promise<Running> {
  const port = await freePort();
  const dir = path.join(work, 'apache');
  await mkdir(dir, { recursive: true });
  const modules = process.env['APACHE_MODULES'] ?? '/usr/lib/apache2/modules';
  const root = path.join(distDir, 'browser');
  const conf = path.join(dir, 'httpd.conf');
  await writeFile(
    conf,
    [
      `ServerRoot ${dir}`,
      'ServerName localhost',
      `Listen 127.0.0.1:${port}`,
      `PidFile ${dir}/httpd.pid`,
      `DefaultRuntimeDir ${dir}`,
      `ErrorLog ${dir}/error.log`,
      'LogLevel warn',
      ...[
        ['mpm_event', 'mpm_event'],
        ['authz_core', 'authz_core'],
        ['dir', 'dir'],
        ['mime', 'mime'],
        ['rewrite', 'rewrite'],
        ['headers', 'headers'],
      ].map(([name, file]) => `LoadModule ${name}_module ${modules}/mod_${file}.so`),
      'TypesConfig /etc/mime.types',
      ...(process.getuid?.() === 0 ? ['User www-data', 'Group www-data'] : []),
      `DocumentRoot ${root}`,
      `<Directory ${root}>`,
      '  AllowOverride All',
      '  Require all granted',
      '</Directory>',
      '',
    ].join('\n'),
  );
  const binary = process.env['APACHE_BIN'] ?? 'apache2';
  const { child, output } = launch(binary, ['-f', conf, '-DFOREGROUND']);
  const base = `http://127.0.0.1:${port}`;
  await waitFor(
    base,
    child,
    async () => output() + (await readFile(`${dir}/error.log`, 'utf8').catch(() => '')),
  );
  return { base, stop: () => stopChild(child) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const flag = (name: string) =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const contentDir = path.resolve(ROOT, flag('content') ?? CONTENT_DIR);
  const distDir = path.resolve(ROOT, flag('dist') ?? 'dist/compass-portal');
  const servers = (flag('server') ?? 'nginx,apache,node').split(',');
  const checks = await hostingChecks(contentDir, path.join(distDir, 'browser'));
  const work = await mkdtemp(path.join(tmpdir(), 'hosting-'));
  let failed = false;
  try {
    for (const server of servers) {
      const running =
        server === 'nginx'
          ? await startNginx(distDir, work)
          : server === 'apache'
            ? await startApache(distDir, work)
            : await startDistServer({ root: path.join(distDir, 'browser'), contentDir }).then(
                ({ url, server: http }) => ({
                  base: url,
                  stop: () => new Promise<void>((resolve) => http.close(() => resolve())),
                }),
              );
      try {
        const failures = await runChecks(running.base, checks, server !== 'node');
        const count = checks.filter((c) => server !== 'node' || !c.serverOnly).length;
        if (failures.length) {
          failed = true;
          console.error(`[hosting] ${server}: ${failures.length} of ${count} checks failed`);
          for (const failure of failures) console.error(`  - ${failure}`);
        } else {
          console.error(`[hosting] ${server}: all ${count} checks passed`);
        }
      } finally {
        await running.stop();
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  if (failed) process.exit(1);
}
