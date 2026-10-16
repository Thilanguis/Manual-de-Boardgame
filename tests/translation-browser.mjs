import '../scripts/test-guard.mjs';
import { openGameManagement } from './game-ui-fixture.mjs';
import { enableLocalFixture } from './local-fixture.mjs';
// Motor de tradução simulado; aplicativo, PDFs, índice, edição e persistência reais.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts } = require('pdf-lib');
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.setTitle('Survivor Test');
for (let i = 1; i <= 4; i++) {
  const page = pdf.addPage();
  page.drawText('TURN', { x: 30, y: 740, font, size: 28 });
  page.drawText('Move the survivor to the hallway. Each turn allows two actions.', { x: 30, y: 680, font, size: 13 });
}
const bytes = Buffer.from(await pdf.save()),
  browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const native = await browser.newContext({ serviceWorkers: 'block' }),
    probe = await native.newPage();
  await enableLocalFixture(probe.context());
  await probe.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
  console.log(
    'Disponibilidade real do tradutor local:',
    await probe.evaluate(async () => ({ exposed: !!globalThis.Translator, state: globalThis.Translator ? await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'pt-BR' }).catch((e) => e.name) : 'unavailable' })),
  );
  await native.close();
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 1000 } });
    await context.addInitScript(() => {
      window.translationCalls = 0;
      Object.defineProperty(window, 'Translator', {
        configurable: true,
        value: {
          availability: async () => 'downloadable',
          create: async () => ({
            targetLanguage: 'pt',
            destroy() {},
            translate: async (text) => {
              window.translationCalls++;
              return text === 'TURN' ? 'Turno' : 'Mova o sobrevivente para o corredor. Cada turno permite duas ações.';
            },
          }),
        },
      });
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await enableLocalFixture(page.context());
    await page.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
    await page.waitForFunction(() => document.getElementById('account-label').textContent === 'Local');
    await page.locator('#empty-action').click();
    await page.locator('#pdf-file').setInputFiles({ name: 'Survivor Test.pdf', mimeType: 'application/pdf', buffer: bytes });
    await page.locator('#game-title').fill('Survivor Test');
    await page.locator('[data-step-target="2"]').click();
    await page.locator('[name=language]').selectOption('en');
    await page.locator('[data-step-target="3"]').click();
    await page.locator('[name=confirmed]').check();
    await page.locator('#save-game').click();
    await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
    await page.locator('.card-main').click();
    await openGameManagement(page, 'manage-guide');
    await page.locator('#edit-guide').click();
    await page.locator('#guide-analyze').click();
    await page.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('PDF analisado'));
    await page.getByRole('button', { name: 'Adicionar sugestões do PDF ao rascunho' }).click();
    assert.equal(await page.locator('.guide-editor-section').count(), 4);
    const first = page.locator('.guide-editor-section').first();
    assert.equal(await first.locator('[name=text]').inputValue(), '');
    await first.locator('[name=text]').fill('Explicação manual em português que deve ser preservada.');
    await page.locator('#guide-translate').click();
    await page.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('Tradução concluída'));
    assert.equal(await first.locator('[name=text]').inputValue(), 'Explicação manual em português que deve ser preservada.');
    assert.match(await page.locator('.guide-editor-section').nth(1).locator('[name=text]').inputValue(), /Mova o sobrevivente/);
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('Rascunho salvo'));
    await page.locator('#guide-close').click();
    // Remove apenas o cache descartável para provar a recuperação pelo índice do rascunho.
    await page.evaluate(async () => {
      const db = await new Promise((resolve) => {
        const r = indexedDB.open('acervo-rule-index-cache-v1');
        r.onsuccess = () => resolve(r.result);
      });
      await new Promise((resolve) => {
        const tx = db.transaction('indexes', 'readwrite');
        tx.objectStore('indexes').clear();
        tx.oncomplete = resolve;
      });
      db.close();
    });
    await page.reload();
    await page.locator('.card-main').click();
    await openGameManagement(page, 'manage-guide');
    await page.locator('#edit-guide').click();
    await page.locator('.guide-editor-section').first().waitFor();
    assert.equal(await page.locator('#guide-analyze').isDisabled(), true, 'índice do rascunho foi recuperado sem analisar de novo');
    assert.equal(await page.evaluate(() => window.translationCalls), 0, 'traduções salvas foram reutilizadas após recarga');
    for (const input of await page.locator('.guide-editor-section [name=reviewed]').all()) await input.check();
    await page.getByRole('button', { name: 'Publicar guia' }).click();
    await page.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('Guia publicado'));
    await page.locator('#guide-close').click();
    await page.locator('.card-main').click();
    await page.locator('#quick-rules').click();
    await page.locator('#guide-search').fill('sobrevivente corredor');
    await page.locator('.rule-result').first().waitFor();
    assert.match(await page.locator('.rule-result').first().innerText(), /Mova o sobrevivente/);
    await page
      .locator('.rule-result')
      .first()
      .getByRole('button', { name: /Ver no manual/ })
      .click();
    await page.waitForFunction(() => document.getElementById('reader-status').hidden && document.getElementById('reader-subtitle').textContent.startsWith('Página'));
    await page.locator('#reader-close').click();
    await page.locator('.card-main').click();
    await page.locator('#learn-game').click();
    await page.locator('.guide-section').first().waitFor();
    assert.match(await page.locator('#guide-content').innerText(), /Explicação manual em português/);
    assert.equal(await page.locator('#guide-dialog').evaluate((e) => e.scrollWidth <= e.clientWidth + 1), true);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Tradução simulada: EN → português, original preservado, edição manual intacta, índice do rascunho após recarga, publicação, consulta PT e abertura de página passaram em desktop/celular.');
} finally {
  await browser.close();
}
