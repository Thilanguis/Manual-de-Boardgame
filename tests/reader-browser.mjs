import '../scripts/test-guard.mjs';
import { browserDependencies as require } from './browser-dependencies.mjs';
import assert from 'node:assert/strict';
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts } = require('pdf-lib');
const fixture = await PDFDocument.create(),
  font = await fixture.embedFont(StandardFonts.Helvetica);
for (let number = 1; number <= 12; number++) {
  const page = fixture.addPage(number === 6 ? [800, 500] : [500, 700]);
  page.drawText(`Manual demonstrativo - pagina ${number}`, { x: 30, y: page.getHeight() - 50, font, size: 18 });
  page.drawText('Cartas, fichas e dados para sua partida.', { x: 30, y: page.getHeight() - 90, font, size: 14 });
  if ([4, 9].includes(number)) page.drawText('Ação especial: descarte uma carta.', { x: 30, y: 60, font, size: 16 });
}
const bytes = [...(await fixture.save())],
  blank = await PDFDocument.create();
blank.addPage();
const blankBytes = [...(await blank.save())];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [768, 1024],
    [390, 844],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' }),
      page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
    await context.route('**/*', (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
    await context.route('**/js/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.goto(base);
    await page.evaluate(
      async ({ bytes, blankBytes }) => {
        document.getElementById('session-loading').hidden = true;
        document.body.classList.add('access-approved');
        const { createReader } = await import('./js/reader.js');
        window.readerErrors = [];
        window.progress = {};
        const main = { id: 'main', name: 'Regras', manual: { pages: 12, sha256: 'main' } },
          extra = { id: 'extra', name: 'Personagens', manual: { pages: 1, sha256: 'extra' } };
        window.fixtureGame = { id: 'fixture', title: 'Jogo de demonstração', manual: main.manual, documents: { extra, main }, primaryDocumentId: 'main' };
        window.fixtureRepository = { session: { canRead: true }, getManual: async (view) => new Blob([Uint8Array.from(view.documentId === 'extra' ? blankBytes : bytes)]) };
        window.testReader = createReader({
          repository: fixtureRepository,
          getProgress: (key) => progress[key],
          saveProgress: (key, value) => {
            progress[key] = value;
          },
          onError: (error) => readerErrors.push(error.message),
        });
        await testReader.open(fixtureGame);
      },
      { bytes, blankBytes },
    );
    await page.waitForSelector('#pdf-page[data-rendered]');
    assert.equal(await page.locator('.reader-page-shell').count(), 12);
    assert.equal(await page.locator('#reader-document option').first().getAttribute('value'), 'main');
    const header = await page.locator('.reader-header').boundingBox();
    assert(header.width <= width + 1);
    assert(await page.locator('#reader').evaluate((node) => node.scrollWidth <= innerWidth + 1), 'Leitor cabe na tela');
    await page.locator('#reader-stage').evaluate((node) => {
      node.scrollTop = node.querySelector('[data-page-number="3"]').offsetTop + 30;
    });
    await page.waitForFunction(() => document.getElementById('page-number').value === '3');
    await page.locator('#page-next').click();
    await page.waitForFunction(() => document.getElementById('page-number').value === '4');
    await page.locator('#page-number').fill('8');
    await page.locator('#page-number').press('Tab');
    await page.waitForSelector('[data-page-number="8"] [data-rendered]');
    assert.equal(await page.locator('#pdf-canvas').evaluate((node) => node.width), 0, 'Canvas distante é liberado');
    assert((await page.locator('#reader-pages canvas').evaluateAll((nodes) => nodes.filter((node) => node.width > 0).length)) <= 5, 'Não renderiza o PDF inteiro');
    await page.locator('#reader-search-toggle').click();
    await page.locator('#reader-search-input').fill('ACAO');
    await page.waitForFunction(() => document.getElementById('reader-search-status').textContent === '2 de 2');
    await page.waitForSelector('[data-page-number="9"] [data-rendered]');
    await page.waitForFunction(() => CSS.highlights.get('pdf-search-current')?.size > 0);
    await page.locator('#reader-search-prev').click();
    await page.waitForFunction(() => document.getElementById('page-number').value === '4');
    assert.equal(await page.locator('#reader-search-status').textContent(), '1 de 2');
    await page.locator('#reader-search-input').press('Enter');
    await page.waitForFunction(() => document.getElementById('page-number').value === '9');
    await page.locator('#zoom-in').click();
    await page.waitForSelector('[data-page-number="9"] [data-rendered]');
    await page.locator('#zoom-fit').click();
    await page.waitForFunction(() => document.getElementById('zoom-fit').textContent === '100%');
    await page.screenshot({ path: `test-output/reader-${width}.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#reader-search').isVisible(), false);
    assert.equal(await page.locator('#reader').isVisible(), true);
    await page.locator('#reader-document').selectOption('extra');
    await page.waitForFunction(() => document.querySelectorAll('.reader-page-shell').length === 1);
    await page.waitForSelector('#pdf-page[data-rendered]');
    await page.locator('#reader-search-toggle').click();
    await page.locator('#reader-search-input').fill('cartas');
    await page.waitForFunction(() => document.getElementById('reader-search-status').textContent.includes('sem texto pesquisável'));
    await page.locator('#reader-close').click();
    assert.equal(await page.locator('.reader-page-shell').count(), 0);
    assert.equal(await page.evaluate(() => CSS.highlights.has('pdf-search')), false);
    await page.evaluate(async () => {
      await testReader.open(fixtureGame, { page: 6 });
    });
    await page.waitForSelector('[data-page-number="6"] [data-rendered]');
    await page.locator('#zoom-in').click({ clickCount: 3, delay: 20 });
    await page.locator('#zoom-fit').click();
    await page.waitForSelector('[data-page-number="6"] [data-rendered]');
    await page.evaluate(async () => {
      await testReader.close();
      fixtureRepository.session.canRead = false;
      await testReader.open(fixtureGame);
    });
    assert.equal(await page.locator('#reader').isVisible(), false);
    assert.deepEqual(await page.evaluate(() => readerErrors), ['Entre com uma conta aprovada.']);
    assert.deepEqual(errors, []);
    if (width === 1440) {
      await page.evaluate(async () => {
        const { createDocumentPanel } = await import('./js/document-panel.js');
        const { createDocumentRepository } = await import('./js/document-repository.js');
        window.panelGame = structuredClone(fixtureGame);
        window.panelRepo = {
          session: { canRead: true, canEdit: false, isOwner: true },
          getManual() {},
          async saveGame(next) {
            panelGame = next;
            return { game: next };
          },
        };
        Object.assign(panelRepo, createDocumentRepository(panelRepo));
        window.orderPanel = createDocumentPanel({
          root: document.getElementById('manage-documents'),
          readRoot: document.getElementById('detail-documents'),
          repository: panelRepo,
          queue: { entries: () => [] },
          onNotice: () => {},
          onSaved: () => {},
          openManual: () => {},
        });
        orderPanel.open(panelGame);
        document.getElementById('detail-dialog').showModal();
      });
      await page.getByRole('button', { name: 'Mover Regras para baixo', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#detail-documents [data-read-document-id]')?.dataset.readDocumentId === 'extra');
      assert.deepEqual(await page.evaluate(() => panelGame.documentOrder), ['extra', 'main']);
      await page.evaluate(() => {
        panelRepo.session.isOwner = false;
        orderPanel.open(panelGame);
      });
      assert.equal(await page.locator('.document-order-controls').count(), 0);
      assert.equal(await page.locator('#detail-documents [data-read-document-id]').first().getAttribute('data-read-document-id'), 'extra');
    }
    await context.close();
    console.log(`Leitor ${width}px: rolagem, páginas, memória, busca com acentos, destaque, zoom, troca de PDF, OCR ausente e acesso verificados.`);
  }
} finally {
  await browser.close();
}
