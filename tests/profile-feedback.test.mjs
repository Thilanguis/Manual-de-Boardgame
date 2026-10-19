import test from 'node:test';
import assert from 'node:assert/strict';
import { profileUnavailable } from '../js/profile-availability.js';
import { profileDiagnostic } from '../js/profile-diagnostics.js';
import * as presentation from '../js/research-presentation.js';
const { resultSummary } = presentation;

test('Worker antigo não é apresentado como capaz de complementar a ficha com fontes públicas', () => {
  const health = { profileMetadataProtocol: 1, knowledgeConfigured: true, manualAiEnabled: true };
  assert.equal(profileUnavailable(health, { draft: true, combined: true })?.reason, 'server-update');
  assert.match(profileUnavailable(health, { combined: true }).message, /fontes públicas/);
  assert.equal(profileUnavailable({ ...health, profileMetadataProtocol: 2 }, { combined: true }), null);
});

test('descrição do legado não prova que o Gemini examinou a ficha inteira', () => {
  const diagnostic = profileDiagnostic({ status: 'ready', knowledge: { sources: [], profile: {} } }, { fields: { description: 'Resumo disponível' }, fieldOrigins: { description: 'gemini' } });
  assert.equal(diagnostic.legacy, true);
  assert.match(diagnostic.summary, /análise antiga/i);
  assert.doesNotMatch(diagnostic.summary, /Análise concluída|campos válidos disponíveis/i);
});

test('falha nova com ficha legada preservada não é exibida como análise nova ou campos examinados', () => {
  const d = profileDiagnostic(
    { status: 'attention', analysisOrigin: 'generation', message: 'O serviço de IA não concluiu a geração.', provider: { httpStatus: 400, status: 'INVALID_ARGUMENT' }, knowledge: { generatedAt: 1, profile: {}, sources: [] } },
    { fields: { title: 'Jogo', description: 'Resumo anterior' }, fieldOrigins: { title: 'gemini', description: 'gemini' } },
  );
  assert.equal(d.statusLabel, 'Última tentativa não concluída');
  assert.equal(d.preservedValid, 2);
  assert.equal(d.valid, 0);
  assert.deepEqual(d.missing, []);
  assert.equal(d.provider.httpStatus, 400);
});

test('cache da pesquisa não exibe ainda não consultada depois de resultados confirmados', () => {
  const candidates = [{ source: 'wikidata', id: 'Q1', fields: { minPlayers: 2 } }];
  const { researchSourceState } = presentation;
  assert.equal(typeof researchSourceState, 'function');
  const state = researchSourceState('wikidata', new Map(), candidates, { query: 'Jogo', fetchedAt: 1 });
  assert.equal(state.status, 'done');
  assert.equal(state.cached, true);
  assert.equal(state.candidates.length, 1);
  assert.equal(researchSourceState('wikipedia', new Map(), candidates, { query: 'Jogo', fetchedAt: 1 }).status, 'cached');
  assert.equal(researchSourceState('wikipedia', new Map(), [], null), undefined);
  assert.equal(researchSourceState('wikidata', new Map([['wikidata', { status: 'error' }]]), candidates, {}).status, 'error');
});

test('durante OCR e análise o resumo não declara uma busca terminada sem correspondência', () => {
  const sources = [{ enabled: true }];
  assert.equal(resultSummary([], sources, new Map(), { pending: true }), 'Completando informações…');
  assert.match(resultSummary([], sources, new Map()), /Nenhuma correspondência/);
});
