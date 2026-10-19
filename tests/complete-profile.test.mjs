import test from 'node:test';
import assert from 'node:assert/strict';
import { profileSchema, profileDefinitions, inspectProfile } from '../js/profile-facts.js';
import { durationSuggestion } from '../js/research-duration.js';
import * as knowledgeModel from '../js/knowledge-model.js';
const text = 'Ficha Exemplo. Edição: 2025. Para 1 a 4 jogadores. Duração: 90 minutos. Idade: 14 anos. Jogo cooperativo de aventura com gestão de cartas.';
const source = { id: 'manual', documentId: 'main', sourceHash: 'a'.repeat(64), language: 'pt-BR', scope: 'edition-confirmed', pages: [{ page: 1, text }] };
const fact = (value) => ({ value, sourceId: source.id, page: 1, quote: text });
test('contrato exige examinar cada campo da ficha, com null explícito para o que não foi encontrado', () => {
  const schema = profileSchema(true);
  assert.deepEqual(schema.required.sort(), Object.keys(profileDefinitions).sort());
  for (const item of Object.values(schema.properties)) assert.equal(item.nullable, true);
});
test('duração Gemini única com evidência fixa preenche os dois limites', () => {
  for (const raw of [{ minDurationMinutes: fact(90) }, { maxDurationMinutes: fact(90) }, { durationMinutes: fact(90) }]) {
    const result = inspectProfile(raw, [source]);
    assert.equal(result.fields.minDurationMinutes?.value, 90);
    assert.equal(result.fields.maxDurationMinutes?.value, 90);
    assert.equal(result.fields.maxDurationMinutes?.page, 1);
  }
});
test('normalização de sugestões repete valor único e ordena os extremos da mesma fonte', () => {
  assert.deepEqual(durationSuggestion({ minDurationMinutes: 90 }), { minDurationMinutes: 90, maxDurationMinutes: 90 });
  assert.deepEqual(durationSuggestion({ maxDurationMinutes: 90 }), { minDurationMinutes: 90, maxDurationMinutes: 90 });
  assert.deepEqual(durationSuggestion({ minDurationMinutes: 120, maxDurationMinutes: 60 }), { minDurationMinutes: 60, maxDurationMinutes: 120 });
});

test('intervalo literal do manual recupera o extremo omitido sem transformar a faixa em duração fixa', () => {
  const text = 'A partida tem duração de 60 a 120 minutos.';
  const ranged = { ...source, pages: [{ page: 1, text }] };
  for (const raw of [{ minDurationMinutes: { ...fact(60), quote: text } }, { maxDurationMinutes: { ...fact(120), quote: text } }]) {
    const result = inspectProfile(raw, [ranged]);
    assert.equal(result.fields.minDurationMinutes?.value, 60);
    assert.equal(result.fields.maxDurationMinutes?.value, 120);
    assert.equal(result.fields.maxDurationMinutes?.page, 1);
  }
});
test('uma descrição válida não significa que a ficha inteira já foi analisada', () => {
  const game = { title: 'Ficha Exemplo', manual: { sha256: source.sourceHash, pages: 1 } };
  const knowledge = { title: game.title, profile: { description: fact('Uma aventura cooperativa com cartas.') }, sources: [source] };
  assert.equal(typeof knowledgeModel.hasCompleteProfile, 'function');
  assert.equal(knowledgeModel.hasCompleteProfile(knowledge, game), false);
});

test('duração mínima sem limite superior não vira duração fixa sem evidência', () => {
  const bounded = { ...source, pages: [{ page: 1, text: 'A partida dura no mínimo 90 minutos; o tempo depende do cenário.' }] };
  const result = inspectProfile({ minDurationMinutes: { ...fact(90), quote: bounded.pages[0].text } }, [bounded]);
  assert.equal(result.fields.maxDurationMinutes, undefined);
  assert.equal(result.fields.minDurationMinutes, undefined, 'faixa sem evidência completa continua pendente');
  assert.deepEqual(durationSuggestion({ minDurationMinutes: 90, maxDurationMinutes: 'inválido' }), { minDurationMinutes: 90 });
});

test('todos os campos examinados e ausentes são reutilizados sem ciclo de IA', () => {
  const game = { title: 'Ficha Exemplo', manual: { sha256: source.sourceHash, pages: 1 } };
  const inspected = inspectProfile(Object.fromEntries(Object.keys(profileDefinitions).map((key) => [key, null])), [source]);
  assert.equal(inspected.analysis.coverageComplete, true);
  assert.equal(knowledgeModel.hasCompleteProfile({ title: game.title, profile: inspected.fields, profileAnalysis: inspected.analysis, sources: [source] }, game), true);
});

test('ficha antiga com todos os 11 fatos já válidos não é regenerada pelo marcador novo', () => {
  const values = {
    title: 'Ficha Exemplo',
    edition: '2025',
    description: 'Uma aventura cooperativa com cartas.',
    minPlayers: 1,
    maxPlayers: 4,
    minDurationMinutes: 90,
    maxDurationMinutes: 90,
    recommendedAge: 14,
    tags: ['Aventura'],
    mechanics: ['Gestão de cartas'],
    gameType: 'Cooperativo',
  };
  const game = { title: values.title, manual: { sha256: source.sourceHash, pages: 1 } };
  const knowledge = { title: values.title, profile: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, fact(v)])), sources: [source], profileAnalysis: { version: 2, complete: true } };
  assert.equal(knowledgeModel.hasCompleteProfile(knowledge, game), true);
});
