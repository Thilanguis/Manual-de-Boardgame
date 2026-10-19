import test from 'node:test';
import assert from 'node:assert/strict';
import { metadataOcrLines } from '../js/ocr-metadata.js';
import { extractMetadata, extractPageMetadata } from '../js/recognition.js';
import { readablePage } from '../js/text-quality.js';
import { addOcrPage, needsCoverRecovery } from '../js/pdf-knowledge.js';

const word = (block, n, text, confidence = 96) => ['5', '1', block, '1', '1', n, '10', '10', '50', '20', confidence, text].join('\t');
test('capa curta recupera idade e faixa de jogadores de palavras confiáveis, sem aceitar ruído da ilustração', () => {
  const tsv = [word(1, 1, 'Idades:', 92.8), word(1, 2, '8+', 92.8), word(2, 1, '2-8'), word(2, 2, 'Jogadores'), word(3, 1, '99', 14), word(3, 2, 'anos', 20)].join('\n');
  const lines = metadataOcrLines(tsv);
  assert.deepEqual(
    lines.map((l) => l.text),
    ['Idades: 8+', '2-8 Jogadores'],
  );
  const text = lines.map((l) => l.text).join('\n');
  assert.equal(readablePage({ text }), true);
  const fields = extractMetadata(text);
  assert.deepEqual([fields.recommendedAge, fields.minPlayers, fields.maxPlayers], [8, 2, 8]);
  assert.equal(readablePage({ text: '8 2 8' }), false);
  assert.equal(readablePage({ text: 'Idades: □□□ 8+' }), false);
});
test('uma palavra de baixa confiança invalida a linha inteira; componentes e números soltos não viram ficha', () => {
  assert.deepEqual(metadataOcrLines([word(1, 1, 'Idades:'), word(1, 2, '8+', 40), word(2, 1, '181'), word(2, 2, 'cartas')].join('\n')), []);
});
test('recuperação da capa preserva original e versão, sem solicitar OCR novamente após concluir', () => {
  const index = { pages: [{ page: 1, text: '', originalText: '', ocrStatus: 'low-confidence' }], pageCount: 1, headings: [] };
  assert.equal(needsCoverRecovery(index), true);
  addOcrPage(index, { page: 1, text: 'Idades: 8+\n2-8 Jogadores', status: 'done', confidence: 92, coverOcrVersion: 1 });
  assert.equal(index.pages[0].originalText, '');
  assert.equal(index.pages[0].ocrStatus, 'done');
  assert.equal(needsCoverRecovery(index), false);
});

test('faixas usadas nas regras de cartas não apagam a ficha explícita na capa', () => {
  const metadata = extractPageMetadata([
    { page: 1, text: 'Idades: 8+\n2-8 Jogadores' },
    { page: 2, text: 'Em uma partida de 6 a 8 jogadores, vire o marcador. Em partidas de 2 a 5 jogadores não use estas cartas.' },
  ]);
  assert.deepEqual([metadata.minPlayers, metadata.maxPlayers, metadata.recommendedAge], [2, 8, 8]);
  assert.equal(metadata.sources.players.page, 1);
  assert.equal(metadata.minDurationMinutes, null);
});
