import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMetadata, titleCandidates, linesFromItems } from '../js/recognition.js';
import { validateGame, filterGames, safeImageUrl } from '../js/model.js';
import { parseSearch, parseThing } from '../backend/bgg-parser.js';

test('extrai somente campos com evidência e mantém faixa de duração para revisão', () => {
  const result = extractMetadata('2–4 jogadores\nDuração: 30–60 minutos\nObjetivo do jogo\nReúna os recursos e complete o caminho.\nPreparação\nEscolha uma cor.');
  assert.equal(result.minPlayers, 2);
  assert.equal(result.maxPlayers, 4);
  assert.equal(result.durationMinutes, null);
  assert.match(result.sources.duration.excerpt, /30-60/);
  assert.equal(result.description, 'Reúna os recursos e complete o caminho.');
});
test('não transforma componentes em jogadores nem inventa dados ausentes', () => {
  const result = extractMetadata('São 4 peões, 60 cartas e 12 moedas.');
  assert.equal(result.minPlayers, null);
  assert.equal(result.durationMinutes, null);
  assert.equal(result.description, '');
});
test('reconhece jogadores e tempo em português e inglês', () => {
  const pt = extractMetadata('Jogadores: 1 a 5\nDuração: 2 horas');
  assert.deepEqual([pt.minPlayers, pt.maxPlayers, pt.durationMinutes], [1, 5, 120]);
  const en = extractMetadata('Players: 2-6\nPlaying time: 45 minutes');
  assert.deepEqual([en.minPlayers, en.maxPlayers, en.durationMinutes], [2, 6, 45]);
});
test('organiza as linhas e ignora título genérico dos metadados', () => {
  const lines = linesFromItems([
    { str: 'JOGO', height: 36, transform: [1, 0, 0, 36, 120, 700] },
    { str: 'MEU', height: 36, transform: [1, 0, 0, 36, 20, 700] },
    { str: 'Regras', height: 12, transform: [1, 0, 0, 12, 20, 650] },
  ]);
  assert.equal(lines[0].text, 'MEU JOGO');
  const titles = titleCandidates({ metadataTitle: 'Microsoft Word', filename: 'meu_jogo_manual_pt-br.pdf', lines });
  assert.equal(titles[0].text, 'MEU JOGO');
  assert.equal(titles[0].source, 'Título na primeira página');
});
test('validação permite desconhecidos e rejeita faixas inválidas', () => {
  assert.equal(validateGame({ title: 'Jogo' }).durationMinutes, null);
  assert.throws(() => validateGame({ title: 'Jogo', minPlayers: 5, maxPlayers: 2 }), /mínimo/i);
  assert.throws(() => validateGame({ title: 'Jogo', minPlayers: 2 }), /dois em branco/);
  assert.throws(() => validateGame({ title: 'Jogo', durationMinutes: 1.5 }), /inteiro/);
  assert.equal(safeImageUrl('javascript:alert(1)'), '');
  assert.equal(safeImageUrl('https://example.com/cover.jpg'), 'https://example.com/cover.jpg');
});
test('busca ignora acentos e filtros excluem informações desconhecidas', () => {
  const games = [
    { id: 'a', title: 'Expedição', tags: ['Estratégia'], minPlayers: 1, maxPlayers: 4, durationMinutes: 30 },
    { id: 'b', title: 'Outro', tags: [], minPlayers: null, maxPlayers: null, durationMinutes: null },
  ];
  assert.equal(filterGames(games, { query: 'expedicao' }).length, 1);
  assert.equal(filterGames(games, { filter: 'quick' }).length, 1);
  assert.equal(filterGames(games, { players: '2' }).length, 1);
  assert.equal(filterGames(games, { filter: 'favorites', favorites: ['b'] })[0].id, 'b');
});
test('normaliza formatos XML de uma ou várias correspondências BGG', () => {
  const item = { '@_id': '123', '@_type': 'boardgame', name: { '@_type': 'primary', '@_value': 'Jogo de teste' }, yearpublished: { '@_value': '2020' } };
  assert.deepEqual(parseSearch({ items: { item } }), [{ id: '123', title: 'Jogo de teste', year: 2020 }]);
  assert.equal(parseSearch({ items: { item: [item, { '@_type': 'boardgameexpansion' }] } }).length, 1);
  const result = parseThing({ items: { item: { ...item, description: 'Texto da fonte', minplayers: { '@_value': '2' }, maxplayers: { '@_value': '4' }, playingtime: { '@_value': '45' }, image: 'https://example.com/game.jpg' } } });
  assert.equal(result.title, 'Jogo de teste');
  assert.equal(result.durationMinutes, 45);
  assert.equal(result.image, 'https://example.com/game.jpg');
});
