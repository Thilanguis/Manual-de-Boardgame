import test from 'node:test';
import assert from 'node:assert/strict';
import { columnLayout, readableIndex } from '../js/rule-layout.js';

test('projeção separa colunas, conserva texto e não altera os itens originais', () => {
  const items = [];
  for (let i = 0; i < 16; i++)
    for (const [x, label] of [
      [40, 'Esquerda'],
      [380, 'Direita'],
    ])
      items.push({ str: `${label}: instrução completa ${i}.`, transform: [11, 0, 0, 11, x, 700 - i * 15], width: 260, height: 11 });
  const before = JSON.stringify(items),
    result = columnLayout(items, 720);
  assert.equal(result.columns, 2);
  assert(result.text.indexOf('Esquerda: instrução completa 15.') < result.text.indexOf('Direita: instrução completa 0.'));
  assert.equal(JSON.stringify(items), before);
  assert.equal(
    columnLayout(
      items.filter((i) => i.transform[4] === 40),
      720,
    ).columns,
    1,
  );
});

test('cache de projeção não autoriza ler um PDF em sessão revogada nem repetir OCR salvo', async () => {
  let reads = 0;
  const repository = {
    session: { canRead: false, user: { uid: 'a' } },
    getManual: async () => {
      reads++;
    },
  };
  const document = { id: 'main', manual: { sha256: 'hash' } },
    game = { id: 'game', manual: document.manual };
  const index = { sourceHash: 'hash', pages: [{ page: 1, text: 'Texto do manual.' }] };
  assert.equal(await readableIndex(repository, game, document, index), index);
  assert.equal(reads, 0);
  repository.session.canRead = true;
  const ocr = { ...index, pages: [{ ...index.pages[0], method: 'ocr-local' }] };
  assert.equal(await readableIndex(repository, game, document, ocr), ocr);
  assert.equal(reads, 0);
});
