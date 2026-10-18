import test from 'node:test';
import assert from 'node:assert/strict';
import { savedKnowledgeCandidate } from '../js/research-enrichment.js';
import { consolidateCandidates } from '../js/research-knowledge.js';

const hash = 'a'.repeat(64);
const game = { id: 'jogo', title: 'Sina da Sociedade', language: 'pt-BR', manual: { sha256: hash, pages: 2 } };
const source = { id: 'manual-1', sourceHash: hash, pages: [{ page: 2, text: 'O objetivo é proteger Frodo.' }] };
const record = {
  knowledge: {
    sources: [source],
    fields: { description: { sourceId: source.id, value: 'Proteja Frodo com a Sociedade.' } },
    sections: [{ topic: 'visao-geral', sourceId: source.id, sourceHash: hash, text: 'Proteja Frodo com a Sociedade.', quote: 'O objetivo é proteger Frodo.', page: 2, review: 'unreviewed' }],
  },
};

test('IA salva enriquece as sugestões do mesmo PDF e exige conferência', () => {
  const ai = savedKnowledgeCandidate(record, game);
  assert.equal(ai.fields.description, record.knowledge.fields.description.value);
  assert.equal(ai.requiresEditionReview, true);
  assert.equal(ai.evidence.description.page, 2);
  const pdf = { ...ai, source: 'pdf', id: 'pdf', requiresEditionReview: false, fields: { minPlayers: 1, maxPlayers: 5 } };
  const [merged] = consolidateCandidates([ai, pdf]);
  assert.equal(merged.members.length, 2);
  assert.equal(merged.fields.description, ai.fields.description);
  assert.equal(merged.fields.maxPlayers, 5);
  assert.equal(merged.fieldSources.description.source, 'gemini');
  assert.equal(merged.fieldSources.description.evidence.page, 2);
  assert.equal(savedKnowledgeCandidate(record, { ...game, manual: { sha256: 'b'.repeat(64) } }), null);
  assert.equal(savedKnowledgeCandidate({ knowledge: { ...record.knowledge, sections: [{ ...record.knowledge.sections[0], review: 'rejected' }] } }, game), null);
});

test('mesmo identificador reúne nomes, campos e listas sem ocultar divergências nem misturar edições', () => {
  const first = {
    source: 'wikidata',
    id: 'Q1',
    identifiers: { bgg: '1' },
    names: [{ value: 'Nome oficial', language: 'pt-BR' }],
    language: 'pt-BR',
    edition: '',
    kind: 'unknown',
    fields: { title: 'Nome oficial', minPlayers: 1, maxPlayers: 5, tags: ['Aventura'], mechanics: ['Cooperação'] },
  };
  const second = {
    ...first,
    source: 'wikipedia',
    kind: 'base',
    names: [{ value: 'Original title', language: 'en' }],
    fields: { minDurationMinutes: 60, maxDurationMinutes: 150, maxPlayers: 4, tags: ['Estratégia', 'Aventura'], mechanics: ['Cooperação'] },
  };
  const [merged] = consolidateCandidates([first, second]);
  assert.equal(merged.members.length, 2);
  assert.equal(merged.kind, 'base');
  assert.deepEqual(merged.fields.tags, ['Aventura', 'Estratégia']);
  assert.equal(merged.fieldSources.tags.origins.length, 2);
  assert.equal(merged.fields.minDurationMinutes, 60);
  assert.deepEqual(
    merged.alternatives.maxPlayers.map((fact) => fact.value),
    [5, 4],
  );
  assert.equal(merged.conflicts.length, 1);
  for (const changed of [{ edition: 'Outra edição' }, { kind: 'expansion' }, { identifiers: { bgg: '2' } }]) assert.equal(consolidateCandidates([first, { ...second, ...changed }]).length, 2);
});
