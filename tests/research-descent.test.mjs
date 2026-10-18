import test from 'node:test';
import assert from 'node:assert/strict';
import { replayResearch, replayStats } from './public-research-replay.mjs';
import { consolidateMetadata, metadataUpdates } from '../js/metadata-consolidation.js';
import { resultSummary } from '../js/research-presentation.js';
import { profileUnavailable } from '../js/profile-availability.js';
import { extractMetadata } from '../js/recognition.js';

const br = 'Descent: Lendas da Escuridão',
  en = 'Descent: Legends of the Dark';
const game = (title = br) => ({ title, language: 'pt-BR', manual: { sha256: 'a'.repeat(64) }, sources: {} });
const search = (source, query) => replayResearch(source, { query, action: 'search', preferredLanguage: 'pt-BR' });

test('respostas públicas reais: descobre Descent BR, separa franquia, expansão e aplicativo', async () => {
  const result = await search('wikidata', br);
  assert(result.candidates.some((c) => c.id === 'Q111669176'));
  assert(!result.candidates.some((c) => c.id === 'Q122373697'), 'aplicativo excluído');
  const unresolved = consolidateMetadata(game(), result.candidates);
  assert.equal(unresolved.members.length, 0, 'prefixo de franquia não confirma tradução/edição');
  assert.equal(unresolved.ambiguous.length, 5);
  const confirmed = consolidateMetadata(game(), result.candidates, 'wikidata:Q111669176');
  assert.equal(confirmed.fields.minPlayers, 1);
  assert.equal(confirmed.fields.maxPlayers, 4);
  assert.deepEqual(confirmed.fields.tags, ['Fantasia']);
  assert.equal(confirmed.fields.recommendedAge, undefined);
  assert.equal(confirmed.fields.minDurationMinutes, undefined);
  assert.equal(confirmed.fields.description, undefined);
  const existing = { ...game(), tags: ['Cooperativo'], sources: { tags: { source: 'PDF · extração automática' } } };
  const union = { ...confirmed, fields: { ...confirmed.fields, tags: ['Cooperativo', 'Fantasia'] } };
  assert.deepEqual(metadataUpdates(union, existing).tags, ['Cooperativo', 'Fantasia']);
  assert.equal(metadataUpdates(union, existing, new Set(['tags'])).tags, undefined);
  assert.equal(metadataUpdates(union, { ...existing, sources: { tags: { source: 'PDF', confirmedAt: 1 } } }).tags, undefined);
});

test('título original ou alias explícito do manual confirma a obra sem tabela por jogo', async () => {
  const result = await search('wikidata', en);
  const model = consolidateMetadata(game(en), result.candidates);
  assert.equal(model.members.length, 1);
  assert.equal(model.members[0].id, 'Q111669176');
  const bilingual = game();
  bilingual.sources.originalTitle = { source: 'PDF · título original explícito', excerpt: en, page: 1, sourceHash: bilingual.manual.sha256 };
  assert.equal(consolidateMetadata(bilingual, result.candidates).fields.maxPlayers, 4);
  assert.equal(consolidateMetadata({ ...bilingual, manual: { sha256: 'b'.repeat(64) } }, result.candidates).members.length, 0, 'alias de outro PDF não confirma identidade');
  assert.equal(
    consolidateMetadata(
      { ...bilingual, edition: 'outra edição' },
      result.candidates.map((c) => ({ ...c, edition: '2021' })),
    ).members.length,
    0,
  );
  assert.equal(
    consolidateMetadata(
      { ...game(en), kind: 'base' },
      result.candidates.map((c) => ({ ...c, kind: 'expansion' })),
    ).members.length,
    0,
  );
});

test('outra tradução: Arnak descobre ID e conserva fatos reais sem inventar sinopse', async () => {
  const result = await search('wikidata', 'As Ruínas Perdidas de Arnak');
  assert.equal(result.candidates[0].id, 'Q107835072');
  const model = consolidateMetadata(game('As Ruínas Perdidas de Arnak'), result.candidates, 'wikidata:Q107835072');
  assert.equal(model.fields.recommendedAge, 12);
  assert.equal(model.fields.minDurationMinutes, 60);
  assert.equal(model.fields.maxDurationMinutes, 60);
  assert.equal(model.fields.description, undefined, '2020 board game não é sinopse');
  const changes = metadataUpdates(model, { ...game('As Ruínas Perdidas de Arnak'), recommendedAge: 16 }, new Set(['recommendedAge']));
  assert.equal(changes.recommendedAge, undefined);
  const wiki = await search('wikipedia', 'Lost Ruins of Arnak');
  assert(wiki.candidates[0].fields.description.length > 40);
  assert.equal(consolidateMetadata(game('Lost Ruins of Arnak'), wiki.candidates).fields.description, undefined, 'original inglês fica pendente de tradução, não vira PT inventado');
});

test('Wikipédia real não é apresentada como sucesso quando não encontrou Descent', async () => {
  for (const query of [br, en]) assert.deepEqual((await search('wikipedia', query)).candidates, []);
  assert.deepEqual(replayStats.missing, []);
});

test('status distingue PDF, correspondência sem metadados e incompatibilidade publicada', () => {
  const sources = [{ id: 'wikidata', enabled: true }];
  assert(!resultSummary([{ source: 'pdf', fields: { title: br } }], sources, new Map()).includes('1 jogo encontrado'));
  assert.match(resultSummary([{ source: 'wikidata', id: 'Q1', fields: { title: en } }], sources, new Map()), /Sem informações adicionais/);
  const oldHealth = { knowledgeConfigured: true, manualAiEnabled: true, knowledgeProtocol: 1 };
  assert.equal(profileUnavailable(oldHealth, { draft: true }).reason, 'server-update');
  assert.equal(profileUnavailable({ ...oldHealth, knowledgeConfigured: false }, { draft: true }).reason, 'configuration');
  assert.equal(profileUnavailable({ ...oldHealth, manualAiEnabled: false }, { draft: true }).reason, 'authorization');
  assert.equal(profileUnavailable({ error: 'offline' }, { draft: true }).reason, 'connection');
});

test('jogadores por extenso preservam evidência original PT, EN e FR', () => {
  for (const text of ['Jogo cooperativo para um a quatro jogadores.', 'A cooperative game for one to four players.', 'Un jeu pour un à quatre joueurs.']) {
    const result = extractMetadata(text);
    assert.equal(result.minPlayers, 1);
    assert.equal(result.maxPlayers, 4);
    assert(text.includes(result.sources.players.excerpt));
  }
});
