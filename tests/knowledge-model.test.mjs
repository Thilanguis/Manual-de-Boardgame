import test from 'node:test';
import assert from 'node:assert/strict';
import { usableKnowledge, emptyKnowledgeFields, knowledgeSummary, verifiedKnowledgeFields } from '../js/knowledge-model.js';
import { extractMetadata } from '../js/recognition.js';
import { searchKnowledge, relevance } from '../js/rule-relevance.js';
import { consolidateCandidates } from '../js/research-knowledge.js';
import { queryVariants } from '../js/game-identities.js';
const hash = 'a'.repeat(64),
  game = { id: 'game', manual: { sha256: hash, pages: 2 }, sources: {} };
const source = { id: 'manual', documentId: 'main', sourceHash: hash, scope: 'edition-confirmed', name: 'Manual', pages: [{ page: 2, text: 'Para atacar, gaste uma ação e consulte a carta.' }], incompletePages: [1] };
const section = { id: 'attack', sourceId: 'manual', documentId: 'main', sourceHash: hash, page: 2, quote: source.pages[0].text, topic: 'acoes', title: 'Como atacar', text: 'Gaste uma ação e consulte a carta para atacar.', review: 'unreviewed' };
const knowledge = { sections: [section], sources: [source], analyzedAt: 1000, unconfirmed: ['Não há regra de combate adicional.'] };

test('conteúdo validado entra na pesquisa sem aceitar ou publicar; corrigido tem identificação própria', () => {
  const available = usableKnowledge(knowledge, game);
  assert.equal(available.sections.length, 1);
  const [result] = searchKnowledge(available, 'Como funciona o ataque?');
  assert.equal(result.page, 2);
  assert.match(result.source, /Explicação por IA/);
  assert.equal(result.editionUnconfirmed, false);
  const corrected = usableKnowledge({ ...knowledge, sections: [{ ...section, review: 'manual', text: 'Para atacar, consulte também o exemplo corrigido.' }] }, game);
  assert.match(searchKnowledge(corrected, 'atacar')[0].source, /corrigida/);
  const summary = knowledgeSummary({ knowledge }, game);
  assert.equal(summary.analyzedAt, 1000);
  assert.equal(summary.documents.length, 1);
  assert.equal(summary.limitations.length, 2);
});
test('hash, documento, página, fonte e evidência impedem misturar edições ou citações inventadas', () => {
  for (const changed of [{ sourceHash: 'b'.repeat(64) }, { documentId: 'missing' }, { page: 3 }, { quote: 'Citação inventada' }, { sourceId: 'missing' }, { review: 'rejected' }])
    assert.equal(usableKnowledge({ ...knowledge, sections: [{ ...section, ...changed }] }, game).sections.length, 0);
  for (const changed of [{ sourceHash: 'b'.repeat(64) }, { documentId: 'other' }])
    assert.equal(usableKnowledge({ ...knowledge, sources: [{ ...source, ...changed }] }, game).sections.length, 0);
});
test('metadados vazios podem receber sugestões; valores e campos manualmente esvaziados são preservados', () => {
  const fields = { description: { value: 'Resumo da IA' }, recommendedAge: { value: 14 }, mechanics: { value: ['Cooperação'] }, minPlayers: { value: 1 } };
  const current = { ...game, description: '', recommendedAge: null, mechanics: [], minPlayers: 2, sources: { recommendedAge: { confirmedAt: 1 }, mechanics: { source: 'Conferido e ajustado por você' } } };
  assert.deepEqual(emptyKnowledgeFields(current, fields), { description: 'Resumo da IA' });
  assert.equal(current.description, '');
});
test('Gemini derivado do mesmo manual não conta como uma confirmação independente', () => {
  const base = { id: 'id', manualHash: hash, language: 'pt-BR', kind: 'base', edition: '', identifiers: { manual: hash }, names: [], fields: { minPlayers: 1 } };
  const [single] = consolidateCandidates([
    { ...base, source: 'pdf' },
    { ...base, source: 'gemini' },
  ]);
  assert.equal(single.consistency.minPlayers, 'single-source');
  const [consistent] = consolidateCandidates([
    { ...base, source: 'pdf' },
    { ...base, source: 'wikidata' },
  ]);
  assert.equal(consistent.consistency.minPlayers, 'consistent');
  const [conflict] = consolidateCandidates([
    { ...base, source: 'pdf' },
    { ...base, source: 'wikidata', fields: { minPlayers: 2 } },
  ]);
  assert.equal(conflict.consistency.minPlayers, 'conflict');
});
test('edição no título oferece variações PT/EN/FR sem remover o número nem declarar equivalência', () => {
  const queries = queryVariants({ query: 'Zombicide 2 Edição' }).map((entry) => entry.query);
  assert(queries.includes('Zombicide 2nd Edition'));
  assert(queries.includes('Zombicide 2e édition'));
  assert(!queries.includes('Zombicide'));
  assert(relevance('Como funciona um turno?', 'Turnos', 'Mova uma peça.'));
  const hints = extractMetadata('Editora: Galápagos\nAno: 2025');
  assert.equal(hints.sources.publisher.excerpt, 'Galápagos');
  assert.equal(hints.sources.year.excerpt, '2025');
});

test('sugestões de cadastro também verificam a origem e o hash antes de preencher campos', () => {
  const current = { ...knowledge, sections: [{ ...section, topic: 'visao-geral' }], fields: { maxPlayers: { sourceId: 'manual', value: 5 }, description: { sourceId: 'manual', value: section.text } }, sources: [{ ...source, facts: { maxPlayers: 5 } }] };
  assert.equal(verifiedKnowledgeFields(current, game).maxPlayers.value, 5);
  assert.equal(verifiedKnowledgeFields(current, game).description.value, section.text);
  assert.deepEqual(verifiedKnowledgeFields(current, { ...game, manual: { sha256: 'b'.repeat(64), pages: 2 } }), {});
});
