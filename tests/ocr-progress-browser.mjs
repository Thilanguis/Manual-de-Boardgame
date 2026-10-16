import '../scripts/test-guard.mjs';
import { openGameManagement } from './game-ui-fixture.mjs';
import { enableLocalFixture } from './local-fixture.mjs';
// Tesseract real com PDF sintético em imagens; nenhum serviço remoto recebe o documento.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument } = require('pdf-lib');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' }),
    page = await context.newPage();
  const errors = [];
  await context.route('**/js/pdf-knowledge.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('addOcrPage(index, page);', '(window.ocrReadPages ||= []).push(page.page); addOcrPage(index, page);') });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await enableLocalFixture(page.context());
  await page.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
  await page.waitForFunction(() => document.getElementById('account-label').textContent === 'Local');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1400;
    const drawing = canvas.getContext('2d');
    drawing.fillStyle = '#fff';
    drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.fillStyle = '#000';
    drawing.font = 'bold 42px Arial';
    drawing.fillText('PREPARACAO', 70, 100);
    drawing.font = '32px Arial';
    ['Coloque o tabuleiro no centro da mesa.', 'Separe as cartas e distribua as pecas.', 'Cada jogador recebe quatro cartas.', 'Este manual e uma imagem de teste.'].forEach((line, i) => drawing.fillText(line, 70, 180 + i * 60));
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const pdf = await PDFDocument.create();
  pdf.setTitle('Ilha do OCR');
  const image = await pdf.embedPng(Buffer.from(png, 'base64'));
  for (let i = 0; i < 4; i++) pdf.addPage([595, 842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  await page.locator('#empty-action').click();
  await page.locator('#pdf-file').setInputFiles({ name: 'Ilha do OCR.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await page.locator('#game-title').fill('Ilha do OCR');
  await page.locator('[data-step-target="2"]').click();
  await page.locator('[name=language]').selectOption('pt-BR');
  // Reaproveitar inclusive uma página lida no reconhecimento do cadastro.
  await page.locator('[data-step-target="1"]').click();
  await page.locator('.research-options').evaluate((element) => (element.open = true));
  await page.locator('[data-research-ocr]').click();
  await page.waitForFunction(() => /página [23] como imagem/.test(document.querySelector('[data-research-ocr-status]').textContent), null, { timeout: 90000 });
  await page.locator('[data-step-target="3"]').click();
  await page.locator('[name=confirmed]').check();
  await page.locator('#save-game').click();
  await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
  await page.locator('.card-main').click();
  await openGameManagement(page, 'manage-guide');
  await page.locator('#edit-guide').click();
  await page.locator('#guide-analyze').click();
  await page.waitForFunction(() => document.getElementById('guide-status').textContent.includes('páginas escaneadas'));
  const seeded = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open('acervo-rule-index-cache-v1');
      r.onsuccess = () => resolve(r.result);
    });
    const data = await new Promise((resolve) => {
      const r = db.transaction('indexes').objectStore('indexes').getAll();
      r.onsuccess = () => resolve(r.result[0].data);
    });
    db.close();
    return data;
  });
  assert.equal(seeded.pages[0].ocrStatus, 'done', 'OCR do cadastro deve entrar no índice sem repetir a página');
  await page.locator('#guide-ocr').click();
  await page.waitForFunction(() => window.ocrReadPages?.length >= 1);
  await page.locator('#guide-cancel-analysis').click();
  await page.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('Análise pausada'));
  const readIndex = () =>
    page.evaluate(async () => {
      const db = await new Promise((resolve) => {
        const request = indexedDB.open('acervo-rule-index-cache-v1');
        request.onsuccess = () => resolve(request.result);
      });
      return new Promise((resolve) => {
        const request = db.transaction('indexes').objectStore('indexes').getAll();
        request.onsuccess = () => resolve(request.result[0].data);
      });
    });
  let index = await readIndex();
  const done = index.pages.filter((page) => page.ocrStatus === 'done').map((p) => p.page);
  assert(done.length >= 2 && done.length < 4);
  assert.match(index.pages[0].text.toLowerCase(), /tabuleiro/);
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('guide-status').textContent.includes('salvo'));
  await page.locator('#guide-close').click();
  await page.reload();
  await page.locator('.card-main').click();
  await openGameManagement(page, 'manage-guide');
  await page.locator('#edit-guide').click();
  await page.locator('#guide-ocr').click();
  await page.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('Páginas lidas'), { timeout: 120000 });
  index = await readIndex();
  assert(index.pages.every((page) => page.ocrStatus === 'done'));
  assert.deepEqual(
    await page.evaluate(() => window.ocrReadPages),
    [1, 2, 3, 4].filter((page) => !done.includes(page)),
    'um clique retoma apenas as páginas faltantes e termina todos os lotes',
  );
  assert.equal(index.headings.filter((heading) => heading.category === 'Preparação').length, 4);
  await page.getByRole('button', { name: 'Adicionar sugestões do PDF ao rascunho' }).click();
  assert.equal(await page.locator('.guide-editor-section').count(), 4);
  for (const input of await page.locator('.guide-editor-section [name=reviewed]').all()) await input.check();
  await page.getByRole('button', { name: 'Publicar guia' }).click();
  await page.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('Guia publicado'));
  assert.deepEqual(errors, []);
  console.log('OCR real: cancelamento após checkpoint, recarga, retomada sem repetir páginas, conclusão automática, sugestões e publicação revisada passaram.');
} finally {
  await browser.close();
}
