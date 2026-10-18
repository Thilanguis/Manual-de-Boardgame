import test from 'node:test';
import assert from 'node:assert/strict';
import { createInformationFlow } from '../js/information-flow.js';

const hash = 'a'.repeat(64);
const text = 'Jogo para 2 a 4 jogadores. Duração: 30 a 60 minutos. Idade: 14 anos.';
const profile = { recommendedAge: { value: 14, sourceId: 'manual', page: 1, quote: text } };
function setup(initial, extra = {}) {
  const game = { id: 'game', title: 'Jogo', edition: '3', language: 'pt-BR', manual: { sha256: hash, pages: 1 } };
  const messages = [],
    records = [],
    calls = [];
  let callbacks,
    closed = 0;
  const repository = {
    session: { user: { uid: 'owner' }, canRead: true, canWrite: true, storageStatus: { knowledgeConfigured: true, manualAiEnabled: true } },
    generateKnowledge: async (g, o) => {
      calls.push(o);
      return { status: 'running' };
    },
    ...extra,
  };
  const flow = createInformationFlow({
    getRepository: () => repository,
    getCurrent: () => game,
    canUse: () => true,
    draftProfile: { prepare: async () => {}, cancel() {} },
    onRecord: (r) => records.push(r),
    onStatus: (s) => messages.push(s),
    observe(r, g, c) {
      callbacks = c;
      return {
        refresh: async () => c.onRecord(initial),
        update: c.onRecord,
        close() {
          closed++;
        },
      };
    },
  });
  return { flow, game, repository, messages, records, calls, emit: (r) => callbacks.onRecord(r), closed: () => closed };
}
const legacy = () => ({
  status: 'ready',
  knowledge: { title: 'Jogo', edition: '3', sources: [{ id: 'manual', documentId: 'main', sourceHash: hash, language: 'pt-BR', pages: [{ page: 1, text }] }], sections: [{ id: 'corrected', text: 'Correção manual', review: 'manual' }], fields: {} },
});
test('legado: abrir não gera; completar explicitamente atualiza a ficha com uma geração forçada', async () => {
  const f = setup(legacy());
  await f.flow.load();
  assert.equal(f.calls.length, 0);
  await Promise.all([f.flow.complete(), f.flow.complete()]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].force, true);
  assert(f.messages.some((s) => /cota/i.test(s)));
  f.flow.stop();
});
test('ficha com evidência válida é reutilizada, objeto profile vazio não basta', async () => {
  const value = legacy();
  value.knowledge.profile = profile;
  const f = setup(value);
  await f.flow.complete();
  assert.equal(f.calls.length, 0);
  f.flow.stop();
  const invalid = legacy();
  invalid.knowledge.profile = {};
  const g = setup(invalid);
  await g.flow.complete();
  assert.equal(g.calls.length, 1);
  g.flow.stop();
});
for (const field of ['title', 'edition', 'manual'])
  test(`resposta pendente após mudar ${field} não aplica nem mantém acompanhamento`, async () => {
    const f = setup({ status: 'running' });
    await f.flow.load();
    const before = f.records.length;
    if (field === 'manual') f.game.manual = { ...f.game.manual, sha256: 'b'.repeat(64) };
    else f.game[field] = 'Outra identidade';
    f.flow.invalidate?.();
    f.emit(legacy());
    assert.equal(f.records.length, before);
    assert.equal(f.closed(), 1);
    assert.equal(f.flow.isBusy(), false);
    f.flow.stop();
  });
test('resposta de geração e erro tardios não passam para a identidade nova', async () => {
  let finish;
  const f = setup(null, { generateKnowledge: () => new Promise((r) => (finish = r)) });
  const task = f.flow.complete();
  await new Promise((r) => setImmediate(r));
  const before = f.records.length;
  f.game.title = 'Outro jogo';
  finish(legacy());
  await task;
  assert.equal(f.records.length, before);
  f.flow.stop();
});

test('análise nova sem fatos comprováveis não entra em ciclo de regeneração', async () => {
  const value = legacy();
  value.knowledge.profile = {};
  value.knowledge.profileAnalysis = { version: 1, complete: true };
  const f = setup(value);
  await f.flow.load();
  await f.flow.complete();
  await f.flow.complete();
  assert.equal(f.calls.length, 0);
  f.flow.stop();
});

test('substituição do principal também invalida quando documents ainda contém o hash antigo', async () => {
  const f = setup({ status: 'running' });
  f.game.documents = { main: { id: 'main', manual: { ...f.game.manual } } };
  await f.flow.load();
  const n = f.records.length;
  f.game.manual = { ...f.game.manual, sha256: 'c'.repeat(64) };
  f.flow.invalidate();
  f.emit(legacy());
  assert.equal(f.records.length, n);
  assert.equal(f.closed(), 1);
  f.flow.stop();
});

test('erro de geração da identidade antiga não troca a mensagem da ficha nova', async () => {
  let fail;
  const f = setup(null, { generateKnowledge: () => new Promise((r, reject) => (fail = reject)) });
  const pending = f.flow.complete();
  await new Promise((r) => setImmediate(r));
  const n = f.messages.length;
  f.game.title = 'Outro jogo';
  fail(new Error('Erro da identidade antiga'));
  await pending;
  assert.equal(f.messages.length, n);
  f.flow.stop();
});
