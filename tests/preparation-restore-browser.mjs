import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await context.route('**/js/app.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  const page = await context.newPage();
  await page.goto(process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186');
  const result = await page.evaluate(async () => {
    const { createPreparationQueue } = await import('/js/preparation-queue.js');
    const { cachedIndex } = await import('/js/index-cache.js');
    const cache = await import('/js/private-cache.js');
    cache.requirePrivateCache();
    await cache.unlockPrivateCache('restore', crypto.getRandomValues(new Uint8Array(32)));
    const games = Array.from({ length: 12 }, (_, i) => ({ id: `game-${i}`, language: 'pt-BR', manual: { sha256: 'a'.repeat(64), pages: 1, name: 'Manual.pdf' } }));
    const jobs = games.map((g) => ({ key: `${g.id}:main:${g.manual.sha256}`, gameId: g.id, documentId: 'main', sourceHash: g.manual.sha256, state: 'ready', current: 1, total: 1 }));
    const storageKey = 'preparation:restore:restore';
    await cachedIndex(storageKey, jobs);
    let latest = 0,
      indexes = 0,
      analyses = 0,
      listeners = 0;
    const repository = {
      session: { canRead: true, user: { uid: 'restore' } },
      canPrepare: () => true,
      latestGame: async (g) => {
        latest++;
        return g;
      },
      getTechnicalIndex: async (g) => {
        indexes++;
        return {
          schemaVersion: 1,
          gameId: g.id,
          sourceHash: g.manual.sha256,
          language: 'pt-BR',
          pageCount: 1,
          analysisComplete: true,
          headings: [],
          pages: [{ page: 1, text: 'Preparação: distribua quatro cartas para cada jogador e coloque as peças no tabuleiro.', extracted: true }],
        };
      },
      watchPreparation: () => {
        listeners++;
        return () => listeners--;
      },
    };
    const queue = createPreparationQueue(repository, {
      scope: 'restore',
      analyze: () => {
        analyses++;
        throw new Error('Não deve reanalisar.');
      },
    });
    await queue.update([], { loading: true });
    queue.observeGame(games[0]);
    const savedWhileLoading = (await cachedIndex(storageKey)).length;
    await Promise.all([queue.update(games), queue.update(games)]);
    await new Promise((r) => setTimeout(r, 120));
    const restored = queue.entries().length,
      initialReads = latest + indexes;
    const changed = { ...games[0], manual: { ...games[0].manual, sha256: 'b'.repeat(64) } };
    await queue.update([changed, ...games.slice(1)]);
    await new Promise((resolve, reject) => {
      const end = Date.now() + 3000;
      const timer = setInterval(() => {
        if (queue.entries().some((j) => j.gameId === changed.id && j.sourceHash === changed.manual.sha256 && j.state === 'ready')) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() > end) {
          clearInterval(timer);
          reject(new Error('Hash novo não foi conferido.'));
        }
      }, 10);
    });
    queue.observeGame(null);
    const listenersAfterClose = listeners;
    await queue.update([], { loading: true });
    const transientCount = queue.entries().length;
    await queue.update([], { loading: false });
    const finalCount = queue.entries().length;
    queue.destroy();
    return { savedWhileLoading, restored, initialReads, latest, indexes, analyses, listenersAfterClose, transientCount, finalCount };
  });
  assert.deepEqual(result, { savedWhileLoading: 12, restored: 12, initialReads: 0, latest: 1, indexes: 1, analyses: 0, listenersAfterClose: 0, transientCount: 12, finalCount: 0 });
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
