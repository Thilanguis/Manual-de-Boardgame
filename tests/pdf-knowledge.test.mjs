import test from 'node:test';
import assert from 'node:assert/strict';
import { extendOcrIndex, pendingOcrPages, addOcrPage, ocrHeading } from '../js/pdf-knowledge.js';
import { searchRules, ruleCategory } from '../js/guide-model.js';
const fixture = async () => {
  const blob = new Blob(['manual autorizado de teste']);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join('');
  return { blob, game: { id: 'sina', language: 'pt-BR', manual: { sha256: hash } }, index: { gameId: 'sina', sourceHash: hash, pages: [1, 2, 3, 4].map((page) => ({ page, text: '' })), headings: [], pageCount: 4 } };
};
test('OCR faz lotes, guarda páginas físicas e retoma sem reler página concluída após cancelamento', async () => {
  const { blob, game, index } = await fixture();
  const controller = new AbortController();
  let checkpoints = 0;
  await assert.rejects(
    extendOcrIndex(blob, game, index, {
      signal: controller.signal,
      checkpoint: async () => {
        checkpoints++;
        controller.abort();
      },
      recognize: async (_, options) => {
        await options.onPage({ page: 1, status: 'done', text: 'Preparação\nColoque os componentes no tabuleiro e separe as cartas.', confidence: 90 });
        options.signal.throwIfAborted();
      },
    }),
  );
  assert.equal(checkpoints, 1);
  await extendOcrIndex(blob, game, index, {
    recognize: async (_, options) => {
      assert.deepEqual(options.pages, [2, 3, 4]);
      await options.onPage({ page: 2, status: 'low-confidence', text: '' });
      await options.onPage({ page: 3, status: 'failed', text: '' });
      await options.onPage({ page: 4, status: 'done', text: 'Combat\nLe joueur utilise ses capacités pour résoudre une attaque.', confidence: 85 });
    },
  });
  assert.deepEqual(pendingOcrPages(index), []);
  assert.deepEqual(pendingOcrPages(index, true), [2, 3]);
  const results = searchRules(index, null, 'preparação', { currentHash: game.manual.sha256 });
  assert.equal(results[0].page, 1);
  assert.equal(searchRules(index, null, 'preparação', { currentHash: 'b'.repeat(64) }).length, 0);
  await assert.rejects(extendOcrIndex(new Blob(['outro']), game, index), /PDF mudou/);
  assert.throws(() => addOcrPage(index, { page: 5 }), /fora/);
  assert.equal(ruleCategory('Mise en place'), 'Preparação');
  assert.equal(ruleCategory('Capacités'), 'Habilidades');
  assert.equal(ruleCategory('Conditions de victoire'), 'Pontuação e vitória');
});

test('OCR não transforma frases corridas ou lista de componentes em títulos de seção', () => {
  assert(ocrHeading('OBJETIVO DA PARTIDA'));
  assert(ocrHeading('1. Realizar Ações'));
  assert(ocrHeading('Mise en place'));
  assert.equal(ocrHeading('24 Cartas de Objetivo 10 Cartas de Referência'), false);
  assert.equal(ocrHeading('devem contribuir com suas habilidades exclusivas para proteger Frodo'), false);
});
test('um início conclui vários lotes e uma nova tentativa só processa falhas reais', async () => {
  const { blob, game, index } = await fixture();
  index.pageCount = 8;
  index.pages = Array.from({ length: 8 }, (_, i) => ({ page: i + 1, text: '' }));
  const batches = [],
    progress = [];
  await extendOcrIndex(blob, game, index, {
    onProgress: (p) => progress.push(p),
    recognize: async (_, options) => {
      batches.push(options.pages);
      for (const page of options.pages) await options.onPage({ page, text: page === 2 ? '' : 'Preparação\nDistribua as cartas para todos os jogadores antes da partida.', status: page === 2 ? 'failed' : 'done' });
    },
  });
  assert.deepEqual(batches, [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8],
  ]);
  assert.equal(progress.at(-1).current, 8);
  assert.deepEqual(pendingOcrPages(index), []);
  assert.deepEqual(pendingOcrPages(index, true), [2]);
  await extendOcrIndex(blob, game, index, {
    retry: true,
    recognize: async (_, options) => {
      assert.deepEqual(options.pages, [2]);
      await options.onPage({ page: 2, text: '', status: 'low-confidence' });
    },
  });
  assert.deepEqual(pendingOcrPages(index, true), [2]);
});
test('OCR malsucedido conserva texto nativo curto e nunca sobrescreve uma página já legível', async () => {
  const { index } = await fixture();
  index.pages[0] = { page: 1, text: 'Ações: mover e atacar.', method: 'pdf-text', extracted: true };
  addOcrPage(index, { page: 1, status: 'failed', text: '' });
  assert.equal(index.pages[0].text, 'Ações: mover e atacar.');
  assert.equal(index.pages[0].method, 'pdf-text');
  index.pages[1] = { page: 2, text: 'Texto nativo legível e válido que deve permanecer intacto no índice.' };
  addOcrPage(index, { page: 2, status: 'done', text: 'Outro texto' });
  assert.match(index.pages[1].text, /permanecer intacto/);
});
