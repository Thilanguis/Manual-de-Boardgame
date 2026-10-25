import '../scripts/test-guard.mjs';
import { browserDependencies as require } from './browser-dependencies.mjs';
import assert from 'node:assert/strict';
const { chromium } = require('playwright'),
  { PDFDocument } = require('pdf-lib');
const pdf = await PDFDocument.create();
pdf.addPage();
const bytes = [...(await pdf.save())];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (r) => (new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort()));
  await context.route('**/config/app-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export const APP_CONFIG={allowLocalDevelopment:true,firebase:null,fileStorage:{}};' }));
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/?local=1');
  await page.waitForFunction(() => document.querySelector('#account-label').textContent === 'Local');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async (bytes) => {
    const { createLocalRepository } = await import('./js/local-repository.js');
    const repo = await createLocalRepository();
    for (const [id, w, h] of [
      ['portrait', 600, 900],
      ['square', 800, 800],
      ['landscape', 900, 600],
      ['wide', 1200, 500],
    ]) {
      await repo.saveGame(
        { id, title: id, description: 'Ficha demonstrativa.', tags: [], mechanics: [], language: 'pt-BR', manual: { name: 'fixture.pdf', size: bytes.length, pages: 1, sha256: id }, cover: { sha256: id }, sources: {} },
        {
          manualBlob: new Blob([Uint8Array.from(bytes)], { type: 'application/pdf' }),
          coverBlob: new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#277787"/></svg>`], { type: 'image/svg+xml' }),
        },
      );
    }
    repo.close();
  }, bytes);
  await page.waitForFunction(() => document.querySelectorAll('.game-card').length === 4);
  await page.locator('.card-main').first().click();
  await page.waitForFunction(() => document.querySelector('#detail-dialog').open);
  await page.locator('[data-close=detail-dialog]').click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.card-main')].some((el) => el.getAttribute('aria-busy') === 'true'));
  const ratios = new Set();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (let i = 0; i < 4; i++) {
      await page.waitForFunction(() => !document.querySelector('#hero-box').hidden);
      const fit = await page.evaluate(() => {
        const box = document.querySelector('#hero-box'),
          slot = document.querySelector('#hero-panel-preview'),
          m = new DOMMatrixReadOnly(getComputedStyle(slot).transform);
        return {
          ratio: Number(getComputedStyle(box).getPropertyValue('--cover-ratio')),
          left: slot.offsetLeft + m.m41,
          top: slot.offsetTop + m.m42,
          width: slot.offsetWidth,
          height: slot.offsetHeight,
          boxWidth: box.clientWidth,
          boxHeight: box.clientHeight,
        };
      });
      ratios.add(fit.ratio.toFixed(2));
      assert(fit.left >= 0 && fit.top >= 0 && fit.left + fit.width <= fit.boxWidth + 1 && fit.top + fit.height <= fit.boxHeight + 1, `${width}: ficha fica dentro da caixa (${JSON.stringify(fit)})`);
      assert(fit.top + fit.height <= fit.boxHeight * 0.87 + 1, 'Mantém folga inferior');
      await page.locator('#hero-next').click();
    }
  }
  assert.equal(ratios.size, 4);
  assert.deepEqual(errors, []);
  console.log('OK: ficha contida em capas verticais, quadradas e horizontais; 4 larguras de tela; margens preservadas.');
} finally {
  await browser.close();
}
