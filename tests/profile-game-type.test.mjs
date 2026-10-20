import test from 'node:test';
import assert from 'node:assert/strict';
import { usefulGameType, validModelProfileValue, inspectProfile, combinedProfileComplete, profileDefinitions } from '../js/profile-facts.js';
import { rejectionText } from '../js/profile-diagnostics.js';

test('tipo genérico não é ficha útil; formatos específicos e modos existentes continuam válidos', () => {
  for (const value of ['Jogo de tabuleiro', 'Jogo de tabuleiro.', 'BOARD GAME', 'boardgame', 'Jogo de mesa', 'Jeu de société', 'Jogo']) {
    assert.equal(usefulGameType(value), false, value);
    assert.equal(validModelProfileValue('gameType', value), false, value);
  }
  for (const value of ['Cartas · competitivo', 'Gestão de recursos', 'Aventura com miniaturas · cooperativo', 'Dados', 'Cooperativo', 'Jogo base cooperativo']) assert.equal(validModelProfileValue('gameType', value), true, value);
});

test('extração e cache rejeitam somente o rótulo genérico com diagnóstico claro, preservando outros fatos', () => {
  const text = 'Escolha cartas e reúna combinações para marcar pontos.';
  const source = { id: 'manual', pages: [{ page: 1, text }] };
  const raw = { gameType: { value: 'jogo de tabuleiro', sourceId: source.id, page: 1, quote: text }, description: { value: text, sourceId: source.id, page: 1, quote: text } };
  const checked = inspectProfile(raw, [source]);
  assert.equal(checked.fields.gameType, undefined);
  assert.equal(checked.fields.description.value, text);
  assert.match(rejectionText(checked.analysis.rejected[0]), /classificação genérica/);
  raw.gameType.value = 'Cartas · competitivo';
  assert.equal(inspectProfile(raw, [source]).fields.gameType.value, raw.gameType.value);
});

test('cache com tipo genérico permite atualização explícita única, sem invalidar tentativas novas', () => {
  const knowledge = {
    profile: {}, fields: { gameType: { value: 'Jogo de tabuleiro' } }, sources: [],
    profileAnalysis: { coverageComplete: true, checkedFields: Object.keys(profileDefinitions), publicEvidenceProtocol: 3, discovery: { version: 1, status: 'unavailable' } },
  };
  assert.equal(combinedProfileComplete(knowledge, 3), false);
  knowledge.profileAnalysis.gameTypeProtocol = 1;
  assert.equal(combinedProfileComplete(knowledge, 3), true, 'não cria ciclo de geração');
  delete knowledge.profileAnalysis.gameTypeProtocol;
  knowledge.fields.gameType.value = 'Cartas · competitivo';
  assert.equal(combinedProfileComplete(knowledge, 3), true, 'classificação útil salva continua reutilizável');
});
