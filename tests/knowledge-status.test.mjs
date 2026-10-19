import test from 'node:test';
import assert from 'node:assert/strict';
import { currentKnowledgeStatus } from '../js/knowledge-status.js';
import { recontextualizeDraft } from '../js/draft-reuse.js';
import { observeKnowledge } from '../js/knowledge-observer.js';

test('cache antigo perde somente o bloqueio interno e preserva as correções e referências', () => {
  const knowledge = { sections: [{ text: 'Correção manual', review: 'manual', page: 1, sourceHash: 'a'.repeat(64) }] };
  for (const reason of ['app-rate-limit', 'profile-rate-limit']) {
    const record = { status: 'quota', reason, retryAt: Date.now() + 86400000, revision: 4, knowledge };
    const current = currentKnowledgeStatus(record);
    assert.equal(current.status, 'attention');
    assert.equal(current.retryAt, 0);
    assert.equal(current.knowledge, knowledge);
    assert.equal(current.revision, 4);
    assert.equal(record.status, 'quota', 'não modifica o registro original');
    assert.equal(recontextualizeDraft({ ...record, knowledge: null }, {}, []).retryAt, 0);
  }
});
test('cotas reais do provedor ou de origem desconhecida não são liberadas', () => {
  for (const reason of ['provider-rate-limit', 'upstream-rate-limit', '']) {
    const record = { status: 'quota', reason, retryAt: Date.now() + 60000 };
    assert.equal(currentKnowledgeStatus(record), record);
  }
  assert.equal(currentKnowledgeStatus(null), null);
});
test('abrir acompanhamento de bloqueio legado não inicia geração nem acompanhamento contínuo', async () => {
  let reads = 0,
    generations = 0,
    received;
  const repository = {
    session: { user: { uid: 'owner' }, canRead: true },
    getKnowledge: async () => {
      reads++;
      return { status: 'quota', reason: 'app-rate-limit', retryAt: Date.now() + 60000 };
    },
    generateKnowledge: async () => generations++,
  };
  const observation = observeKnowledge(
    repository,
    { id: 'fixture', title: 'Fixture' },
    {
      onRecord: (record) => {
        received = record;
      },
    },
  );
  await observation.refresh();
  assert.equal(received.status, 'attention');
  assert.equal(reads, 1);
  assert.equal(generations, 0);
  observation.close();
});
