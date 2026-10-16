/**
 * serve.mjs — a tiny static file server for local development.
 *
 * Any static server works; this one exists so `npm start` needs no dependencies
 * and sets the headers ES modules need.
 *
 *   npm start            → http://localhost:5173
 *   PORT=8080 npm start
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
};

// Send the same headers Vercel will (vercel.json), so the app is developed and
// tested under the production security policy. Only the `/(.*)` style of
// source pattern is supported, which is all vercel.json uses.
const EXTRA_HEADERS = (() => {
  try {
    const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
    return (config.headers || []).map((rule) => ({
      pattern: new RegExp('^' + rule.source.replace(/\(\.\*\)/g, '.*') + '$'),
      headers: Object.fromEntries(rule.headers.map((h) => [h.key.toLowerCase(), h.value])),
    }));
  } catch {
    return [];
  }
})();
const headersFor = (pathname) => Object.assign({},
  ...EXTRA_HEADERS.filter((rule) => rule.pattern.test(pathname)).map((rule) => rule.headers));

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';

    // Contain everything inside the project directory.
    const target = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!target.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }

    const body = await readFile(target);
    res.writeHead(200, {
      ...headersFor(url.pathname),
      'content-type': TYPES[extname(target)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    }).end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end(String(err));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Cubix running at http://localhost:${PORT}  (serving ${ROOT})`);
});
