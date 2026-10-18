import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidateMetadata, metadataUpdates } from '../js/metadata-consolidation.js';
import { pdfMetadataCandidate } from '../js/catalog-language.js';

const hash = 'a'.repeat(64);
const game = { title: 'Catan', edition: '3', manual: { sha256: hash }, sources: {} };
const candidate = (source, fields, extra = {}) => ({ source, id: source, manualHash: hash, identifiers: { wikidata: 'Q1' }, fields, names: [{ value: 'Catan', language: 'pt-BR' }], language: 'pt-BR', kind: 'base', edition: '3', ...extra });

test('PDF, internet e IA completam uma ficha; PDF vence, listas se unem e IA não confirma o próprio PDF', () => {
  const pdf = candidate('pdf', { minPlayers: 3, maxPlayers: 4, recommendedAge: 10 });
  const web = candidate('wikipedia', { minPlayers: 2, maxPlayers: 4, minDurationMinutes: 60, maxDurationMinutes: 90, tags: ['Estratégia'] });
  const ai = candidate('gemini', { recommendedAge: 10, description: 'Troque recursos e construa povoados para conquistar a ilha.', mechanics: ['Negociação'] });
  const m = consolidateMetadata(game, [ai, web, pdf]);
  assert.equal(m.fields.minPlayers, 3);
  assert.equal(m.consistency.minPlayers, 'conflict');
  assert.equal(m.consistency.maxPlayers, 'conflict', 'a faixa inteira exige uma decisão, não somente seu mínimo');
  assert.equal(m.consistency.recommendedAge, 'single-source');
  assert.equal(m.fieldSources.description.source, 'gemini');
  assert.equal(m.fields.maxDurationMinutes, 90);
  assert.deepEqual(m.fields.mechanics, ['Negociação']);
  assert.equal(m.members.length, 3);
});

test('correções, campos confirmados e apagamentos manuais vencem respostas progressivas', () => {
  const m = consolidateMetadata(game, [candidate('wikipedia', { minPlayers: 3, maxPlayers: 4, description: 'Construa povoados e troque recursos com os outros jogadores.', tags: ['Estratégia'] })]);
  assert.equal(metadataUpdates(m, game).minPlayers, 3);
  assert.equal(metadataUpdates(m, { ...game, minPlayers: 2 }).minPlayers, undefined);
  assert.equal(metadataUpdates(m, { ...game, minPlayers: null }, new Set(['minPlayers'])).minPlayers, undefined);
  assert.equal(metadataUpdates(m, { ...game, sources: { players: { confirmedAt: 1 } } }).minPlayers, undefined);
  assert.equal(metadataUpdates(m, { ...game, minPlayers: 2 }, new Set(), { minPlayers: 2 }).minPlayers, 3);
});

test('edições, expansões, IDs incompatíveis e homônimos não entram automaticamente', () => {
  const base = candidate('wikidata', { maxPlayers: 4 });
  for (const extra of [{ edition: '2' }, { kind: 'expansion' }]) {
    const m = consolidateMetadata({ ...game, kind: 'base' }, [{ ...base, ...extra }]);
    assert.equal(m.fields.maxPlayers, undefined);
  }
  const other = candidate('wikipedia', { maxPlayers: 6 }, { identifiers: { wikidata: 'Q2' } });
  assert.equal(consolidateMetadata(game, [base, other]).fields.maxPlayers, undefined);
  assert.equal(consolidateMetadata(game, [base, other], 'wikidata:wikidata').fields.maxPlayers, 4);
  assert.equal(consolidateMetadata({ ...game, sources: { catalog: { matches: [{ identifiers: { wikidata: 'Q2' } }] } } }, [base]).fields.maxPlayers, undefined);
  assert.equal(consolidateMetadata(game, [candidate('gemini', { maxPlayers: 6 }, { manualHash: 'b'.repeat(64) })]).fields.maxPlayers, undefined);
});

test('originais e referências permanecem; inglês sem tradução não vira descrição PT-BR', () => {
  const external = candidate('wikipedia', { description: 'Trade resources and build settlements to develop the island.', maxPlayers: 4 }, { edition: '', language: 'en' });
  const m = consolidateMetadata(game, [external]);
  assert.equal(m.fields.description, undefined);
  assert.equal(m.pendingTranslations.length, 1);
  assert.equal(m.fields.maxPlayers, 4);
  assert.equal(m.fieldSources.maxPlayers.editionUnconfirmed, true);
});

test('fonte sem edição complementa a mesma identidade confirmada sem misturar edições diferentes', () => {
  const a = candidate('wikidata', { minDurationMinutes: 60 });
  const b = candidate('wikipedia', { description: 'Explore a ilha, obtenha recursos e construa povoados.' }, { edition: '' });
  const m = consolidateMetadata(game, [a, b]);
  assert.equal(m.members.length, 2);
  assert.equal(m.ambiguous.length, 0);
  assert.equal(m.fields.minDurationMinutes, 60);
  assert.equal(m.fieldSources.description.editionUnconfirmed, true);
});

test('PDF português atual e histórico legado fornecem fatos sem transformar correções em evidência PDF', () => {
  const old = { ...game, minPlayers: 3, maxPlayers: 4, description: 'Minha descrição corrigida.', sources: { players: { source: 'PDF', page: 2, excerpt: '3 a 4 jogadores' }, description: { source: 'Conferido e ajustado por você' } } };
  const pdf = pdfMetadataCandidate(old);
  assert.equal(pdf.fields.minPlayers, 3);
  assert.equal(pdf.evidence.minPlayers.page, 2);
  assert.equal(pdf.fields.description, undefined);
  const m = consolidateMetadata(old, [pdf, candidate('wikipedia', { minPlayers: 2, maxPlayers: 4 })]);
  assert.equal(m.consistency.minPlayers, 'manual-preferred');
  assert.equal(m.fields.minPlayers, 3);
});
