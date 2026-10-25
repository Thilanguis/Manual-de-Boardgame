import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfSearchText, pdfSearchMatches } from '../js/pdf-search.js';
test('busca ignora caixa e acentos e conserva posições para destacar o trecho original', () => {
  const content = pdfSearchText([{ str: 'Ação rápida' }, { str: 'Cartas' }]);
  const [match] = pdfSearchMatches(content, 'ACAO');
  assert.deepEqual(match, { first: { item: 0, offset: 0, end: 1 }, last: { item: 0, offset: 3, end: 4 } });
  assert.equal(pdfSearchMatches(content, 'rápida cartas').length, 1);
  assert.equal(pdfSearchMatches(content, '').length, 0);
  assert.equal(pdfSearchMatches(content, 'ausente').length, 0);
});
test('busca retorna todas as ocorrências, trata símbolos como texto e aceita PDF sem texto', () => {
  assert.equal(pdfSearchMatches(pdfSearchText([{ str: 'carta Carta CARTA' }]), 'carta').length, 3);
  assert.equal(pdfSearchMatches(pdfSearchText([{ str: '<script> [2]' }]), '[2]').length, 1);
  assert.equal(pdfSearchMatches(pdfSearchText([]), 'carta').length, 0);
  const content = pdfSearchText([{ str: '🎲  Ação   ' }, { str: ' ﬁnal' }]);
  const [match] = pdfSearchMatches(content, 'acao final');
  assert.equal(match.first.offset, 4);
  assert.equal(match.last.item, 1);
  assert.equal(match.last.end, 5);
});
