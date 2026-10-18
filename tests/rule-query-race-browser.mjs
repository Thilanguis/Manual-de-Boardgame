import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { browserDependencies } from './browser-dependencies.mjs';
const { chromium } = browserDependencies('playwright');
const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
  await page.route('**/__query-race', (route) => route.fulfill({ contentType: 'text/html', body: markup }));
  const markup = (await readFile('index.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  await page.goto(base + '/__query-race');
  await page.evaluate(async () => {
    document.body.classList.add('access-approved');
    document.getElementById('session-loading').hidden = true;
    const NativeWorker = window.Worker;
    window.queries = [];
    window.Worker = class {
      constructor(url, options) {
        this.worker = new NativeWorker(url, options);
        this.worker.onmessage = (event) => { if (event.data.query === 'Componentes') window.releaseOldAnswer = () => this.onmessage?.(event); else this.onmessage?.(event); };
        this.worker.onerror = (event) => this.onerror?.(event);
      }
      postMessage(data) {
        if (data.type === 'query') window.queries.push(data.query);
        this.worker.postMessage(data);
      }
    };
    const { createGuidePanel } = await import('/js/guide-panel.js');
    window.game = { id: 'race', title: 'Teste isolado', language: 'pt-BR', manual: { sha256: 'a'.repeat(64), pages: 1 } };
    window.repository = {
      session: { canRead: true, user: { uid: 'race-user' } },
      getGuide: async () => null,
      getKnowledge: async () => null,
      getTechnicalIndex: async () => ({
        schemaVersion: 1,
        gameId: window.game.id,
        sourceHash: window.game.manual.sha256,
        pageCount: 1,
        pages: [{ page: 1, text: 'COMPONENTES\nDoze cartas e oito fichas.\nTURNOS\nCada jogador realiza duas ações.' }],
        headings: [],
      }),
    };
    window.panel = createGuidePanel({ repository: window.repository, openManual() {}, scope: 'isolated-race' });
    await window.panel.open(window.game);
  });
  await page.locator('#guide-search').fill('Componentes');
  await page.waitForFunction(() => !!window.releaseOldAnswer);
  await page.locator('#guide-search').fill('Turnos');
  await page.evaluate(() => window.releaseOldAnswer());
  assert.equal(await page.locator('.rule-result h3').filter({ hasText: 'COMPONENTES' }).count(), 0, 'resposta anterior é descartada antes do debounce');
  await page.waitForFunction(() => document.querySelector('#guide-content').dataset.query === 'Turnos' && document.querySelector('.rule-result h3')?.textContent === 'TURNOS');
  await page.evaluate(() => {
    window.panel.close();
    window.game = { ...window.game, id: 'revocation' };
    window.repository.getManual = () =>
      new Promise((resolve) => {
        window.releaseManual = resolve;
      });
    window.pendingOpen = window.panel.open(window.game);
  });
  await page.waitForFunction(() => !!window.releaseManual);
  await page.evaluate(async () => {
    window.repository.session.canRead = false;
    window.panel.updateSession(window.repository.session);
    window.releaseManual(null);
    await window.pendingOpen;
  });
  assert.equal(await page.locator('#guide-dialog').evaluate((d) => d.open), false);
  assert.equal(await page.locator('#guide-content').textContent(), '');
  const cache = await page.evaluate(async () => {
    const { cachedIndex } = await import('/js/index-cache.js');
    return cachedIndex('rule-layout-v1:isolated-race:race-user:revocation:' + window.game.manual.sha256);
  });
  assert.equal(cache, null, 'revogação não grava projeção obtida em operação antiga');
  assert.deepEqual(errors, []);
  console.log('Chrome: respostas atrasadas descartadas ao digitar; revogação cancela organização e não deixa conteúdo ou projeção tardia.');
} finally {
  await browser.close();
}
