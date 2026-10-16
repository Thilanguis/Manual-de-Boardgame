import '../scripts/test-guard.mjs';
import { openGameManagement } from './game-ui-fixture.mjs';
import { enableLocalFixture } from './local-fixture.mjs';
// Manuais reais locais; análise/OCR/guia/consulta no navegador. Nenhuma escrita em nuvem.
import { createRequire } from 'node:module';
import { resolve, basename } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
const cases = [
  { title: 'Resident Evil', path: process.env.ACERVO_RESIDENT_PDF, language: 'pt-BR', query: 'cartas' },
  { title: 'O Senhor dos Anéis: Sina da Sociedade', path: process.env.ACERVO_SINA_PDF, language: 'pt-BR', query: 'objetivo', cancel: true },
  { title: 'Resident Evil — original inglês', path: process.env.ACERVO_ENGLISH_PDF, language: 'en', query: 'actions' },
].filter((c) => c.path);
if (!cases.length) throw new Error('Informe os caminhos ACERVO_RESIDENT_PDF, ACERVO_SINA_PDF ou ACERVO_ENGLISH_PDF.');
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  report = [];
try {
  for (const item of cases) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/js/pdf-knowledge.js', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('addOcrPage(index, page);', '(window.ocrReadPages ||= []).push(page.page); console.info("QA OCR página", page.page); addOcrPage(index, page);') });
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (message) => {
      if (message.text().startsWith('QA OCR')) console.log(`${item.title}: ${message.text()}`);
    });
    page.on('dialog', (d) => d.accept());
    await enableLocalFixture(page.context());
    await page.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
    await page.waitForFunction(() => document.getElementById('account-label').textContent === 'Local');
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
    await openGameManagement(page, 'manage-guide');
    await page.locator('#edit-guide').click();
    await page.locator('#guide-analyze').click();
    await page.waitForFunction(() => document.querySelector('#guide-dialog').getAttribute('aria-busy') === 'false' && !document.getElementById('guide-analyze').textContent.startsWith('Analisar'), null, { timeout: 120000 });
    const readIndex = () =>
      page.evaluate(async () => {
        const db = await new Promise((resolve) => {
          const r = indexedDB.open('acervo-rule-index-cache-v1');
          r.onsuccess = () => resolve(r.result);
        });
        const index = await new Promise((resolve) => {
          const r = db.transaction('indexes').objectStore('indexes').getAll();
          r.onsuccess = () => resolve(r.result[0]?.data);
        });
        db.close();
        return index;
      });
    let index = await readIndex(),
      doneBefore = [];
    const initial = { pages: index.pageCount, readable: index.pages.filter((p) => p.text.trim().length >= 40).length };
    console.log(JSON.stringify({ game: item.title, initial }));
    if (await page.locator('#guide-ocr').isVisible()) {
      await page.locator('#guide-ocr').click();
      if (item.cancel) {
        await page.waitForFunction(() => window.ocrReadPages?.length >= 1, null, { timeout: 120000 });
        await page.locator('#guide-cancel-analysis').click();
        await page.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('Análise pausada'));
        index = await readIndex();
        doneBefore = index.pages.filter((p) => p.ocrStatus === 'done').map((p) => p.page);
        await page.locator('#guide-close').click();
        await page.reload();
        await page.locator('.card-main').click();
        await openGameManagement(page, 'manage-guide');
        await page.locator('#edit-guide').click();
        await page.getByRole('button', { name: 'Nova seção', exact: true }).waitFor();
        assert.equal(await page.locator('#guide-analyze').isDisabled(), true);
        await page.locator('#guide-ocr').click();
      }
      await page.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('Páginas lidas'), null, { timeout: 900000 });
      index = await readIndex();
      const after = await page.evaluate(() => window.ocrReadPages || []);
      assert(
        doneBefore.every((p) => !after.includes(p)),
        'páginas concluídas não são reconhecidas novamente',
      );
    }
    assert(index.pages.every((p) => p.text.trim().length >= 40 || ['failed', 'low-confidence', 'done'].includes(p.ocrStatus)));
    if (item.language === 'pt-BR') {
      await page.getByRole('button', { name: 'Adicionar sugestões do PDF ao rascunho' }).click();
      const sections = await page.locator('.guide-editor-section').count();
      assert(sections > 0);
      // Publicar trechos de teste exige a revisão explícita; nenhum texto é reescrito.
      for (const input of await page.locator('.guide-editor-section [name=reviewed]').all()) await input.check();
      await page.getByRole('button', { name: 'Publicar guia' }).click();
      await page.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('Guia publicado'), { timeout: 30000 });
      await page.locator('#guide-close').click();
      await page.locator('.card-main').click();
      await page.locator('#quick-rules').click();
      await page.locator('#guide-search').fill(item.query);
      await page
        .locator('.rule-result')
        .first()
        .waitFor()
        .catch(async (error) => {
          console.log('Consulta falhou:', await page.locator('#guide-content').innerText(), await page.locator('#guide-status').textContent(), index.pages[0].text.slice(0, 1000), index.headings.slice(0, 6), errors);
          throw error;
        });
      assert((await page.locator('.rule-result').count()) > 0);
      await page
        .locator('.rule-result')
        .first()
        .getByRole('button', { name: /Ver no manual/ })
        .click();
      await page.waitForFunction(() => document.getElementById('reader-status').hidden);
      await page.locator('#reader-close').click();
    } else {
      await page.locator('#guide-close').click();
      await page.locator('.card-main').click();
      await page.locator('#quick-rules').click();
      await page.locator('#guide-search').fill(item.query);
      await page.locator('.rule-result').first().waitFor();
      assert.match(await page.locator('.rule-result').first().innerText(), /Tradução pendente/);
      await page.locator('#guide-close').click();
    }
    await page.reload();
    await page.locator('.card-main').click();
    await openGameManagement(page, 'manage-guide');
    await page.locator('#edit-guide').click();
    await page.getByRole('button', { name: 'Nova seção', exact: true }).waitFor();
    assert.equal(await page.locator('#guide-analyze').isDisabled(), true);
    const restored = await readIndex();
    assert.equal(JSON.stringify(restored.pages), JSON.stringify(index.pages));
    assert.deepEqual(errors, []);
    const result = {
      game: item.title,
      initial,
      final: { readable: index.pages.filter((p) => p.text.trim().length >= 40).length, failed: index.pages.filter((p) => ['failed', 'low-confidence'].includes(p.ocrStatus)).length, headings: index.headings.length },
      cancelledAndResumed: doneBefore.length > 0,
    };
    report.push(result);
    console.log(JSON.stringify(result));
    await context.close();
  }
  await writeFile('test-output/knowledge-flows.json', JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
