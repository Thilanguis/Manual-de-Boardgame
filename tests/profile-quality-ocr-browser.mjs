import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractFixturePages } from './profile-pdf-extract-browser.mjs';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const bytes = await readFile(process.env.ACERVO_DESCENT_PDF || 'test-output/research-descent/Descent - Legends of the Dark.pdf');
const pages = await extractFixturePages(browser, bytes, process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186');
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const external = [],
    errors = [];
  await context.route('**/*', (r) => {
    if (['localhost', '127.0.0.1'].includes(new URL(r.request().url()).hostname)) return r.continue();
    external.push(r.request().url());
    return r.abort();
  });
  await context.route('**/js/app.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186');
  const report = await page.evaluate(
    async ({ base64, pages }) => {
      const { extendOcrIndex, pendingOcrPages } = await import('/js/pdf-knowledge.js');
      const { cachedIndex } = await import('/js/index-cache.js');
      const { extractMetadata } = await import('/js/recognition.js');
      const blob = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'application/pdf' });
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join('');
      const broken = 'Introdução do manual ' + '□'.repeat(200) + ' para um a quatro jogadores.';
      const index = {
        gameId: 'quality-ocr',
        sourceHash: hash,
        pageCount: pages.length,
        headings: [],
        pages: pages.map((p) => ({ page: p.page, text: p.page === 2 ? broken : p.text, extracted: true, ...(p.page === 1 ? { ocrStatus: 'low-confidence' } : {}) })),
      };
      const before = JSON.stringify(index.pages.filter((p) => p.page !== 2));
      const planned = pendingOcrPages(index),
        progress = [],
        checkpoints = [];
      const game = { id: index.gameId, language: 'en', manual: { sha256: hash } };
      await extendOcrIndex(blob, game, index, {
        checkpoint: async (next) => {
          checkpoints.push(next.pages[1].ocrStatus);
          await cachedIndex('quality-real-ocr', next);
        },
        onProgress: (p) => progress.push(p),
      });
      const after = JSON.stringify(index.pages.filter((p) => p.page !== 2));
      const restored = await cachedIndex('quality-real-ocr');
      return { planned, untouched: before === after, recovered: restored.pages[1], metadata: extractMetadata(restored.pages[1].text), pending: pendingOcrPages(restored), checkpoints, progress };
    },
    { base64: bytes.toString('base64'), pages },
  );
  assert.deepEqual(report.planned, [2]);
  assert(report.untouched);
  assert.equal(report.recovered.ocrStatus, 'done');
  assert.match(report.recovered.originalText, /□/);
  assert.equal(report.metadata.minPlayers, 1);
  assert.equal(report.metadata.maxPlayers, 4);
  assert.equal(report.recovered.method, 'ocr-local');
  assert.deepEqual(report.pending, []);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await writeFile('test-output/profile-final-audit/ocr-real.json', JSON.stringify({ ...report, external, errors }, null, 2));
  console.log('Tesseract real local: página 2 recuperada do PDF real; outras 31 páginas intactas, 1 checkpoint reutilizável, jogadores 1–4, zero chamadas externas.');
} finally {
  await browser.close();
}
