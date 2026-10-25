import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriveStorage } from '../js/drive-storage.js';
import { driveWarning } from '../js/drive-diagnostics.js';
import { fileErrorMessage } from '../js/file-errors.js';

test('capa pendente tem prazo e libera a sonda sem disparar vinte novas tentativas', async (t) => {
  const previous = globalThis.fetch,
    controller = new AbortController();
  let calls = 0;
  t.mock.method(AbortSignal, 'timeout', (ms) => {
    assert.equal(ms, 45000);
    return controller.signal;
  });
  globalThis.fetch = async (url, options) => {
    calls++;
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  };
  const storage = createDriveStorage(
    { apiBase: 'https://api.example.test' },
    async () => 'fixture',
    () => 'approved',
  );
  try {
    const pending = Array.from({ length: 20 }, () => storage.get({ id: 'one' }, 'cover', 1024));
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort(new DOMException('Prazo excedido', 'TimeoutError'));
    const results = await Promise.allSettled(pending);
    assert(results.every((result) => result.status === 'rejected' && result.reason.code === 'drive/unavailable'));
    assert.equal(calls, 1);
    t.mock.restoreAll();
    globalThis.fetch = async () => new Response('capa preservada');
    storage.retryConnection();
    assert.equal(await (await storage.get({ id: 'one' }, 'cover', 1024)).text(), 'capa preservada');
  } finally {
    storage.close();
    globalThis.fetch = previous;
  }
});

test('503 OAuth pausa lote de capas e índices; catálogo e permissões preservados; leitura retoma por ação explícita', async () => {
  const previous = globalThis.fetch;
  const status = [],
    requests = [],
    games = [{ id: 'one', title: 'Jogo preservado', manual: { driveFileId: 'pdf' } }];
  const before = structuredClone(games);
  let connected = false;
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    assert.equal(init.headers.Authorization, 'Bearer fixture-firebase');
    if (!connected) return Response.json({ error: 'private-detail', code: 'drive/oauth-expired', retryAfter: 60 }, { status: 503 });
    if (url.endsWith('/catalog/status')) return Response.json({ games: [{ id: 'one', available: true }] });
    return new Response('unchanged-file');
  };
  const storage = createDriveStorage(
    { apiBase: 'https://api.example.test' },
    async () => 'fixture-firebase',
    () => 'approved',
    (issue) => status.push(issue),
  );
  try {
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => storage.get(games[0], 'cover', 1024)));
    assert(results.every((r) => r.status === 'rejected' && r.reason.code === 'drive/oauth-expired'));
    assert.equal(requests.length, 1, 'primeira falha interrompe a rajada de leituras');
    await assert.rejects(storage.get(games[0], 'manual', 1024), { code: 'drive/oauth-expired' });
    await assert.rejects(storage.checkGames(games), { code: 'drive/oauth-expired' });
    assert.equal(requests.length, 1);
    assert.deepEqual(games, before);
    assert.match(driveWarning(status[0], true), /proprietário precisa renovar/);
    assert.doesNotMatch(driveWarning(status[0], false), /secret|token|private-detail/);
    assert.equal(fileErrorMessage({ code: 'drive/oauth-expired', status: 503 }), driveWarning(status[0], true));
    connected = true;
    storage.retryConnection();
    assert.deepEqual(await storage.checkGames(games), [{ id: 'one', available: true }]);
    assert.equal(await (await storage.get(games[0], 'cover', 1024)).text(), 'unchanged-file');
    assert.equal(await (await storage.get(games[0], 'guide-assets/index', 1024)).text(), 'unchanged-file');
    assert.equal(status.at(-1), null);
    assert.deepEqual(games, before);
    assert(requests.every(({ init }) => !init.method || ['GET', 'POST'].includes(init.method)));
    assert(requests.filter(({ init }) => init.method === 'POST').every(({ url }) => url.endsWith('/catalog/status')));
    const denied = createDriveStorage(
      { apiBase: 'https://api.example.test' },
      async () => '',
      () => '',
    );
    await assert.rejects(denied.get(games[0], 'cover', 1024), /aprovada/);
  } finally {
    storage.close();
    globalThis.fetch = previous;
  }
});
test('falha em um arquivo não bloqueia a leitura de outro; 503 antigo é temporário', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => (++calls === 1 ? Response.json({ code: 'drive/file-permission' }, { status: 403 }) : new Response('other-file'));
  const storage = createDriveStorage(
    { apiBase: 'https://api.example.test' },
    async () => 'fixture',
    () => 'approved',
  );
  try {
    await assert.rejects(storage.get({ id: 'one' }, 'cover', 1024), { code: 'drive/file-permission' });
    assert.equal(await (await storage.get({ id: 'two' }, 'cover', 1024)).text(), 'other-file');
    globalThis.fetch = async () => Response.json({ error: 'Mensagem antiga sem diagnóstico' }, { status: 503 });
    await assert.rejects(storage.get({ id: 'two' }, 'cover', 1024), { code: 'drive/unavailable' });
  } finally {
    storage.close();
    globalThis.fetch = previous;
  }
});
