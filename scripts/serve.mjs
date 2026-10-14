import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, relative, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2),
  port = Number(process.env.PORT || 4173),
  host = args.includes('--lan') ? '0.0.0.0' : '127.0.0.1';
const allowedRoots = new Set(['index.html', 'manifest.webmanifest', 'service-worker.js', 'assets', 'styles', 'js', 'vendor', 'config']);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
};
const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405);
      response.end();
      return;
    }
    const url = new URL(request.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    const file = resolve(root, '.' + path),
      rel = relative(root, file);
    if (rel.startsWith('..') || !file.startsWith(root + sep) || !allowedRoots.has(rel.split(sep)[0]) || (rel.startsWith(`config${sep}`) && rel !== `config${sep}app-config.js`)) {
      response.writeHead(404);
      response.end();
      return;
    }
    if (!(await stat(file)).isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(404);
    response.end('Recurso não encontrado.');
  }
});
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, host, () => console.log(`Acervo: http://localhost:${port}${host === '0.0.0.0' ? ' (acesso na rede local habilitado; PWA exige HTTPS fora do localhost)' : ''}`));
