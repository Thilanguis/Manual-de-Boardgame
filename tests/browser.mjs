// QA de integração em contexto isolado: as fixtures nunca entram na biblioteca do usuário.
// Use ACERVO_TEST_MODULES para apontar ao runtime de testes, ou instale playwright e pdf-lib para desenvolvimento.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(process.env.ACERVO_TEST_MODULES ? resolve(process.env.ACERVO_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const base = process.env.ACERVO_TEST_URL || 'http://localhost:4173';
await mkdir('test-output', { recursive: true });
const document = await PDFDocument.create();
document.setTitle('Ilha de Teste');
const font = await document.embedFont(StandardFonts.Helvetica);
let pagePdf = document.addPage([595, 842]);
pagePdf.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(0.08, 0.2, 0.25) });
const text = (value, y, size = 15) => pagePdf.drawText(value, { x: 55, y, size, font, color: rgb(0.96, 0.95, 0.9) });
text('Ilha de Teste', 735, 37);
text('2-4 jogadores', 665);
text('Duração: 45 minutos', 635);
text('Objetivo do jogo', 575, 20);
text('Explore a ilha e reúna recursos para chegar ao farol.', 540);
text('Preparação', 485, 20);
pagePdf = document.addPage([595, 842]);
pagePdf.drawText('Regras e condições de vitória', { x: 55, y: 740, size: 24, font });
const bytes = await document.save();
await writeFile('test-output/manual-fixture.pdf', bytes);
const browser = await chromium.launch({ executablePath: process.env.ACERVO_CHROME || undefined, channel: process.env.ACERVO_CHROME ? undefined : 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage(),
  errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  const response = await page.goto(`${base}/?local=1`);
  assert.equal(response.status(), 200);
  await page.waitForFunction(() => document.getElementById('connection-status').textContent.includes('Neste dispositivo'));
  assert.equal(await page.locator('.game-card').count(), 0);
  await page.screenshot({ path: 'test-output/desktop-empty.png', fullPage: true });
  await page.locator('#empty-action').click();
  await page.locator('#pdf-file').setInputFiles({ name: 'Ilha-de-Teste-manual.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await page.locator('#game-form').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[name=title]').inputValue(), 'Ilha de Teste');
  assert.equal(await page.locator('[name=minPlayers]').inputValue(), '2');
  assert.equal(await page.locator('[name=maxPlayers]').inputValue(), '4');
  assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '45');
  await page.screenshot({ path: 'test-output/desktop-import.png', fullPage: true });
  await page.locator('[data-step-target="3"]').click();
  await page.locator('[name=confirmed]').check();
  await page.locator('#save-game').click();
  await page.waitForFunction(() => document.querySelectorAll('.game-card').length === 1 && !document.getElementById('upload-dialog').open);
  await page.locator('.card-main').click();
  await page.locator('#read-manual').click();
  await page.waitForFunction(() => document.getElementById('reader-status').hidden && document.getElementById('pdf-canvas').width > 0);
  assert.ok((await page.locator('#pdf-text span').count()) > 0);
  await page.locator('#page-next').click();
  await page.waitForFunction(() => document.getElementById('reader-subtitle').textContent.startsWith('Página 2') && document.getElementById('reader-status').hidden);
  await page.locator('#zoom-in').click();
  await page.waitForFunction(() => document.getElementById('zoom-fit').textContent === '125%' && document.getElementById('reader-status').hidden);
  await page.screenshot({ path: 'test-output/desktop-reader.png', fullPage: true });
  await page.locator('#reader-close').click();
  await page.reload();
  await page.locator('.game-card').waitFor();
  assert.equal(await page.locator('.recent-card').count(), 1);
  await page.locator('.recent-card').click();
  await page.waitForFunction(() => document.getElementById('reader-subtitle').textContent.startsWith('Página 2') && document.getElementById('reader-status').hidden);
  await page.locator('#reader-close').click();
  await page.locator('.card-favorite').click();
  await page.locator('[data-filter=favorites]').click();
  assert.equal(await page.locator('.game-card').count(), 1);
  await page.locator('#search').fill('Não existe');
  assert.equal(await page.locator('.game-card').count(), 0);
  await page.locator('#clear-filters').click();
  await page.locator('.card-main').click();
  await page.locator('#edit-game').click();
  await page.locator('[name=title]').fill('Ilha revisada');
  const replacement = await PDFDocument.create();
  const replacementFont = await replacement.embedFont(StandardFonts.Helvetica);
  replacement.addPage([595, 842]).drawText('Manual substituído: nova edição', { x: 55, y: 740, size: 24, font: replacementFont });
  const replacementBytes = await replacement.save();
  await page.locator('#replace-pdf-file').setInputFiles({ name: 'nova-edicao.pdf', mimeType: 'application/pdf', buffer: Buffer.from(replacementBytes) });
  await page.waitForFunction(() => document.getElementById('review-notice-text').textContent.includes('novo PDF está preparado'));
  assert.equal(await page.locator('[name=title]').inputValue(), 'Ilha revisada');
  await page.locator('[data-step-target="3"]').click();
  await page.locator('[name=confirmed]').check();
  await page.locator('#save-game').click();
  await page.waitForFunction(() => document.querySelector('.card-title')?.textContent === 'Ilha revisada' && !document.getElementById('upload-dialog').open);
  await page.locator('.card-main').click();
  await page.locator('#read-manual').click();
  await page.waitForFunction(() => document.getElementById('reader-status').hidden && document.getElementById('pdf-text').textContent.includes('Manual substituído'));
  assert.ok((await page.locator('#reader-subtitle').textContent()).includes('de 1'));
  await page.locator('#reader-close').click();
  await page.waitForFunction(() => document.activeElement.id === 'hero-main');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-output/desktop-library.png', fullPage: true });
  for (const [name, width, height] of [
    ['mobile', 390, 844],
    ['tablet', 768, 1024],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: `test-output/${name}-library.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${name}: sem overflow horizontal`);
    await page.locator('.card-main').click();
    await page.screenshot({ path: `test-output/${name}-details.png`, fullPage: true });
    await page.locator('#read-manual').click();
    await page.waitForFunction(() => document.getElementById('reader-status').hidden && document.getElementById('pdf-canvas').width > 0);
    await page.screenshot({ path: `test-output/${name}-reader.png`, fullPage: true });
    await page.locator('#reader-close').click();
  }
  await page.locator('.card-main').click();
  await page.locator('#delete-game').click();
  await page.locator('#confirm-delete').click();
  await page.waitForFunction(() => document.querySelectorAll('.game-card').length === 0 && !document.getElementById('delete-dialog').open);
  assert.equal(
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('acervo-library-v1');
        r.onsuccess = () => resolve(r.result);
        r.onerror = reject;
      });
      return await new Promise((resolve) => {
        const r = db.transaction(['files'], 'readonly').objectStore('files').count();
        r.onsuccess = () => resolve(r.result);
      });
    }),
    0,
  );
  // Confere recusa de arquivo inválido sem deixar registros parciais.
  await page.locator('#empty-action').click();
  await page.locator('#pdf-file').setInputFiles({ name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
  await page.waitForFunction(() => document.getElementById('upload-status').textContent.includes('não parece ser um PDF'));
  await page.locator('[data-close=upload-dialog]').first().click();
  // Shell e biblioteca local devem abrir offline após ativação do worker.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('connection-status').textContent.includes('Neste dispositivo'));
  const keys = await page.evaluate(async () => caches.keys());
  assert.ok(keys.some((key) => key.startsWith('acervo-')));
  assert.deepEqual(errors, []);
  console.log('QA de navegador: importação real, evidência, salvar, persistência, PDF/texto/páginas/zoom, favoritos, busca, edição, exclusão de blobs, celular/tablet e shell offline passaram.');
} finally {
  await browser.close();
}
