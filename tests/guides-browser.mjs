// Conteúdo e imagens sintéticos exclusivamente para testes; nenhuma gravação em nuvem.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts, PDFName, PDFString } = require('pdf-lib');
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.setTitle('Ilha de Teste');
for (let i = 1; i <= 20; i++) {
  const p = pdf.addPage([595, 842]);
  p.drawText(i === 1 ? 'Ilha de Teste' : i === 20 ? 'Inventário especial' : `Preparação ${i}`, { x: 50, y: 740, font, size: 26 });
  p.drawText(i === 20 ? 'Guarde as fichas no inventário especial.' : 'Distribua as cartas e coloque as peças no tabuleiro.', { x: 50, y: 680, font, size: 13 });
  p.drawText('2-4 jogadores. Duração: 45 minutos. Idade: 10 anos.', { x: 50, y: 650, font, size: 13 });
}
const outlines = pdf.context.obj({ Type: 'Outlines', Count: 1 }),
  outlinesRef = pdf.context.register(outlines);
const chapterRef = pdf.context.register(pdf.context.obj({ Title: PDFString.of('Inventario especial'), Parent: outlinesRef, Dest: [pdf.getPage(19).ref, PDFName.of('Fit')] }));
outlines.set(PDFName.of('First'), chapterRef);
outlines.set(PDFName.of('Last'), chapterRef);
pdf.catalog.set(PDFName.of('Outlines'), outlinesRef);
const bytes = Buffer.from(await pdf.save()),
  browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('test-output', { recursive: true });
const context = await browser.newContext(),
  page = await context.newPage(),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
try {
  await page.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
  await page.waitForFunction(() => document.getElementById('connection-status').textContent.includes('Neste dispositivo'));
  await page.locator('#empty-action').click();
  await page.locator('#pdf-file').setInputFiles({ name: 'Ilha-de-Teste.pdf', mimeType: 'application/pdf', buffer: bytes });
  await page.locator('#game-form').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#bgg-search').isDisabled(), true);
  assert.equal(await page.locator('#bgg-search').isVisible(), false);
  await page.locator('.manual-reference summary').click();
  assert.equal(await page.locator('#bgg-web-search').isVisible(), true);
  assert.equal(await page.locator('#bgg-web-search').evaluate((e) => getComputedStyle(e).cursor), 'pointer');
  assert.match(await page.locator('#bgg-status').textContent(), /outra aba/);
  await context.route('https://boardgamegeek.com/geeksearch.php?**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Busca externa isolada para teste</p>' }));
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#bgg-web-search').click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  assert.equal(new URL(popup.url()).searchParams.get('q'), 'Ilha de Teste');
  assert.equal(await popup.evaluate(() => window.opener === null), true);
  await popup.close();
  assert.equal(await page.locator('[name=title]').inputValue(), 'Ilha de Teste');
  assert.equal(await page.locator('[name=recommendedAge]').inputValue(), '10');
  await page.locator('[data-step-target="3"]').click();
  await page.locator('[name=confirmed]').check();
  await page.locator('#save-game').click();
  await page.waitForFunction(() => !document.getElementById('upload-dialog').open && document.querySelectorAll('.game-card').length === 1);
  await page.locator('.card-main').click();
  await page.locator('#edit-guide').click();
  await page.getByRole('button', { name: 'Nova seção', exact: true }).waitFor();
  await page.locator('#guide-analyze').click();
  await page.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('PDF completo analisado'));
  const bookmarkFound = await page.evaluate(async () => {
    const database = await new Promise((resolve) => {
      const r = indexedDB.open('acervo-rule-index-cache-v1');
      r.onsuccess = () => resolve(r.result);
    });
    const values = await new Promise((resolve) => {
      const r = database.transaction('indexes').objectStore('indexes').getAll();
      r.onsuccess = () => resolve(r.result);
    });
    database.close();
    return values.some((v) => v.data.headings.some((h) => h.source === 'Bookmark do PDF' && h.page === 20));
  });
  assert.equal(bookmarkFound, true);
  // Cancelar uma nova análise não altera o rascunho ou a publicação.
  await page.locator('#guide-analyze').click();
  await page.locator('#guide-cancel-analysis').click();
  await page.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('Análise cancelada'));
  await page.getByRole('button', { name: 'Adicionar sugestões do PDF ao rascunho' }).click();
  assert.ok((await page.locator('.guide-editor-section').count()) >= 20);
  const first = page.locator('.guide-editor-section').first();
  await first.locator('[name=text]').fill('**Explicação revisada**\nUse *cartas* para aprender.\n<img src=x onerror="window.__pwned=1">');
  await first.locator('[name=type]').selectOption('aviso');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ed334b';
    ctx.fillRect(0, 0, 64, 64);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await first.locator('[name=image]').setInputFiles({ name: 'example.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => document.getElementById('guide-status').textContent.includes('Imagem enviada'));
  for (const checkbox of await page.locator('.guide-editor-section [name=reviewed]').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Publicar guia revisado' }).click();
  await page.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('Guia publicado'));
  await page.locator('#guide-tab-learn').click();
  assert.equal(await page.locator('.guide-section strong').first().textContent(), 'Explicação revisada');
  await page.waitForFunction(() => document.querySelector('.guide-section img')?.naturalWidth > 0);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  await page.locator('#guide-tab-quick').click();
  await page.locator('#guide-search').fill('inventario especial');
  await page.locator('.rule-result').first().waitFor();
  await page.locator('.rule-result').getByRole('button', { name: 'Ver no manual · p. 20', exact: true }).first().click();
  await page.waitForFunction(() => document.getElementById('reader-subtitle').textContent.startsWith('Página 20') && document.getElementById('reader-status').hidden);
  await page.locator('#reader-close').click();
  await page.locator('.card-main').click();
  await page.locator('#edit-guide').click();
  await page.locator('.guide-editor-section').first().locator('[name=text]').fill('Alteração privada ainda não publicada.');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await page.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('Rascunho salvo'));
  await page.locator('#guide-close').click();
  await page.locator('.card-main').click();
  await page.locator('#learn-game').click();
  await page.locator('.guide-section').first().waitFor();
  assert.ok((await page.locator('#guide-content').textContent()).includes('Explicação revisada'));
  assert.equal((await page.locator('#guide-content').textContent()).includes('Alteração privada'), false);
  for (const [name, width, height] of [
    ['mobile', 390, 844],
    ['tablet', 768, 1024],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.locator('#guide-dialog').evaluate((e) => e.scrollWidth <= e.clientWidth + 1), true);
    await page.screenshot({ path: `test-output/guide-${name}.png`, fullPage: false });
  }
  await page.locator('#guide-close').click();
  await page.locator('.card-main').click();
  await page.locator('#edit-game').click();
  const replacement = await PDFDocument.create();
  const replacementFont = await replacement.embedFont(StandardFonts.Helvetica);
  replacement.addPage([595, 842]).drawText('Manual substituído', { x: 50, y: 740, font: replacementFont, size: 24 });
  await page.locator('#replace-pdf-file').setInputFiles({ name: 'novo.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await replacement.save()) });
  await page.waitForFunction(() => document.getElementById('file-info').textContent.includes('1 páginas'));
  await page.locator('[data-step-target="3"]').click();
  await page.locator('[name=confirmed]').check();
  await page.locator('#save-game').click();
  await page.waitForFunction(() => !document.getElementById('upload-dialog').open);
  await page.locator('.card-main').click();
  await page.locator('#learn-game').click();
  await page.locator('.guide-section').first().waitFor();
  assert.equal(await page.locator('#guide-stale').isVisible(), true);
  assert.equal(await page.locator('.guide-section button').first().isDisabled(), true);
  assert.ok((await page.locator('#guide-content').textContent()).includes('Explicação revisada'));
  assert.deepEqual(errors, []);
  console.log('Guia real em teste: PDF de 20 páginas, metadados, sugestões pendentes, imagem, formatação, revisão/publicação, rascunho independente, busca por expressão/acentos, abertura na p.20 e celular/tablet passaram.');
} finally {
  await browser.close();
}
