import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { browserDependencies as require } from './browser-dependencies.mjs';
const { chromium } = require('playwright'),
  browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { externalRequests: [], errors: [], faults: [] };
const faults = async (value) => fetch('http://127.0.0.1:8788/faults', { method: 'POST', body: JSON.stringify(value) });
async function page() {
  const c = await browser.newContext({ serviceWorkers: 'block' });
  await c.route('**/*', (r) => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(r.request().url()).hostname)) {
      report.externalRequests.push(r.request().url());
      return r.abort();
    }
    return r.continue();
  });
  const p = await c.newPage();
  p.on('pageerror', (e) => report.errors.push(e.message));
  return p;
}
try {
  const unsafe = await page();
  await unsafe.route('**/config/app-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export const APP_CONFIG={firebase:{projectId:"manual-de-boardgame"},fileStorage:{apiBase:"https://remote.invalid"}};' }));
  await unsafe.goto('http://localhost:4173');
  await unsafe.locator('#login-error').filter({ hasText: 'bloqueada' }).waitFor();
  assert.equal(await unsafe.evaluate(() => !!globalThis.__ACERVO_METRICS__), false);
  report.productionConfigBlocked = true;
  await unsafe.context().close();
  const offline = await page();
  await offline.route('**/health', (r) => r.abort());
  await offline.goto('http://localhost:4173');
  await offline.locator('#login-error').filter({ hasText: 'Ambiente local desconectado' }).waitFor();
  assert.equal(await offline.locator('#login-submit').isDisabled(), true);
  report.noFallback = true;
  await offline.context().close();
  for (const status of [403, 429]) {
    await faults({ firestore: status });
    const p = await page();
    await p.goto('http://localhost:4173');
    await p.locator('#login-form [name=email]').fill('proprietario@acervo.test');
    await p.locator('#login-form [name=password]').fill('Acervo-teste-123');
    await p.locator('#login-submit').click();
    await p.waitForFunction(() => document.body.classList.contains('access-approved'));
    await p.waitForTimeout(1500);
    const before = (await (await fetch('http://127.0.0.1:8788/metrics')).json()).total;
    for (let i = 0; i < 12; i++) {
      await p.locator('#search').fill(i % 2 ? 'Ilha' : '');
      await p.evaluate(() => window.dispatchEvent(new Event('focus')));
    }
    await p.waitForTimeout(1700);
    const after = (await (await fetch('http://127.0.0.1:8788/metrics')).json()).total;
    assert.equal(after, before, 'Falha permanente não pode repetir consultas em cada render/foco.');
    report.faults.push({ status, repeatedRequests: after - before });
    await p.context().close();
    await faults({ firestore: 0 });
  }
  const p = await page();
  await p.goto('http://localhost:4173');
  await p.locator('#login-form [name=email]').fill('proprietario@acervo.test');
  await p.locator('#login-form [name=password]').fill('Acervo-teste-123');
  await p.locator('#login-submit').click();
  await p.waitForFunction(() => document.body.classList.contains('access-approved'));
  report.listenerAudit = await p.evaluate(async () => {
    const { createPreparationQueue } = await import('/js/preparation-queue.js');
    let active = 0,
      peak = 0;
    const game = { id: 'one', manual: { sha256: 'a'.repeat(64), pages: 1, name: 'manual.pdf' } };
    const games = Array.from({ length: 80 }, (_, i) => ({ ...game, id: String(i) }));
    const repo = {
      session: { canRead: true, user: { uid: 'audit' } },
      canPrepare: () => false,
      watchPreparation: () => {
        active++;
        peak = Math.max(peak, active);
        let stopped = false;
        return () => {
          if (!stopped) {
            active--;
            stopped = true;
          }
        };
      },
    };
    const queue = createPreparationQueue(repo, { scope: 'listener-audit' });
    await queue.update(games);
    const library = active;
    queue.observeGame(games[0]);
    await new Promise((r) => setTimeout(r, 100));
    const first = active;
    queue.observeGame(games[1]);
    await new Promise((r) => setTimeout(r, 100));
    const second = active;
    queue.stop();
    return { games: 80, library, first, second, peak, afterStop: active };
  });
  assert.deepEqual(report.listenerAudit, { games: 80, library: 0, first: 1, second: 1, peak: 1, afterStop: 0 });
  await p.context().close();
  const cachePage = await page();
  await cachePage.route('**/cacheKeys/**', (route) =>
    route.fulfill({
      status: route.request().method() === 'OPTIONS' ? 204 : 403,
      headers: { 'Access-Control-Allow-Origin': 'http://localhost:4173', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' },
      contentType: 'application/json',
      body: route.request().method() === 'OPTIONS' ? '' : '{"error":{"status":"PERMISSION_DENIED"}}',
    }),
  );
  await cachePage.goto('http://localhost:4173');
  await cachePage.locator('#login-form [name=email]').fill('proprietario@acervo.test');
  await cachePage.locator('#login-form [name=password]').fill('Acervo-teste-123');
  await cachePage.locator('#login-submit').click();
  await cachePage.waitForFunction(() => document.body.classList.contains('access-approved'));
  for (let i = 0; i < 5; i++) {
    const response = await fetch('http://127.0.0.1:8080/v1/projects/demo-acervo/databases/(default)/documents/users/dev-acervo-owner?updateMask.fieldPaths=name', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { name: { stringValue: `Proprietário fictício ${i}` } } }),
    });
    assert(response.ok);
  }
  await cachePage.waitForFunction(() => globalThis.__ACERVO_METRICS__.operations['reads:users/dev-acervo-owner'] >= 6);
  report.cacheDeniedGets = await cachePage.evaluate(() => globalThis.__ACERVO_METRICS__.rest['GET cacheKeys']);
  assert.equal(report.cacheDeniedGets, 1, 'Emissões do perfil não podem repetir o GET negado de cacheKeys.');
  assert.match(await cachePage.locator('#preparation-diagnostic').textContent(), /403/);
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await faults({ firestore: 0 });
  await writeFile('test-output/development-failures-report.json', JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
