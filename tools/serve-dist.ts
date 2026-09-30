/**
 * Serves the static build the way production hosting will: directory indexes, trailing-slash
 * redirects, the redirect map (301 / 410) and a real 404 page. Used for screenshots and e2e tests.
 *
 *   node tools/serve-dist.ts [--port=4300] [--content=src/content]
 */
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { ROOT } from './content-sync/config.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

interface Redirect {
  from: string;
  to: string;
  status: 301 | 410;
}

async function isFile(file: string): Promise<boolean> {
  return stat(file).then(
    (s) => s.isFile(),
    () => false,
  );
}

export async function startDistServer(
  options: { port?: number; root?: string; contentDir?: string } = {},
): Promise<{ url: string; server: Server }> {
  const root = options.root ?? path.join(ROOT, 'dist/compass-portal/browser');
  const contentDir = options.contentDir ?? path.join(ROOT, 'src/content');
  const redirects = new Map<string, Redirect>();
  try {
    const data = JSON.parse(await readFile(path.join(contentDir, 'redirects.json'), 'utf8')) as {
      redirects: Redirect[];
    };
    for (const r of data.redirects) redirects.set(r.from, r);
  } catch {
    // No snapshot: serve without redirects.
  }
  const notFoundPage = (await isFile(path.join(root, '404.html')))
    ? path.join(root, '404.html')
    : path.join(root, '404/index.html');

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    const send = (status: number, file: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, {
        'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        ...headers,
      });
      createReadStream(file).pipe(res);
    };

    const redirect = redirects.get(pathname + url.search) ?? redirects.get(pathname);
    if (redirect?.status === 301) {
      res.writeHead(301, { location: redirect.to });
      res.end();
      return;
    }
    if (redirect?.status === 410) return send(410, notFoundPage);

    const target = path.join(root, pathname);
    if (!target.startsWith(root)) return send(404, notFoundPage);
    if (pathname.endsWith('/')) {
      const index = path.join(target, 'index.html');
      return (await isFile(index)) ? send(200, index) : send(404, notFoundPage);
    }
    if (await isFile(target)) return send(200, target);
    if (await isFile(path.join(target, 'index.html'))) {
      res.writeHead(301, { location: `${pathname}/${url.search}` });
      res.end();
      return;
    }
    send(404, notFoundPage);
  });

  const port = options.port ?? 0;
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  const actual = typeof address === 'object' && address ? address.port : port;
  return { url: `http://127.0.0.1:${actual}`, server };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const flag = (name: string) =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const { url } = await startDistServer({
    port: Number(flag('port') ?? 4300),
    ...(flag('content') ? { contentDir: path.resolve(ROOT, flag('content')!) } : {}),
  });
  console.error(`[serve-dist] ${url}`);
}
