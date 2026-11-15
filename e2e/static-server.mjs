// Sert l'export web (dossier passé en argument) avec repli sur index.html pour
// les routes de l'application. Usage : node e2e/static-server.mjs <dossier> [port]

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] || 'dist');
const port = Number(process.argv[3] || 8081);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.svg': 'image/svg+xml',
};

http
  .createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = normalize(join(root, pathname));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    } catch {
      file = extname(pathname) ? file : join(root, 'index.html'); // route de l'app → index.html
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(port, () => console.log(`[static] ${root} → http://localhost:${port}`));
