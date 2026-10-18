import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidateMetadata, metadataUpdates } from '../js/metadata-consolidation.js';
const hash = 'a'.repeat(64);
const game = { title: 'Jogo de teste', edition: '3', kind: 'base', manual: { sha256: hash }, sources: {} };
const source = (id, fields, extra = {}) => ({
  independenceVerified: true,
  source: id,
  id,
  fields,
  identifiers: { bgg: '111' },
  names: [{ value: game.title, language: 'pt-BR' }],
  language: 'pt-BR',
  kind: 'base',
  edition: '3',
  url: `https://${id}.example/jogo`,
  license: 'authorized',
  ...extra,
});

test('três fontes independentes da mesma edição vencem uma divergente sem votação por campo da faixa', () => {
  const good = { recommendedAge: 14, minPlayers: 2, maxPlayers: 5, minDurationMinutes: 60, maxDurationMinutes: 150 };
  const other = { recommendedAge: 13, minPlayers: 1, maxPlayers: 4, minDurationMinutes: 45, maxDurationMinutes: 120 };
  const m = consolidateMetadata(game, [source('d', other), ...['a', 'b', 'c'].map((id) => source(id, good))]);
  for (const key of Object.keys(good)) {
    assert.equal(m.fields[key], good[key]);
    assert.equal(m.consistency[key], 'consensus');
  }
  assert.equal(m.resolutions.recommendedAge.votes, 3);
  assert.equal(m.resolutions.recommendedAge.total, 4);
});
test('cópias declaradas e páginas do mesmo catálogo contam uma vez; Wikidata e Wikipédia não são presumidas independentes', () => {
  const copies = ['a', 'b', 'c'].map((id) => source(id, { recommendedAge: 14 }, { derivedFrom: 'catalogo-original' }));
  const m = consolidateMetadata(game, [...copies, source('d', { recommendedAge: 13 })]);
  assert.equal(m.consistency.recommendedAge, 'conflict');
  assert.equal(metadataUpdates(m, game).recommendedAge, undefined);
  const wiki = consolidateMetadata(game, [source('wikidata', { recommendedAge: 14 }), source('wikipedia', { recommendedAge: 14 }), source('d', { recommendedAge: 13 })]);
  assert.equal(wiki.consistency.recommendedAge, 'conflict');
});
test('outra edição, expansão e evidência de baixa qualidade não produzem uma maioria falsa', () => {
  const input = [
    source('a', { recommendedAge: 14 }),
    source('d', { recommendedAge: 13 }),
    source('b', { recommendedAge: 14 }, { edition: '2' }),
    source('c', { recommendedAge: 14 }, { kind: 'expansion' }),
    source('e', { recommendedAge: 14 }, { quality: 'low' }),
  ];
  assert.equal(consolidateMetadata(game, input).consistency.recommendedAge, 'conflict');
  const unknown = consolidateMetadata(game, [source('a', { recommendedAge: 14 }), source('b', { recommendedAge: 14 }, { edition: '' }), source('d', { recommendedAge: 13 })]);
  assert.equal(unknown.consistency.recommendedAge, 'conflict');
});
test('manual da edição atual vence maioria externa; Gemini e PDF não duplicam o voto do manual', () => {
  const evidence = { recommendedAge: { page: 1, sourceHash: hash, excerpt: 'Idade recomendada: 13 anos.' } };
  const pdf = source('pdf', { recommendedAge: 13 }, { manualHash: hash, evidence });
  const ai = source('gemini', { recommendedAge: 13 }, { manualHash: hash, evidence });
  const m = consolidateMetadata(game, [...['a', 'b', 'c'].map((id) => source(id, { recommendedAge: 14 })), pdf, ai]);
  assert.equal(m.fields.recommendedAge, 13);
  assert.equal(m.consistency.recommendedAge, 'manual-preferred');
  assert.equal(consolidateMetadata(game, [pdf, ai]).consistency.recommendedAge, 'single-source');
});
test('mínimo e máximo incompletos de fontes diferentes não são combinados automaticamente', () => {
  const m = consolidateMetadata(game, [source('a', { minPlayers: 2 }), source('b', { maxPlayers: 5 })]);
  assert.equal(metadataUpdates(m, game).minPlayers, undefined);
  assert.equal(metadataUpdates(m, game).maxPlayers, undefined);
});
test('consenso não substitui correções nem confirmações; campos ausentes continuam ausentes', () => {
  const m = consolidateMetadata(
    game,
    ['a', 'b', 'c'].map((id) => source(id, { recommendedAge: 14 })),
  );
  assert.equal(metadataUpdates(m, { ...game, recommendedAge: 12, sources: { recommendedAge: { confirmedAt: 1 } } }).recommendedAge, undefined);
  assert.equal(metadataUpdates(m, game, new Set(['recommendedAge'])).recommendedAge, undefined);
  assert.equal(m.fields.description, undefined);
});

test('domínios diferentes sem independência documentada não criam consenso', () => {
  const m = consolidateMetadata(game, [...['a', 'b', 'c'].map((id) => source(id, { recommendedAge: 14 }, { independenceVerified: false })), source('d', { recommendedAge: 13 }, { independenceVerified: false })]);
  assert.equal(m.consistency.recommendedAge, 'conflict');
});
