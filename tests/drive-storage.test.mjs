import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriveStorage } from '../js/drive-storage.js';

test('upload interrompido retoma após recarregar usando o mesmo jogo, UID e conteúdo', async () => {
  const oldFetch = globalThis.fetch,
    oldStorage = globalThis.localStorage;
  const states = new Map(),
    calls = [],
    id = '12345678-1234-1234-1234-123456789abc';
  globalThis.localStorage = {
    get length() {
      return states.size;
    },
    key: (index) => [...states.keys()][index],
    getItem: (key) => states.get(key) || null,
    setItem: (key, value) => states.set(key, value),
    removeItem: (key) => states.delete(key),
  };
  let sent = 0,
    interrupted = false;
  const blob = new Blob([new Uint8Array(8 * 1024 * 1024 + 3)], { type: 'application/pdf' });
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.headers.Authorization, 'Bearer firebase-jwt');
    if (url.endsWith('/uploads')) return Response.json({ ticket: 'opaque-ticket' });
    if (url.endsWith('/status')) return Response.json({ complete: false, received: sent });
    if (url.endsWith('/chunk')) {
      if (sent && !interrupted) {
        interrupted = true;
        return Response.json({ error: 'Entre novamente' }, { status: 401 });
      }
      sent += init.body.size;
      return Response.json(sent === blob.size ? { complete: true, received: sent, driveFileId: 'file123', receipt: 'opaque-receipt' } : { complete: false, received: sent });
    }
    if (url.endsWith('/finalize')) return Response.json({ ok: true });
    throw new Error('Unexpected URL');
  };
  const config = { apiBase: 'https://api.example.test', projectId: 'isolated-test' },
    options = { name: 'manual.pdf', fingerprint: 'a'.repeat(64) };
  const storage = () =>
    createDriveStorage(
      config,
      async () => 'firebase-jwt',
      () => 'owner',
    );
  try {
    await assert.rejects(
      storage().put(`games/${id}/manual.pdf`, blob, () => {}, options),
      (error) => error.status === 401,
    );
    assert.equal(storage().pendingGameId(options.fingerprint), id);
    assert.equal(
      createDriveStorage(
        config,
        async () => '',
        () => 'other-user',
      ).pendingGameId(options.fingerprint),
      '',
    );
    const result = await storage().put(`games/${id}/manual.pdf`, blob, () => {}, options);
    assert.equal(result.driveFileId, 'file123');
    assert.equal(calls.filter(({ url }) => url.endsWith('/uploads')).length, 1);
    assert.equal(calls.filter(({ url }) => url.endsWith('/chunk')).at(-1).init.headers['Content-Range'], `bytes 8388608-8388610/${blob.size}`);
    await storage().finalize(result);
    assert.equal(states.size, 0);
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.localStorage = oldStorage;
  }
});

test('leitor usa somente JWT Firebase e rejeita endereço de API inseguro', async () => {
  const good = createDriveStorage(
    { apiBase: 'https://api.example.test' },
    async () => 'firebase-jwt',
    () => 'owner',
  );
  const source = await good.readerSource({ id: 'game' });
  assert.deepEqual(source, { url: 'https://api.example.test/v1/games/game/manual', headers: { Authorization: 'Bearer firebase-jwt' } });
  for (const apiBase of ['', 'http://remote.example.test', 'https://user:secret@api.example.test', 'https://api.example.test/?token=secret'])
    await assert.rejects(
      createDriveStorage(
        { apiBase },
        async () => '',
        () => '',
      ).readerSource({ id: 'game' }),
    );
});
