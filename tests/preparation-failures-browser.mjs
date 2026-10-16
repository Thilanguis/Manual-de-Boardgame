import '../scripts/test-guard.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json')),
  { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/js/app.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  const page = await context.newPage();
  await page.goto(process.env.ACERVO_TEST_URL || 'http://localhost:4174');
  const result = await page.evaluate(async () => {
    const { createPreparationQueue } = await import('/js/preparation-queue.js');
    const cache = await import('/js/private-cache.js');
    cache.requirePrivateCache();
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    await cache.unlockPrivateCache('test', bytes);
    await cache.privateValue('sample', { text: 'CONTEUDO PRIVADO' });
    const stored = await new Promise((resolve) => {
      const r = indexedDB.open('acervo-private-v1');
      r.onsuccess = () => {
        const q = r.result.transaction('entries').objectStore('entries').getAll();
        q.onsuccess = () => resolve(q.result);
      };
    });
    const encrypted = stored.every((record) => record.data instanceof ArrayBuffer && !new TextDecoder().decode(record.data).includes('CONTEUDO PRIVADO'));
    cache.lockPrivateCache();
    const locked = await cache.privateValue('sample');
    await cache.unlockPrivateCache('test', bytes);
    const restored = await cache.privateValue('sample');
    let calls = 0;
    const game = { id: '12345678-1234-1234-1234-123456789abc', language: 'pt-BR', manual: { sha256: 'a'.repeat(64), pages: 1, name: 'Manual.pdf' } };
    const repository = {
      session: { canRead: true, user: { uid: 'test' } },
      canPrepare: () => true,
      latestGame: async () => {
        calls++;
        const e = new Error('Rede indisponível');
        e.status = 503;
        throw e;
      },
    };
    const queue = createPreparationQueue(repository, { scope: 'failures', retryDelay: () => 20 });
    await queue.update([game]);
    await new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (queue.entries()[0]?.state === 'attention') {
          clearInterval(timer);
          resolve();
        }
      }, 10);
      setTimeout(() => {
        clearInterval(timer);
        reject(new Error('Tentativas não terminaram.'));
      }, 3000);
    });
    const attempts = queue.entries()[0].attempts;
    await new Promise((resolve) => setTimeout(resolve, 120));
    queue.stop();
    let release,
      reads = 0;
    const late = {
      session: { canRead: true, user: { uid: 'test' } },
      canPrepare: () => true,
      latestGame: () => new Promise((resolve) => (release = resolve)),
      getTechnicalIndex: async () => {
        reads++;
        return null;
      },
    };
    const second = createPreparationQueue(late, { scope: 'revoked' });
    await second.update([game]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    late.session.canRead = false;
    second.stop();
    release(game);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const { cachedIndex } = await import('/js/index-cache.js');
    const pausedKey = `${game.id}:main:${game.manual.sha256}`;
    await cachedIndex('preparation:paused-metadata:test', [{ key: pausedKey, gameId: game.id, documentId: 'main', sourceHash: game.manual.sha256, state: 'paused' }]);
    let pausedCalls = 0;
    const pausedRepo = {
      session: { canRead: true, user: { uid: 'test' } },
      canPrepare: () => true,
      latestGame: async () => {
        pausedCalls++;
        throw new Error('Não deveria executar');
      },
      watchPreparation: (game, callback) => {
        setTimeout(() => callback([{ documentId: 'main', sourceHash: game.manual.sha256, state: 'partial', readablePages: 1 }]), 0);
        return () => {};
      },
    };
    const pausedQueue = createPreparationQueue(pausedRepo, { scope: 'paused-metadata' });
    await pausedQueue.update([game]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const pausedState = pausedQueue.entries()[0].state;
    pausedQueue.stop();
    const retryGame = { ...game, manual: { ...game.manual, pages: 2 } };
    let recovered = {
      schemaVersion: 1,
      gameId: game.id,
      sourceHash: game.manual.sha256,
      pageCount: 2,
      language: 'pt-BR',
      analysisComplete: true,
      pages: [
        { page: 1, text: 'Texto correto que já foi processado e não deve ser analisado novamente.', ocrStatus: 'done' },
        { page: 2, text: '', ocrStatus: 'failed' },
      ],
      headings: [],
    };
    let retryReads = 0;
    const retried = [];
    const retryRepo = {
      session: { canRead: true, user: { uid: 'test' } },
      canPrepare: () => true,
      latestGame: async () => retryGame,
      getTechnicalIndex: async () => structuredClone(recovered),
      getDocumentManual: async () => {
        retryReads++;
        return new Blob(['fixture']);
      },
      saveTechnicalIndex: async (g, d, value) => {
        recovered = structuredClone(value);
      },
    };
    const recovery = createPreparationQueue(retryRepo, {
      scope: 'real-failure-retry',
      analyze: async (blob, g, { previous }) => previous,
      ocr: async (blob, g, index, { retry }) => {
        if (!retry) throw new Error('A página falhou antes desta tentativa.');
        retried.push(2);
        index.pages[1] = { page: 2, text: 'Texto recuperado após a tentativa explícita de uma página que falhou.', ocrStatus: 'done' };
        return index;
      },
    });
    const waitState = (state) =>
      new Promise((resolve, reject) => {
        const poll = setInterval(() => {
          if (recovery.entries()[0]?.state === state) {
            clearInterval(poll);
            resolve();
          }
        }, 10);
        setTimeout(() => {
          clearInterval(poll);
          reject(new Error('Recuperação não terminou'));
        }, 3000);
      });
    await recovery.update([retryGame]);
    await waitState('partial');
    recovery.resume(retryGame, { id: 'main', manual: retryGame.manual }, { retryFailed: true });
    await waitState('ready');
    recovery.stop();
    await cache.purgePrivateCaches();
    return { pausedState, pausedCalls, encrypted, locked, restored, attempts, calls, reads, retryReads, retried, recoveredText: recovered.pages[0].text, remaining: await cache.privateValue('sample') };
  });
  assert.equal(result.pausedState, 'paused');
  assert.equal(result.pausedCalls, 0);
  assert.equal(result.encrypted, true);
  assert.equal(result.locked, null);
  assert.equal(result.restored.text, 'CONTEUDO PRIVADO');
  assert.equal(result.attempts, 3);
  assert.equal(result.calls, 3);
  assert.equal(result.reads, 0);
  assert.equal(result.remaining, null);
  assert.equal(result.retryReads, 1);
  assert.deepEqual(result.retried, [2]);
  assert.match(result.recoveredText, /já foi processado/);
  console.log('Falhas limitadas a três tentativas; revogação interrompe tarefa pendente; cache cifrado bloqueia leitura sem chave e é apagado ao sair.');
} finally {
  await browser.close();
}
