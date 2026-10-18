import test from 'node:test';
import assert from 'node:assert/strict';
import { observeKnowledge } from '../js/knowledge-observer.js';
const game = { id: 'fixture', title: 'Jogo', manual: { sha256: 'a'.repeat(64), pages: 1 } };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test('dois consumidores compartilham requisição e um acompanhamento, que termina no último fechamento', async () => {
  let calls = 0,
    release,
    signal;
  const received = [[], []];
  const repo = {
    session: { canRead: true, user: { uid: 'owner' } },
    getKnowledge: async (_, options) => {
      calls++;
      signal = options.signal;
      if (calls === 1)
        return new Promise((r) => {
          release = r;
        });
      return { status: 'ready', knowledge: null };
    },
  };
  const first = observeKnowledge(repo, game, { interval: 15, onRecord: (v) => received[0].push(v.status) });
  const second = observeKnowledge(repo, game, { interval: 15, onRecord: (v) => received[1].push(v.status) });
  const one = first.refresh(),
    two = second.refresh();
  await pause(0);
  assert.equal(calls, 1);
  release({ status: 'running' });
  await Promise.all([one, two]);
  first.close();
  await pause(65);
  assert.equal(calls, 2);
  assert.deepEqual(received, [['running'], ['running', 'ready']]);
  second.close();
  assert.equal(signal.aborted, true);
  await pause(30);
  assert.equal(calls, 2);
});

test('fechamento cancela requisição em andamento e ignora resposta atrasada', async () => {
  let finish,
    notified = 0,
    signal;
  const repo = {
    session: { canRead: true, user: { uid: 'one' } },
    getKnowledge: (_, options) => {
      signal = options.signal;
      return new Promise((r) => {
        finish = r;
      });
    },
  };
  const watcher = observeKnowledge(repo, game, { onRecord: () => notified++ });
  const pending = watcher.refresh();
  await pause(0);
  watcher.close();
  assert.equal(signal.aborted, true);
  finish({ status: 'running' });
  await pending;
  await pause(20);
  assert.equal(notified, 0);
});

test('UID e versão do documento isolam acompanhamento; leitura nunca gera IA', async () => {
  let reads = 0,
    writes = 0;
  const repo = {
    session: { canRead: true, user: { uid: 'one' } },
    getKnowledge: async () => {
      reads++;
      return { status: 'ready' };
    },
    generateKnowledge: () => writes++,
  };
  const first = observeKnowledge(repo, game, {});
  await first.refresh();
  repo.session.user = { uid: 'two' };
  const second = observeKnowledge(repo, game, {});
  await second.refresh();
  const changed = observeKnowledge(repo, { ...game, manual: { ...game.manual, sha256: 'b'.repeat(64) } }, {});
  await changed.refresh();
  assert.equal(reads, 3);
  assert.equal(writes, 0);
  first.close();
  second.close();
  changed.close();
});

test('resposta pendente não notifica nem continua após troca de conta ou revogação', async () => {
  for (const change of ['account', 'permission']) {
    let finish,
      calls = 0,
      notified = 0;
    const repo = {
      session: { canRead: true, user: { uid: 'one' } },
      getKnowledge: () => {
        calls++;
        return new Promise((r) => {
          finish = r;
        });
      },
    };
    const watcher = observeKnowledge(repo, game, { interval: 10, onRecord: () => notified++ });
    const pending = watcher.refresh();
    await pause(0);
    if (change === 'account') repo.session.user = { uid: 'two' };
    else repo.session.canRead = false;
    finish({ status: 'running' });
    await pending;
    await pause(30);
    await watcher.refresh();
    assert.equal(notified, 0);
    assert.equal(calls, 1);
    watcher.close();
  }
});
