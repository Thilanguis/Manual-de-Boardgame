import '../scripts/test-guard.mjs';
import { enableLocalFixture } from './local-fixture.mjs';
// PDFs reais locais: análise/OCR no navegador. O documento não é enviado a APIs externas.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
if (!process.env.ACERVO_REAL_PDF) throw new Error('Informe ACERVO_REAL_PDF.');
const bytes = await readFile(process.env.ACERVO_REAL_PDF),
  browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' }),
    page = await context.newPage();
  await context.route('**/qa-manual.pdf', (route) => route.fulfill({ contentType: 'application/pdf', body: bytes }));
  await enableLocalFixture(page.context());
  await page.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
  const result = await page.evaluate(async () => {
    const { analyzePdf } = await import('./js/pdf-index.js');
    const blob = await (await fetch('./qa-manual.pdf')).blob();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join('');
    window.realManual = blob;
    window.realGame = { id: 'qa-real-manual', language: 'pt-BR', manual: { sha256: hash } };
    window.realIndex = await analyzePdf(blob, window.realGame);
    return { pages: window.realIndex.pageCount, readable: window.realIndex.pages.filter((p) => p.text.trim().length >= 40).length, headings: window.realIndex.headings.length };
  });
  console.log(JSON.stringify({ initial: result }));
  for (let batch = 0; batch < (process.env.ACERVO_OCR_ALL === '1' ? 100 : 0); batch++) {
    const progress = await page.evaluate(async () => {
      const { extendOcrIndex, pendingOcrPages, ocrCoverage } = await import('./js/pdf-knowledge.js');
      const { cachedIndex } = await import('./js/index-cache.js');
      if (!pendingOcrPages(window.realIndex).length) return null;
      await extendOcrIndex(window.realManual, window.realGame, window.realIndex, { checkpoint: (index) => cachedIndex('qa-real-manual', index) });
      return ocrCoverage(window.realIndex);
    });
    if (!progress) break;
    console.log(JSON.stringify({ batch: batch + 1, ...progress }));
  }
  const final = await page.evaluate(async () => {
    const { ocrCoverage } = await import('./js/pdf-knowledge.js');
    const { suggestedSections, packIndex, unpackIndex } = await import('./js/pdf-index.js');
    const packed = await packIndex(window.realIndex);
    const index = await unpackIndex(packed, window.realGame);
    const sections = suggestedSections(index);
    return { ...ocrCoverage(index), headings: index.headings.length, sections: sections.map(({ title, page }) => ({ title, page })), compressedBytes: packed.size, pageNumbers: index.pages.map((p) => p.page) };
  });
  assert.equal(final.total, result.pages);
  assert.deepEqual(
    final.pageNumbers,
    Array.from({ length: result.pages }, (_, i) => i + 1),
  );
  assert(final.sections.every((section) => section.page >= 1 && section.page <= result.pages));
  if (process.env.ACERVO_OCR_ALL === '1') assert.equal(final.pending, 0);
  assert(final.readable > 0);
  console.log(JSON.stringify({ final }));
  await mkdir('test-output', { recursive: true });
  await writeFile(`test-output/knowledge-real-${process.env.ACERVO_REPORT_NAME || 'pdf'}.json`, JSON.stringify({ initial: result, final }, null, 2));
} finally {
  await browser.close();
}
