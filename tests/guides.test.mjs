import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanGuide, searchRules, publishedAssets, checkGuidePages } from '../js/guide-model.js';
import { detectHeadings, packIndex, unpackIndex, suggestedSections } from '../js/pdf-index.js';
import { titleCandidates, extractMetadata } from '../js/recognition.js';
import { requestBgg } from '../js/bgg-client.js';
test('nomes genéricos não superam o título; nomes de arquivos são normalizados', () => {
  assert.equal(titleCandidates({ metadataTitle: 'LIVRO DE', filename: 'Resident_Evil_PTBR_Layout.pdf', lines: [{ text: 'Resident Evil', height: 35 }] })[0].text, 'Resident Evil');
  assert.equal(titleCandidates({ filename: 'Ilha-do-Tesouro_regras.pdf' })[0].text, 'Ilha do Tesouro');
});
test('metadados adicionais exigem evidência; ausência não gera dados', () => {
  const m = extractMetadata('Jogo cooperativo\nIdade recomendada: 14 anos\nEdição: Segunda\nMecânicas: construção de baralho, movimento');
  assert.equal(m.recommendedAge, 14);
  assert.equal(m.gameType, 'Cooperativo');
  assert.equal(m.edition, 'Segunda');
  assert.deepEqual(m.mechanics, ['construção de baralho', 'movimento']);
  assert.equal(extractMetadata('Use as 14 cartas.').recommendedAge, null);
});
test('títulos retêm página física; sugestões ficam pendentes de revisão', () => {
  assert.equal(
    detectHeadings(
      [
        { text: 'Preparação', height: 20 },
        { text: 'Distribua as cartas.', height: 10 },
      ],
      5,
    )[0].page,
    5,
  );
  const sections = suggestedSections({ headings: [{ title: 'Movimento', page: 1, source: 'Bookmark' }], pages: [{ page: 1, text: 'Movimento\nMova uma peça.' }] });
  assert.equal(sections[0].reviewed, false);
  assert.equal(sections[0].text, 'Movimento\nMova uma peça.');
});
test('busca combina expressão e acentos; referência antiga não aponta para PDF substituído', () => {
  const index = { sourceHash: 'new', pages: [{ page: 3, text: 'Pontuação final\nSome os pontos de vitória.' }], headings: [{ page: 3, title: 'Pontuação' }] };
  const guide = { sourceHash: 'old', sections: [{ id: 'section', title: 'Pontuação', text: 'Confira os pontos de vitória.', page: 8 }] };
  const results = searchRules(index, guide, 'pontos de vitoria', { currentHash: 'new' });
  assert.equal(results.length, 2);
  assert.equal(results.find((r) => r.sectionId).page, null);
  assert.equal(results.find((r) => !r.sectionId).page, 3);
});
test('publicação só inclui imagens utilizadas e guia respeita limite de texto', () => {
  const guide = cleanGuide({ sections: [{ title: 'Objetivo', text: '<script>texto inerte</script>', reviewed: false, imageId: 'image123' }], assets: { image123: { mimeType: 'image/jpeg' }, private123: { mimeType: 'image/jpeg' } } });
  assert.equal(guide.reviewed, false);
  assert.deepEqual(Object.keys(publishedAssets(guide)), ['image123']);
  assert.throws(() => cleanGuide({ sections: [{ title: 'T', text: 'a'.repeat(20001) }] }));
});
test('referências precisam existir no PDF atual; páginas antigas permanecem no rascunho', () => {
  const game = { manual: { sha256: 'current', pages: 2 } };
  assert.throws(() => checkGuidePages(game, { sourceHash: 'current', sections: [{ page: 3 }] }), /ultrapassa/);
  assert.doesNotThrow(() => checkGuidePages(game, { sourceHash: 'old', sections: [{ page: 3 }] }));
});
test('índice comprimido valida jogo, hash e páginas antes de usar', async () => {
  const index = { schemaVersion: 1, gameId: 'test', sourceHash: 'abc', pageCount: 1, pages: [{ page: 1, text: 'Regras.' }], headings: [] };
  const blob = await packIndex(index);
  assert.deepEqual(await unpackIndex(blob, { id: 'test', manual: { sha256: 'abc' } }), index);
  await assert.rejects(unpackIndex(blob, { id: 'other', manual: { sha256: 'abc' } }));
});
test('BGG possui prazo de espera incluindo autenticação e permite continuar com PDF', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (_url, { signal }) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json([])), 200);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  try {
    await assert.rejects(
      requestBgg('https://api.example.test', async () => 'fixture', {}, { timeoutMs: 10 }),
      /continue com os dados do PDF/,
    );
    await assert.rejects(
      requestBgg('https://api.example.test', () => new Promise((r) => setTimeout(() => r('fixture'), 100)), {}, { timeoutMs: 10 }),
      /demorou/,
    );
  } finally {
    globalThis.fetch = previous;
  }
});
