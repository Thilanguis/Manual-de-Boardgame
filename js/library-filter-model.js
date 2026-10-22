import { normalizeText, filterGames, durationRange } from './model.js';
import { vocabularyTerm } from './game-vocabulary.js';

export const libraryFilterDefaults = Object.freeze({ query: '', players: '', gameType: '', category: '', mechanic: '', duration: '', age: '', favoritesOnly: false });
export const libraryFacetKeys = ['players', 'gameType', 'category', 'mechanic', 'duration', 'age'];
const termKey = (value) => normalizeText(vocabularyTerm(value));
const values = (game, field) => (Array.isArray(game[field]) ? game[field] : game[field] ? [game[field]] : []).map(vocabularyTerm).filter(Boolean);
const hasTerm = (game, field, key) => values(game, field).some((value) => termKey(value) === key);
const playerRange = (game) => {
  const min = Number(game.minPlayers),
    max = Number(game.maxPlayers);
  return Number.isInteger(min) && Number.isInteger(max) && min > 0 && max >= min && max <= 100 ? [min, max] : null;
};
const supportsPlayers = (game, count) => {
  const range = playerRange(game);
  return range && range[0] <= count && range[1] >= count;
};
const withinDuration = (game, value) => {
  const { minDurationMinutes: min, maxDurationMinutes: max } = durationRange(game);
  return min > 0 && max >= min && Number.isFinite(max) && (value === 'long' ? max > 120 : max <= Number(value));
};
const withinAge = (game, value) => Number(game.recommendedAge) > 0 && Number(game.recommendedAge) <= Number(value);

export function filterLibraryGames(games, criteria = {}) {
  const queries = [...new Set([normalizeText(criteria.query || ''), normalizeText(vocabularyTerm(criteria.query || ''))])].map((query) => query.split(' ').filter(Boolean));
  return filterGames(games, { ...criteria, query: '' }).filter((game) => {
    const searchable = normalizeText([game.title, game.gameType || '', (game.tags || []).toString(), (game.mechanics || []).toString(), ...values(game, 'gameType'), ...values(game, 'tags'), ...values(game, 'mechanics')].join(' '));
    return (
      queries.some((words) => words.every((word) => searchable.includes(word))) &&
      (!criteria.players || supportsPlayers(game, Number(criteria.players))) &&
      (!criteria.favoritesOnly || (criteria.favorites || []).includes(game.id)) &&
      (!criteria.gameType || hasTerm(game, 'gameType', criteria.gameType)) &&
      (!criteria.category || hasTerm(game, 'tags', criteria.category)) &&
      (!criteria.mechanic || hasTerm(game, 'mechanics', criteria.mechanic)) &&
      (!criteria.duration || withinDuration(game, criteria.duration)) &&
      (!criteria.age || withinAge(game, criteria.age))
    );
  });
}

// Cada contagem considera os outros filtros, permitindo trocar a opção do
// próprio campo. Categorias repetidas no mesmo jogo contam apenas uma vez.
export function libraryFacetOptions(games, criteria = {}) {
  const facets = {};
  for (const key of libraryFacetKeys) {
    const pool = filterLibraryGames(games, { ...criteria, [key]: '' });
    const options = new Map();
    const add = (value, label) => {
      if (!options.has(value)) options.set(value, { value, label, count: 0 });
      options.get(value).count++;
    };
    for (const game of pool) {
      if (key === 'players') {
        const range = playerRange(game);
        if (range) for (let n = range[0]; n <= range[1]; n++) add(String(n), `${n} ${n === 1 ? 'jogador' : 'jogadores'}`);
      } else if (['gameType', 'category', 'mechanic'].includes(key)) {
        const field = { gameType: 'gameType', category: 'tags', mechanic: 'mechanics' }[key];
        const unique = new Map(values(game, field).map((label) => [termKey(label), label]));
        for (const [value, label] of unique) if (value) add(value, label);
      }
    }
    if (key === 'duration') {
      for (const [value, label] of [
        ['30', 'Até 30 min'],
        ['60', 'Até 1 hora'],
        ['120', 'Até 2 horas'],
        ['long', 'Mais de 2 horas'],
      ]) {
        const count = pool.filter((game) => withinDuration(game, value)).length;
        if (count) options.set(value, { value, label, count });
      }
    } else if (key === 'age') {
      const ages = [...new Set(pool.map((game) => Number(game.recommendedAge)).filter((age) => Number.isInteger(age) && age > 0))].sort((a, b) => a - b);
      for (const age of ages) options.set(String(age), { value: String(age), label: `Até ${age} anos`, count: pool.filter((game) => withinAge(game, age)).length });
    }
    facets[key] = [...options.values()];
    if (key === 'players') facets[key].sort((a, b) => Number(a.value) - Number(b.value));
    else if (['gameType', 'category', 'mechanic'].includes(key)) facets[key].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }
  return facets;
}
