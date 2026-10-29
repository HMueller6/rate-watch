#!/usr/bin/env node
// Zero-dependency static server for the app:  node scripts/serve.mjs [port]
// Listens on all interfaces so a phone on the same Wi-Fi can open it (http://<computer-ip>:8080).
// Note: "Add to Home Screen"/install and offline mode need HTTPS when not on localhost; deploy to any static host for that.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC_DIRS = ['css', 'js', 'data', 'icons'];
const PUBLIC_FILES = ['index.html', 'sw.js', 'manifest.webmanifest'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

export function createApp() {
  return createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const rel = normalize(p).replace(/^[/\\]+/, '');
      const top = rel.split(sep)[0];
      if (rel.includes('..') || !(PUBLIC_FILES.includes(rel) || PUBLIC_DIRS.includes(top))) { res.writeHead(404).end('Not found'); return; }
      const file = join(root, rel);
      if (!file.startsWith(root) || !(await stat(file)).isFile()) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || process.env.PORT || 8080);
  createApp().listen(port, '0.0.0.0', () => {
    console.log(`Rate Watch on http://localhost:${port}`);
    for (const list of Object.values(networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`  on your network: http://${i.address}:${port}`);
  });
}
