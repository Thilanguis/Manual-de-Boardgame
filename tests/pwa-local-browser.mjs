import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { browserDependencies } from './browser-dependencies.mjs';
const { chromium } = browserDependencies('playwright');
const current = await readFile('service-worker.js', 'utf8');
let retired = false;
const old = `self.addEventListener('install',e=>e.waitUntil(caches.open('acervo-fixture-shell').then(c=>c.put('/index.html',new Response('<p id="version">antigo</p>',{headers:{'Content-Type':'text/html'}})))));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(caches.open('acervo-fixture-shell').then(c=>c.match('/index.html')))});`;
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': req.url === '/service-worker.js' ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' });
  res.end(req.url === '/service-worker.js' ? (retired ? current : old) : '<p id="version">atual</p>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/service-worker.js');
    await navigator.serviceWorker.ready;
    localStorage.setItem('acervo:fixture:preservar', 'conta preservada');
    await (await caches.open('outro-aplicativo')).put('/outro', new Response('preservar'));
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.reload();
  assert.equal(await page.locator('#version').textContent(), 'antigo');
  retired = true;
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  await page.waitForFunction(async () => !(await navigator.serviceWorker.getRegistration()));
  await page.reload();
  assert.equal(await page.locator('#version').textContent(), 'atual');
  assert.equal(await page.evaluate(() => localStorage.getItem('acervo:fixture:preservar')), 'conta preservada');
  const remaining = await page.evaluate(() => caches.keys());
  assert.ok(!remaining.includes('acervo-fixture-shell'));
  assert.ok(remaining.includes('outro-aplicativo'));
  console.log('127.0.0.1: worker antigo retirado, HTML atual carregado e dados da conta/cache alheio preservados.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
