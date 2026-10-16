import '../scripts/test-guard.mjs';
import { openGameManagement } from './game-ui-fixture.mjs';
import { createRequire } from 'node:module';
import { resolve, basename } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json')),
  { chromium } = require('playwright');
const cases = [
  { title: 'Resident Evil', path: process.env.ACERVO_RESIDENT_PDF, language: 'pt-BR', query: 'cartas' },
  { title: 'O Senhor dos Anéis: Sina da Sociedade', path: process.env.ACERVO_SINA_PDF, language: 'pt-BR', query: 'jogo', cancel: true },
  { title: 'Resident Evil — original inglês', path: process.env.ACERVO_ENGLISH_PDF, language: 'en', query: 'actions' },
].filter((c) => c.path);
if (!cases.length) throw new Error('Informe os PDFs reais por variáveis ACERVO_*_PDF.');
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  report = [];
try {
  for (const item of cases) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/config/app-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export const APP_CONFIG={allowLocalDevelopment:true,firebase:null,fileStorage:{},maxPdfBytes:209715200};' }));
    await context.route('**/js/pdf-knowledge.js', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('addOcrPage(index, page);', '(window.ocrReadPages ||= []).push(page.page); console.info("QA OCR",page.page); addOcrPage(index, page);') });
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    page.on('console', (m) => {
      if (m.text().startsWith('QA OCR')) console.log(`${item.title}: ${m.text()}`);
    });
    await page.addInitScript(() => Object.defineProperty(globalThis, 'Translator', { configurable: true, value: undefined }));
    await page.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
    await page.locator('#empty-action').click();
    await page.locator('#pdf-file').setInputFiles({ name: basename(item.path), mimeType: 'application/pdf', buffer: await readFile(item.path) });
    await page.locator('#game-title').fill(item.title);
    await page.locator('[data-step-target="2"]').click();
    await page.locator('[name=language]').selectOption(item.language);
    await page.locator('[data-step-target="3"]').click();
    await page.locator('[name=confirmed]').check();
    await page.locator('#save-game').click();
    await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
    await page.locator('.card-main').click();
    const cache = () =>
      page.evaluate(
        async () =>
          new Promise((resolve) => {
            const r = indexedDB.open('acervo-rule-index-cache-v1');
            r.onsuccess = () => {
              const q = r.result.transaction('indexes').objectStore('indexes').getAll();
              q.onsuccess = () => resolve(q.result.map((r) => r.data).find((data) => data?.pages));
            };
          }),
      );
    let doneBefore = [];
    if (item.cancel) {
      await page.waitForFunction(() => window.ocrReadPages?.length >= 2, null, { timeout: 180000 });
      await openGameManagement(page, 'manage-documents-section');
      await page.locator('.document-row details > summary').click();
      await page.locator('.document-row').getByRole('button', { name: 'Pausar', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('manage-documents').textContent.includes('Pausado'), null, { timeout: 30000 });
      const before = await cache();
      doneBefore = before.pages.filter((p) => p.ocrStatus === 'done').map((p) => p.page);
      assert(doneBefore.length > 0 && doneBefore.length < before.pageCount);
      await page.reload();
      await page.locator('.card-main').click();
      await openGameManagement(page, 'manage-documents-section');
      await page.locator('.document-row details > summary').click();
      await page.locator('.document-row').getByRole('button', { name: 'Retomar', exact: true }).click();
    }
    await page.waitForFunction(
      () => {
        const text = document.getElementById('manage-documents').textContent;
        return text.includes('Pronto') || text.includes('Parcial') || text.includes('Precisa de atenção');
      },
      null,
      { timeout: 900000 },
    );
    let index = await cache();
    assert(index?.analysisComplete !== false);
    assert(index.pages.every((p) => p.text.trim().length >= 40 || ['done', 'failed', 'low-confidence'].includes(p.ocrStatus)));
    const repeated = await page.evaluate(() => window.ocrReadPages || []);
    assert(
      doneBefore.every((p) => !repeated.includes(p)),
      'Retomada não repete páginas concluídas.',
    );
    await page.locator('#quick-rules').click();
    await page.locator('#guide-search').fill(item.query);
    await page.locator('.rule-result').first().waitFor();
    if (item.language === 'en') assert.match(await page.locator('.rule-result').first().textContent(), /Tradução pendente/);
    else {
      await page.locator('.rule-result button').first().click();
      await page.waitForFunction(() => document.getElementById('reader-status').hidden);
      await page.locator('#reader-close').click();
      await page.locator('.card-main').click();
      await openGameManagement(page, 'manage-guide');
      await page.locator('#edit-guide').click();
      await page.getByRole('button', { name: 'Adicionar sugestões do PDF ao rascunho', exact: true }).click();
      assert((await page.locator('.guide-editor-section').count()) > 0);
      for (const checkbox of await page.locator('.guide-editor-section [name=reviewed]').all()) await checkbox.check();
      await page.getByRole('button', { name: 'Publicar guia', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('Guia publicado'));
      await page.locator('#guide-close').click();
    }
    await page.reload();
    await page.locator('.card-main').click();
    await page.locator('#quick-rules').click();
    await page.locator('#guide-search').fill(item.query);
    await page.locator('.rule-result').first().waitFor();
    assert.deepEqual((await cache()).pages, index.pages);
    assert.deepEqual(await page.evaluate(() => window.ocrReadPages || []), [], 'Uma análise completa não recomeça ao recarregar.');
    assert.deepEqual(errors, []);
    const result = {
      game: item.title,
      pages: index.pageCount,
      readable: index.pages.filter((p) => p.text.trim().length >= 40).length,
      failed: index.pages.filter((p) => ['failed', 'low-confidence'].includes(p.ocrStatus)).length,
      headings: index.headings.length,
      cancelledAndResumed: doneBefore.length > 0,
      cacheReused: true,
      queryResults: await page.locator('.rule-result').count(),
    };
    report.push(result);
    console.log(JSON.stringify(result));
    await context.close();
  }
  await writeFile('test-output/automatic-real-report.json', JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
