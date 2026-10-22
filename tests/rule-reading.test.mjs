import test from 'node:test';
import assert from 'node:assert/strict';
import { readingBlocks } from '../js/rule-reading.js';
import { repeatedMargins, columnLayout } from '../js/rule-layout.js';

test('leitura conserva títulos, listas, sequência e exceções sem fabricar etapas', () => {
  const text =
    'PREPARAÇÃO\n\nDistribua as cartas\nentre todos os jogadores.\n\n• Coloque o tabuleiro.\n• Separe as peças.\n\n1. Escolha uma carta.\n2. Revele sua escolha.\n\nExceção: o primeiro jogador não compra.\n\nExemplo: Ana revela uma carta azul.\n\n5. Pontuação';
  const blocks = readingBlocks(text);
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[1].text, 'Distribua as cartas entre todos os jogadores.');
  assert.deepEqual(blocks.find((b) => b.type === 'list' && !b.ordered).items, ['Coloque o tabuleiro.', 'Separe as peças.']);
  assert.equal(blocks.find((b) => b.ordered).items.length, 2);
  assert(blocks.some((b) => b.type === 'notice' && /primeiro jogador/.test(b.text)));
  assert(blocks.some((b) => b.type === 'example'));
  assert(blocks.some((b) => b.type === 'heading' && b.text === '5. Pontuação'));
  assert.equal(readingBlocks('3. Receba moedas conforme sua posição.')[0].type, 'paragraph');
  assert.equal(text.includes('\nentre'), true, 'a fonte não foi alterada');
});
test('corrupção oferece PDF; tabela conserva linhas sem inventar prosa; alfabetos válidos continuam legíveis', () => {
  assert.equal(readingBlocks('□'.repeat(20))[0].type, 'notice');
  assert.equal(readingBlocks('| Ação | Custo |\n| Mover | 2 |')[0].type, 'table');
  assert.notEqual(readingBlocks('日本語の説明とゲームのルールです。')[0].type, 'notice');
  assert.equal(readingBlocks('Na versão 1.2, o custo é 2.5 pontos.')[0].text, 'Na versão 1.2, o custo é 2.5 pontos.');
});
test('somente margens recorrentes e numeração periférica são removidas da projeção', () => {
  const item = (str, y, x = 30, height = 10, width = 120) => ({ str, transform: [height, 0, 0, height, x, y], width, height });
  const pages = Array.from({ length: 4 }, (_, i) => ({ height: 800, items: [item('MANUAL DO JOGO', 780), item('Regra central preservada.', 500), item(String(i + 1), 20)] }));
  const before = JSON.stringify(pages),
    result = repeatedMargins(pages);
  assert.equal(result[0].items.length, 1);
  assert.equal(JSON.stringify(pages), before);
  const unique = repeatedMargins([{ height: 800, items: [item('Aviso único', 780)] }]);
  assert.equal(unique[0].items.length, 1);
});
test('cabeçalho largo antecede as duas colunas, sem juntar assuntos separados', () => {
  const items = [];
  for (let n = 0; n < 16; n++) for (const x of [30, 390]) items.push({ str: `${x === 30 ? 'Esquerda' : 'Direita'} regra ${n}`, transform: [10, 0, 0, 10, x, 700 - n * 15], width: 220, height: 10 });
  items.push({ str: 'TÍTULO GERAL', transform: [20, 0, 0, 20, 30, 740], width: 600, height: 20 });
  const result = columnLayout(items, 720);
  assert.equal(result.columns, 2);
  assert(result.text.startsWith('\n\nTÍTULO GERAL') || result.text.trim().startsWith('TÍTULO GERAL'));
  assert(result.text.indexOf('Esquerda regra 15') < result.text.indexOf('Direita regra 0'));
});
test('título maior em página simples não faz o corpo virar microtexto de diagrama', () => {
  const result = columnLayout(
    [
      { str: 'Título', transform: [23, 0, 0, 23, 40, 740], width: 100, height: 23 },
      { str: 'Navegação: coloque as cartas na mesa.', transform: [11, 0, 0, 11, 40, 660], width: 280, height: 11 },
    ],
    595,
  );
  assert.equal(result.needsPdf, false);
  assert.match(result.text, /Navegação/);
});
