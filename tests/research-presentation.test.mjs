import test from 'node:test';
import assert from 'node:assert/strict';
import { presentCandidate, candidateFacts, resultSummary } from '../js/research-presentation.js';
import { selectedFields } from '../js/research-client.js';
import { synopsisText, displayDescription } from '../js/model.js';

test('PT-BR usa somente nomes da obra identificada, sem inventar traduções de homônimos', () => {
  const candidate = {
    source: 'wikidata',
    id: 'Q137295527',
    fields: { title: 'The Lord of the Rings: Fate of the Fellowship', description: '2025 board game' },
    identifiers: { bgg: '436217' },
    names: [
      { value: 'O Senhor dos Anéis: Sina da Sociedade', language: 'pt-BR' },
      { value: 'The Lord of the Rings: Fate of the Fellowship', language: 'en' },
    ],
    kind: 'base',
  };
  const result = presentCandidate(candidate);
  assert.equal(result.fields.title, 'O Senhor dos Anéis: Sina da Sociedade');
  assert.equal(result.secondaryTitle, candidate.fields.title);
  assert.equal(result.fields.description, undefined);
  assert.deepEqual(candidateFacts(result), []);
  assert.deepEqual(
    selectedFields(result, {}).map((f) => f.key),
    ['title'],
  );
  const other = { ...candidate, id: 'other', identifiers: { bgg: '999' }, fields: { title: 'Outro jogo' }, names: [{ value: 'Tradução de outro jogo', language: 'pt-BR' }] };
  const unknown = { ...candidate, names: [], identifiers: {} };
  assert.equal(presentCandidate(unknown, [other]).fields.title, candidate.fields.title);
});

test('cartão exibe apenas metadados utilizáveis e agrupa intervalos', () => {
  const candidate = { fields: { title: 'Jogo', minPlayers: 1, maxPlayers: 5, minDurationMinutes: 60, maxDurationMinutes: 150, recommendedAge: 14, tags: ['Aventura'], mechanics: ['Cooperação'], gameType: 'Cooperativo' } };
  assert.deepEqual(candidateFacts(candidate), [
    ['Jogadores', '1–5 jogadores'],
    ['Duração', '60–150 min'],
    ['Idade', '14+ anos'],
    ['Tipo', 'Cooperativo'],
    ['Categorias', 'Aventura'],
    ['Mecânicas', 'Cooperação'],
  ]);
  assert.deepEqual(
    selectedFields({ fields: { title: 'Jogo', minPlayers: null, tags: [], description: '' } }, {}).map((f) => f.key),
    ['title'],
  );
});

test('resumo conta obras e não conectores; falhas continuam visíveis sem diagnóstico extenso', () => {
  const a = { source: 'wikidata', id: '1', kind: 'base', identifiers: { bgg: '436217' } };
  const b = { ...a, source: 'wikipedia' };
  const sources = [{ enabled: true }, { enabled: false }];
  assert.equal(resultSummary([a, b], sources, new Map()), '1 jogo encontrado nas fontes. Sem informações adicionais aproveitáveis.');
  assert.match(resultSummary([], sources, new Map([['a', { status: 'error' }]])), /fontes disponíveis.*não responderam/);
  assert.equal(resultSummary([], [{ enabled: false }], new Map()), 'Pesquisa externa indisponível.');
});

test('rótulo genérico e texto estrangeiro sem revisão não aparecem como sinopse pública', () => {
  for (const value of ['2025 board game', 'jogo de tabuleiro', 'jeu de société de 2025', 'Jogo de cartas.']) assert.equal(synopsisText(value), '');
  assert.equal(displayDescription({ description: 'Explore a ilha e reúna tesouros.' }), 'Explore a ilha e reúna tesouros.');
  const game = { description: 'Explore Middle-earth with your companions.', sources: { description: { language: 'en' } } };
  assert.equal(displayDescription(game), '');
  game.sources.description.confirmedAt = 1;
  assert.equal(displayDescription(game), '');
  game.description = 'Explore a Terra-média com seus companheiros.';
  game.sources.description.language = 'pt-BR';
  assert.equal(displayDescription(game), game.description);
});
