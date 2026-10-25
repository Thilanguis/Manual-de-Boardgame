import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument } = require('pdf-lib');
const real = await readFile(process.env.ACERVO_RESIDENT_PDF || 'PDFs/resident_evil pt-BR.pdf');
const extra = await PDFDocument.create();
extra.addPage();
extra.addPage();
const extraBytes = Buffer.from(await extra.save());
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const requests = [],
    errors = [];
  await context.route('**/*', (r) => (['127.0.0.1', 'localhost'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort()));
  await context.route('**/js/app.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.route('**/__pdf_fixture/*', async (r) => {
    requests.push({ path: new URL(r.request().url()).pathname, range: r.request().headers().range || null });
    if (r.request().url().endsWith('/slow')) await new Promise((resolve) => setTimeout(resolve, 600));
    await r.fulfill({ contentType: 'application/pdf', body: r.request().url().endsWith('/extra') ? extraBytes : real }).catch(() => {});
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186');
  await page.evaluate(async () => {
    document.body.classList.add('access-approved');
    document.querySelector('#session-loading').hidden = true;
    const { createReader } = await import('/js/reader.js');
    const manual = { sha256: 'a'.repeat(64), pages: 22, name: 'Resident Evil.pdf' };
    globalThis.testGame = {
      id: 'reader-fixture',
      title: 'Resident Evil',
      manual,
      primaryDocumentId: 'main',
      documents: { main: { id: 'main', name: 'Resident Evil', manual }, extra: { id: 'extra', name: 'Complemento', manual: { ...manual, pages: 2, name: 'Complemento.pdf', sha256: 'b'.repeat(64) } } },
    };
    globalThis.testController = new AbortController();
    globalThis.testErrors = [];
    const repository = {
      session: { canRead: true },
      getManualSource: async (g) => ({ url: `/__pdf_fixture/${globalThis.slowDownload ? 'slow' : g.documentId}`, headers: { Authorization: 'Bearer fixture' }, signal: globalThis.testController.signal }),
    };
    globalThis.testReader = createReader({ repository, getProgress: () => null, saveProgress: () => {}, onError: (e) => globalThis.testErrors.push(e.message) });
  });
  const ready = () =>
    page
      .waitForFunction(() => !document.querySelector('#reader').hidden && document.querySelector('#reader-status').hidden && document.querySelector(`[data-page-number="${document.getElementById('page-number').value}"] [data-rendered]`))
      .catch(async (error) => {
        console.log(
          await page.evaluate(() => ({
            errors: testErrors,
            status: document.getElementById('reader-status').textContent,
            page: document.getElementById('page-number').value,
            labels: [...document.querySelectorAll('.reader-page-label')].map((node) => node.textContent),
          })),
        );
        throw error;
      });
  const assertFits = async () => {
    const size = await page.evaluate(() => {
      const stage = document.querySelector('#reader-stage'),
        page = document.querySelector(`[data-page-number="${document.getElementById('page-number').value}"] .pdf-page`),
        padding = getComputedStyle(stage);
      return {
        width: page.offsetWidth,
        height: page.offsetHeight,
        availableWidth: stage.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight),
        availableHeight: stage.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom),
      };
    });
    assert(size.width <= size.availableWidth + 1, 'página ajustada à largura na leitura contínua');
    assert.equal(await page.locator('#zoom-fit').getAttribute('aria-pressed'), 'true');
  };
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const before = requests.length;
    await page.evaluate(() => testReader.open(testGame));
    await ready();
    await assertFits();
    for (const number of [11, 22]) {
      await page.locator('#page-number').fill(String(number));
      await page.locator('#page-number').dispatchEvent('change');
      await ready();
      await assertFits();
    }
    await page.locator('#zoom-in').click();
    await ready();
    await page.locator('#reader-stage').evaluate((n) => {
      n.scrollTop = 300;
      n.scrollLeft = 50;
    });
    await page.locator('#zoom-out').click();
    await ready();
    await page.locator('#zoom-fit').click();
    await ready();
    await assertFits();
    await page.setViewportSize({ width, height: 700 });
    await page.waitForTimeout(350);
    await ready();
    await assertFits();
    assert.equal(requests.length - before, 1, 'páginas, zoom e rolagem usam a transferência já recebida');
    await page.locator('#reader-document').selectOption('extra');
    await ready();
    assert.equal(await page.locator('#page-total').textContent(), '/ 2');
    assert.equal(requests.length - before, 2, 'complemento usa uma transferência independente');
    await page.locator('#reader-close').click();
    assert.equal(await page.locator('#reader-pages canvas').count(), 0);
  }
  const slowRequest = page.waitForRequest('**/__pdf_fixture/slow');
  await page.evaluate(() => {
    globalThis.slowDownload = true;
    void testReader.open(testGame);
  });
  await slowRequest;
  await page.evaluate(async () => {
    testController.abort();
    await testReader.close();
  });
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#reader').evaluate((n) => n.hidden), true);
  assert.equal(await page.locator('#reader-pages canvas').count(), 0);
  assert(requests.every((r) => r.range === null));
  assert.deepEqual(await page.evaluate(() => testErrors), []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ realPdfBytes: real.length, pages: [1, 11, 22], viewports: [1440, 768, 390], oneMediaGetPerOpen: true, zoom: true, scroll: true, separateDocuments: true, abortedDownloadDoesNotReopen: true, rangeRequests: 0 }));
} finally {
  await browser.close();
}
