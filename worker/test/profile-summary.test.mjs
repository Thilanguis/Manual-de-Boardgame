import test from 'node:test';
import assert from 'node:assert/strict';
import { completeProfileFromModel } from '../src/profile-completion.js';
import { knowledgeFields, synthesizePublicKnowledge } from '../src/game-knowledge.js';
import { savedKnowledgeCandidate } from '../../js/research-enrichment.js';
import { knowledgeFixture } from '../../tests/knowledge-fixture.mjs';
import { profileDefinitions } from '../../js/profile-facts.js';

const game = { id: 'draft', title: 'Sushi Go Party!', edition: '', manual: { sha256: 'f'.repeat(64), pages: 1 } };
const description = 'Escolha cartas e passe as demais aos outros jogadores, reunindo combinações para marcar pontos ao longo da partida.';
const raw = { requestedTitle: game.title, requestedEdition: '', recognized: true, fields: { description } };
const manual = { id: 'manual-1', documentId: 'main', sourceHash: game.manual.sha256, language: 'pt-BR', scope: 'edition-confirmed', profileEligible: true, pages: [{ page: 1, text: description }], facts: {} };

test('rótulo genérico do catálogo não bloqueia o resumo Gemini que o formulário pode usar', () => {
  const catalog = { id: 'catalog', profileOnly: true, profileEligible: true, facts: { description: 'jogo de tabuleiro' } };
  assert.equal(completeProfileFromModel(raw, game, [manual, catalog]).fields.description?.value, description);
});
test('visão geral longa ou rótulo genérico não elimina o resumo separado na mesma geração', async () => {
  for (const overview of ['Jogo de cartas.', description.repeat(20)]) {
    const fixture = knowledgeFixture();
    fixture.faults.metadata = Object.fromEntries(Object.keys(profileDefinitions).map((key) => [key, null]));
    fixture.faults.modelProfile = raw;
    fixture.faults.sections = [{ topic: 'visao-geral', title: 'Visão geral', text: overview, sourceId: manual.id, page: 1, evidenceId: 'manual-1-p1-1' }];
    const knowledge = await synthesizePublicKnowledge(game, [manual], fixture.env, (url, options) => fixture.fetch(url, options), { completeProfile: true });
    knowledge.fields = knowledgeFields(knowledge);
    const candidate = savedKnowledgeCandidate({ status: 'ready', knowledge }, game);
    assert.equal(candidate?.fields.description, description);
    assert.equal(candidate.fieldOrigins.description, 'gemini-model');
    assert.equal(knowledge.sections[0].text, overview, 'texto das regras permanece integral');
    assert.equal(fixture.calls.length, 1);
  }
});
test('resumo validado e visão geral corrigida manualmente conservam prioridade', () => {
  const backed = { value: 'Resumo sustentado pelo manual.', sourceId: manual.id };
  assert.equal(completeProfileFromModel(raw, game, [manual], { description: backed }).fields.description, undefined);
  const corrected = { topic: 'visao-geral', review: 'manual', sourceId: manual.id, text: 'Apresentação corrigida manualmente para descrever a proposta e o objetivo do jogo.' };
  assert.equal(knowledgeFields({ sources: [manual], sections: [corrected], profile: { description: { value: description, basis: 'model' } } }).description.value, corrected.text);
});
