import test from 'node:test';
import assert from 'node:assert/strict';
import { createInformationFlow } from '../js/information-flow.js';
import { profileDefinitions } from '../js/profile-facts.js';

function fixture(initial = null, saved = true) {
  let value = initial,
    reads = 0,
    generations = 0,
    writes = 0,
    closed = 0,
    listener;
  const status = [],
    applied = [],
    prepares = [];
  let usable = true;
  const game = { ...(saved ? { id: 'game' } : {}), title: 'Jogo', manual: { sha256: 'a'.repeat(64), pages: 2 } };
  const repo = {
    session: { user: { uid: 'owner' }, canRead: true, storageStatus: { knowledgeConfigured: true, manualAiEnabled: true } },
    generateKnowledge: async () => {
      generations++;
      return (value = { status: 'running' });
    },
    save: () => writes++,
  };
  const flow = createInformationFlow({
    getRepository: () => repo,
    getCurrent: () => game,
    canUse: () => usable,
    draftProfile: { prepare: async (options) => prepares.push(options), cancel() {} },
    onRecord: (record) => applied.push(record),
    onStatus: (message) => status.push(message),
    observe(repository, current, callbacks) {
      listener = callbacks;
      return {
        refresh: async () => {
          reads++;
          callbacks.onRecord(value);
        },
        update: callbacks.onRecord,
        close: () => closed++,
      };
    },
  });
  return { flow, game, repo, applied, status, prepares, emit: (record) => listener.onRecord(record), revoke: () => (usable = false), counts: () => ({ reads, generations, writes, closed }) };
}
test('abrir/voltar apenas recupera conhecimento salvo, sem gerar ou salvar ficha', async () => {
  const f = fixture({
    status: 'ready',
    knowledge: {
      profile: {},
      profileAnalysis: { version: 3, complete: true, coverageComplete: true, checkedFields: Object.keys(profileDefinitions) },
      sources: [{ id: 'manual', sourceHash: 'a'.repeat(64), pages: [{ page: 1, text: 'Sem dados de ficha.' }] }],
      sections: [],
    },
  });
  await f.flow.load();
  await f.flow.load();
  await Promise.all([f.flow.complete(), f.flow.complete()]);
  assert.deepEqual(f.counts(), { reads: 1, generations: 0, writes: 0, closed: 0 });
  f.flow.stop();
  await f.flow.load();
  assert.equal(f.counts().reads, 2);
  assert.equal(f.counts().generations, 0);
  f.flow.stop();
});
test('completar uma vez, acompanhar resultado tardio e encerrar ao fechar', async () => {
  const f = fixture();
  await Promise.all([f.flow.complete(), f.flow.complete()]);
  assert.equal(f.counts().generations, 1);
  assert.equal(f.flow.isBusy(), true);
  f.emit({ status: 'ready', knowledge: { profile: { recommendedAge: { value: 14 } } } });
  assert.equal(f.flow.isBusy(), false);
  assert.equal(f.applied.at(-1).knowledge.profile.recommendedAge.value, 14);
  f.flow.stop();
  const count = f.applied.length;
  f.emit({ status: 'ready', knowledge: {} });
  assert.equal(f.applied.length, count);
  assert.equal(f.counts().writes, 0);
});
test('geração iniciada noutra tela é acompanhada sem novo clique ou geração', async () => {
  const f = fixture({ status: 'running' });
  await f.flow.load();
  await f.flow.complete();
  assert.equal(f.counts().generations, 0);
  f.emit({ status: 'ready', knowledge: { sections: [] } });
  assert.equal(f.applied.at(-1).status, 'ready');
  f.flow.stop();
});
test('cota e IA desativada deixam as demais fontes disponíveis', async () => {
  const f = fixture({ status: 'quota', retryAt: Date.now() + 60000, message: 'Cota atingida' });
  await f.flow.complete();
  assert.equal(f.counts().generations, 0);
  assert.match(f.status.at(-1), /Cota/);
  f.flow.stop();
  const g = fixture();
  g.repo.session.storageStatus.manualAiEnabled = false;
  await g.flow.complete();
  assert.equal(g.counts().generations, 0);
  assert.match(g.status.at(-1), /Somente fatos/);
  g.flow.stop();
});
test('formato antigo só é atualizado pelo comando explícito', async () => {
  const f = fixture({ status: 'ready', knowledge: { sections: [{ text: 'Regra antiga' }], fields: { description: { value: 'Resumo' } } } });
  await f.flow.load();
  assert.equal(f.counts().generations, 0);
  assert.equal(f.applied.at(-1).knowledge.fields.description.value, 'Resumo');
  await f.flow.complete();
  assert.equal(f.counts().generations, 1);
  f.flow.stop();
});
test('novo cadastro só gera pela ação explícita, abertura usa cachedOnly', async () => {
  const f = fixture(null, false);
  await f.flow.load();
  assert.deepEqual(f.prepares, [{ cachedOnly: true }]);
  await f.flow.complete();
  assert.deepEqual(f.prepares.at(-1), { retry: true });
  assert.equal(f.counts().writes, 0);
  f.flow.stop();
});
test('complementação da ficha exige protocolo atual, sem consumir IA no Worker antigo', async () => {
  const f = fixture();
  f.repo.session.storageStatus.profileMetadataProtocol = 1;
  await f.flow.complete({ includePublic: true });
  assert.equal(f.counts().generations, 0);
  assert.match(f.status.at(-1), /Worker conectado ainda não oferece/);
  f.flow.stop();
});
test('troca de edição e perda de permissão ignoram respostas da sessão anterior', async () => {
  const f = fixture({ status: 'running' });
  await f.flow.load();
  const n = f.applied.length;
  f.game.edition = 'Outra';
  f.emit({ status: 'ready', knowledge: {} });
  assert.equal(f.applied.length, n);
  f.revoke();
  f.emit({ status: 'ready', knowledge: {} });
  assert.equal(f.applied.length, n);
  f.flow.stop();
});

test('cancelar durante a leitura inicial não inicia geração tardia', async () => {
  let release,
    generated = 0;
  const game = { id: 'cancelled', manual: { sha256: 'a'.repeat(64), pages: 1 } };
  const repo = { session: { user: { uid: 'owner' }, canRead: true, storageStatus: { knowledgeConfigured: true, manualAiEnabled: true } }, generateKnowledge: async () => generated++ };
  const flow = createInformationFlow({
    getRepository: () => repo,
    getCurrent: () => game,
    canUse: () => true,
    draftProfile: { cancel() {} },
    onRecord() {},
    onStatus() {},
    observe() {
      return { refresh: () => new Promise((r) => (release = r)), close() {} };
    },
  });
  const pending = flow.complete();
  flow.stop();
  release();
  await pending;
  assert.equal(generated, 0);
});
