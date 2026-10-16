import '../scripts/test-guard.mjs';
// Servidor efêmero e perfil Chrome isolado para reproduzir cache HTTP/PWA antigo.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
const root = resolve('.');
let revision = 0;
const sw = await readFile('service-worker.js', 'utf8');
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const index = `<!doctype html><html><body><p id="release">${revision}</p><input id="draft"/><p id="notice"></p><button id="update" hidden>Atualizar</button><script type="module">
    import {setupPwa} from '/js/pwa.js';
    window.testEditing=false;
    setupPwa({isBusy:()=>window.testEditing,onInstallReady:()=>{},onNotice:(message,action,label)=>{document.getElementById('notice').textContent=message;const button=document.getElementById('update');button.hidden=!action;button.textContent=label||'';button.onclick=action;}});
  </script></body></html>`;
  try {
    const allowed = ['/', '/index.html', '/service-worker.js', '/manifest.webmanifest'];
    if (!allowed.includes(path) && !/^\/(?:js|assets|styles|vendor)\/[\w./-]+$/.test(path) && path !== '/config/app-config.js') throw new Error('Not found');
    if (path.includes('..')) throw new Error('Invalid path');
    const data =
      path === '/' || path === '/index.html'
        ? index
        : path === '/service-worker.js'
          ? sw.replace(/const VERSION = '[^']+'/, `const VERSION = 'acervo-v-fixture-${revision}'`)
          : path === '/js/pwa.js'
            ? 'globalThis.__pwaBuild=' + revision + ';\n' + (await readFile(resolve(root, '.' + path), 'utf8'))
            : await readFile(resolve(root, '.' + path));
    const type =
      path === '/' || path.endsWith('.html')
        ? 'text/html'
        : /\.(mjs|js)$/.test(path)
          ? 'application/javascript'
          : path.endsWith('.css')
            ? 'text/css'
            : { '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' }[extname(path)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': path === '/service-worker.js' ? 'no-store' : 'public, max-age=86400' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`,
  browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.equal(await page.locator('#release').textContent(), '0');
  assert.equal(await page.evaluate(() => window.__pwaBuild), 0);
  await page.locator('#draft').fill('Dados em edição preservados');
  await page.evaluate(() => (window.testEditing = true));
  revision = 1;
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
  });
  await page.locator('#update').waitFor({ state: 'visible' });
  await page.locator('#update').click();
  await page.waitForFunction(() => document.getElementById('notice').textContent.includes('Salve ou cancele'));
  assert.equal(await page.locator('#draft').inputValue(), 'Dados em edição preservados');
  assert.equal(await page.locator('#release').textContent(), '0');
  assert.equal(await page.locator('#update').isVisible(), true, 'Atualização permanece disponível após recusar por edição em andamento');
  await page.evaluate(() => (window.testEditing = false));
  await page.locator('#update').click();
  await page.waitForFunction(() => document.getElementById('release').textContent === '1');
  assert.equal(await page.evaluate(() => window.__pwaBuild), 1, 'Novo JavaScript substituiu a versão mantida no cache HTTP');
  const cachesLeft = await page.evaluate(() => caches.keys());
  assert(cachesLeft.includes('acervo-v-fixture-1-shell'));
  assert(!cachesLeft.includes('acervo-v-fixture-0-shell'));
  assert.deepEqual(errors, []);
  console.log('PWA atualizou HTML/JS mesmo com cache HTTP de 24h, preservou edição pendente e removeu somente o shell antigo.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
