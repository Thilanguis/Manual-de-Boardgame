import test from 'node:test';
import assert from 'node:assert/strict';
import { filterLibraryGames, libraryFacetOptions } from '../js/library-filter-model.js';
import { libraryGames as games } from './library-filter-fixture.mjs';
const ids = (criteria) => filterLibraryGames(games, criteria).map((game) => game.id);

test('biblioteca combina jogadores, duração, tipo, mecânica e favoritos', () => {
  assert.deepEqual(ids({ players: '4', duration: '30', gameType: 'jogo de cartas', mechanic: 'selecao de cartas', favoritesOnly: true, favorites: ['cards', 'long'] }), ['cards']);
  assert.deepEqual(ids({ players: '1', favoritesOnly: true, favorites: ['cards'] }), []);
  assert.deepEqual(ids({ duration: '60', gameType: 'jogo de cartas', sort: 'az' }), ['dice', 'cards']);
});

test('busca inclui tipo e mecânicas, respeitando acentos e vocabulário já conhecido', () => {
  assert.deepEqual(ids({ query: 'gestao recursos' }), ['resources']);
  assert.deepEqual(ids({ query: 'rolagem de dados' }), ['dice']);
  assert.deepEqual(ids({ query: 'dice rolling' }), ['dice']);
  assert.deepEqual(ids({ query: 'colecao conjuntos' }), ['cards']);
  assert.deepEqual(
    filterLibraryGames([{ id: 'original-title', title: 'Horror' }], { query: 'Horror' }).map((game) => game.id),
    ['original-title'],
    'um título que também é termo traduzível continua pesquisável',
  );
});

test('contagens refletem os outros filtros; aliases e categorias repetidas contam uma vez por jogo', () => {
  const facets = libraryFacetOptions(games, { players: '4', duration: '30' });
  assert.deepEqual(facets.gameType, [{ value: 'jogo de cartas', label: 'Jogo de cartas', count: 1 }]);
  assert.deepEqual(
    facets.category.map((option) => option.label),
    ['Familiar'],
  );
  assert.equal(facets.mechanic.find((option) => option.value === 'selecao de cartas').count, 1);
  const all = libraryFacetOptions(games);
  assert.equal(all.gameType.find((option) => option.value === 'jogo de cartas').count, 2);
  assert.equal(all.category.find((option) => option.value === 'fantasia').count, 2);
  assert.equal(all.players.find((option) => option.value === '8').count, 1);
  assert.equal(
    all.players.some((option) => option.value === '9'),
    false,
  );
});

test('tempo usa a duração máxima confirmada; idade ausente não satisfaz o filtro', () => {
  assert.deepEqual(ids({ duration: '120' }).sort(), ['cards', 'dice', 'resources']);
  assert.deepEqual(ids({ duration: 'long' }), ['long']);
  assert.deepEqual(ids({ age: '8' }), ['cards']);
  assert.equal(ids({}).includes('unknown'), true);
  const partial = { id: 'partial', minDurationMinutes: null, maxDurationMinutes: 30, minPlayers: null, maxPlayers: 4 };
  assert.deepEqual(filterLibraryGames([partial], { duration: '30' }), []);
  assert.deepEqual(filterLibraryGames([partial], { players: '2' }), []);
});

test('opções mudam após edição e não alteram fichas, classificação ou ordem original', () => {
  const before = JSON.stringify(games);
  libraryFacetOptions(games, { category: 'fantasia', age: '10' });
  filterLibraryGames(games, { sort: 'duration', query: 'cartas' });
  assert.equal(JSON.stringify(games), before);
  const edited = games.map((game) => (game.id === 'cards' ? { ...game, mechanics: ['Memória'] } : game));
  const mechanics = libraryFacetOptions(edited).mechanic;
  assert.equal(
    mechanics.some((option) => option.value === 'memoria'),
    true,
  );
  assert.equal(
    mechanics.some((option) => option.value === 'selecao de cartas'),
    false,
  );
});
