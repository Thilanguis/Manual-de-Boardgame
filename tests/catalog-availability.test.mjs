import test from 'node:test';
import assert from 'node:assert/strict';
import { readableGame, annotateAvailability, unavailableReason } from '../js/catalog-availability.js';
import { createDriveStorage } from '../js/drive-storage.js';

test('estado derivado oculta PDF ausente, preserva original e descarta resultado de PDF substituído', () => {
  const game = { id: 'game', title: 'Teste', manual: { driveFileId: 'old' } };
  const statuses = new Map([['game', { manualId: 'old', result: { available: false, reason: 'trashed' } }]]);
  const [missing] = annotateAvailability([game], statuses);
  assert.equal(readableGame(missing), false);
  assert.match(unavailableReason(missing), /lixeira/);
  assert.equal(game._driveAvailability, undefined);
  const [replaced] = annotateAvailability([{ ...game, manual: { driveFileId: 'new' } }], statuses);
  assert.equal(readableGame(replaced), true);
  assert.equal(readableGame({ ...game, deleting: true }), false);
  statuses.set('game', { manualId: 'old', result: { available: true } });
  assert.equal(readableGame(annotateAvailability([game], statuses)[0]), true);
});

test('consulta divide jogos em lotes de até 20 e usa somente autenticação Firebase', async () => {
  const previous = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    return Response.json({ games: body.gameIds.map((id) => ({ id, available: true })) });
  };
  try {
    const storage = createDriveStorage(
      { apiBase: 'https://api.example.test' },
      async () => 'fixture-firebase-jwt',
      () => 'fixture',
    );
    const games = Array.from({ length: 45 }, (_, id) => ({ id: String(id) }));
    assert.equal((await storage.checkGames(games)).length, 45);
    assert.deepEqual(
      calls.map((call) => call.body.gameIds.length),
      [20, 20, 5],
    );
    for (const call of calls) {
      assert.equal(call.url, 'https://api.example.test/v1/catalog/status');
      assert.equal(call.init.headers.Authorization, 'Bearer fixture-firebase-jwt');
      assert.deepEqual(Object.keys(call.body), ['gameIds']);
    }
  } finally {
    globalThis.fetch = previous;
  }
});
