import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRuleText, contextualExcerpt } from '../js/rule-passages.js';
import { readingBlocks } from '../js/rule-reading.js';
import { columnLayout } from '../js/rule-layout.js';

test('marcador A. permanece junto ao subtítulo na prévia e recebe a hierarquia confirmada do PDF', () => {
  const title = 'A. Pegar uma Carta de Capítulo';
  const source = 'No seu turno, você pode pegar uma Carta de Capítulo ou pegar uma Peça de Lugar .\n' + title + '\nEscolha uma carta disponível. Em seguida, jogue-a ou descarte-a.';
  const excerpt = contextualExcerpt(source, 'turno', 600);
  assert(excerpt.preview.includes(title), 'a prévia não deve separar A. do título');
  const blocks = readingBlocks(excerpt.preview, { headings: [title] });
  assert(blocks.some((b) => b.type === 'heading' && b.text === title));
  assert(!blocks.some((b) => b.text === 'A.'));
  assert.equal(readingBlocks('A. Escolha uma carta.', { headings: [] })[0].type, 'paragraph', 'letra isolada não inventa um subtítulo');
});
test('pontuação de apresentação não mantém espaços artificiais e conserva números, termos e fonte', () => {
  const source = 'Os jogadores revezam os turnos , até o fim do jogo .\nPague o custo ( ver pág. 4 ) e receba 2.5 pontos; versão 1.2.';
  const clean = cleanRuleText(source);
  assert.match(clean, /turnos, até o fim do jogo\./);
  assert.match(clean, /\(ver pág\. 4\)/);
  assert.match(clean, /2\.5 pontos; versão 1\.2/);
  assert(source.includes('turnos ,'), 'o texto fonte é preservado');
});
test('duas caixas locais e legenda lateral não entram no meio das frases', () => {
  const i = (str, x, y, width, height = 10) => ({ str, transform: [height, 0, 0, height, x, y], width, height });
  const items = [
    i('Visão geral do turno', 42, 463, 130, 14),
    i('No seu turno, você pode pegar uma carta.', 28, 435, 306),
    i('A.', 28, 404, 14, 13),
    i('Pegar uma Carta de Capítulo', 44, 404, 171, 13),
    i('Escolha uma carta disponível,', 28, 389, 242),
    i('Carta', 462, 390.5, 18),
    i('ou seja, uma carta que não esteja coberta por nenhuma', 28, 377, 222),
    i('disponível', 462, 378.5, 33),
    i('outra carta. Em seguida, jogue-a ou descarte-a.', 28, 365, 213),
    i('Jogar a carta na sua frente', 35, 331, 114, 11),
    i('Descarte a carta', 299, 331, 70, 11),
    i('Pague o custo da carta e coloque-a', 35, 315, 199),
    i('Coloque a carta no descarte e pegue', 299, 315, 189),
    i('na sua área de jogo. Você recebe os benefícios', 35, 303, 208),
    i('moedas da reserva de acordo com', 299, 303, 189),
    i('de seu efeito imediatamente.', 35, 291, 120),
    i('ou', 269, 291, 15, 15),
    i('o capítulo atual:', 299, 291, 56),
    i('Nota: empilhe as cartas por cor.', 35, 276, 198),
    i('Capítulo 1: 1 Moeda', 324, 278, 70),
    i('Mantenha seus efeitos visíveis.', 35, 264, 143),
    i('Capítulo 2: 2 Moedas', 324, 266, 73),
    i('Capítulo 3: 3 Moedas', 324, 254, 73),
    i('Por fim, termine seu turno revelando as cartas disponíveis.', 28, 233, 343),
  ];
  const before = JSON.stringify(items),
    result = columnLayout(items, 553);
  const text = cleanRuleText(result.text);
  assert.match(text, /carta disponível, ou seja, uma carta que não esteja coberta por nenhuma outra carta\./);
  assert.match(text, /Pague o custo da carta e coloque-a na sua área de jogo\. Você recebe os benefícios de seu efeito imediatamente\./);
  assert.match(text, /Coloque a carta no descarte e pegue moedas da reserva de acordo com o capítulo atual:/);
  assert(result.text.indexOf('Mantenha seus efeitos visíveis.') < result.text.indexOf('Descarte a carta'));
  assert.deepEqual(result.readingSideNotes, ['Carta disponível']);
  assert.equal(JSON.stringify(items), before);
});

test('tabela local mantém rótulos e valores na mesma linha e exige conferência no PDF', () => {
  const item = (str, x, y, width) => ({ str, transform: [10, 0, 0, 10, x, y], width, height: 10 });
  const result = columnLayout([item('Ação', 30, 700, 30), item('Custo', 300, 700, 30), item('Mover', 30, 685, 30), item('2', 300, 685, 8), item('Atacar', 30, 670, 30), item('1', 300, 670, 8)], 550);
  assert.equal(result.literalRows, true);
  assert.equal(result.needsPdf, true);
  assert.match(result.text, /Mover\t2/);
  assert.match(result.text, /Atacar\t1/);
  const blocks = readingBlocks(result.text);
  assert.equal(blocks[0].type, 'table');
  assert.match(blocks[0].text, /Mover\t2/);
});
