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
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort()));
  await context.route('**/config/app-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export const APP_CONFIG={allowLocalDevelopment:true,firebase:null,fileStorage:{},maxPdfBytes:52428800};' }));
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/?local=1');
  await page.waitForFunction(() => document.querySelector('#account-label').textContent === 'Local');
  await page.evaluate(async (bytes) => {
    const { createLocalRepository } = await import('./js/local-repository.js');
    const repo = await createLocalRepository();
    for (let i = 1; i <= 20; i++) {
      const id = 'journey-' + i;
      await repo.saveGame(
        {
          id,
          title: 'Jogo ' + String(i).padStart(2, '0'),
          description: 'Uma aventura para compartilhar com amigos.',
          minPlayers: 2,
          maxPlayers: 4,
          minDurationMinutes: 30,
          maxDurationMinutes: 60,
          tags: [],
          mechanics: [],
          language: 'pt-BR',
          manual: { name: 'fixture.pdf', pages: 1, size: bytes.length, sha256: id },
          cover: { sha256: id },
          sources: {},
        },
        {
          manualBlob: new Blob([Uint8Array.from(bytes)], { type: 'application/pdf' }),
          coverBlob: new Blob(
            [
              '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#4c696b"/><circle cx="300" cy="350" r="160" fill="#cdb477"/><text x="300" y="150" text-anchor="middle" font-size="48" fill="white">AVENTURA</text></svg>',
            ],
            { type: 'image/svg+xml' },
          ),
        },
      );
    }
    repo.close();
  }, bytes);
  await page.waitForFunction(() => document.querySelectorAll('.game-card').length === 20);
  await page.locator('#search').fill('Jogo');
  await page.locator('#sort').selectOption('az');
  await page.locator('#players-filter').selectOption('2');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const source = page.locator('.card-main').last();
    const id = await source.getAttribute('data-game-id');
    await source.scrollIntoViewIfNeeded();
    await page.evaluate(() => scrollTo({ top: scrollY, behavior: 'instant' }));
    const original = await source.evaluate((el) => el.getBoundingClientRect().top);
    const title = await source.locator('.card-title').textContent();
    await source.click();
    await page.waitForFunction(() => document.querySelector('#detail-dialog').open);
    assert.equal(await page.locator('#hero-title').textContent(), title);
    assert(await page.evaluate(() => scrollY < 100), 'Sobe ao destaque antes de abrir');
    await page.waitForFunction(() =>
      document
        .querySelector('#detail-dialog')
        .getAnimations()
        .every((a) => a.playState === 'finished'),
    );
    if (width === 1440) {
      await page.locator('#detail-favorite').click();
      await page.locator('[data-close=detail-dialog]').click();
    } else await page.keyboard.press('Escape');
    await page.waitForFunction(
      ({ id, top }) => {
        const el = [...document.querySelectorAll('.card-main')].find((e) => e.dataset.gameId === id);
        return !document.querySelector('#detail-dialog').open && !document.querySelector('#hero-box-lid').getAnimations().length && Math.abs(el.getBoundingClientRect().top - top) < 4 && document.activeElement === el;
      },
      { id, top: original },
    );
    assert.equal(await page.locator('#search').inputValue(), 'Jogo');
    assert.equal(await page.locator('#sort').inputValue(), 'az');
    assert.equal(await page.locator('#players-filter').inputValue(), '2');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const source = page.locator('.card-main').last();
  await source.scrollIntoViewIfNeeded();
  const original = await source.evaluate((el) => el.getBoundingClientRect().top);
  await source.click();
  await page.waitForFunction(() => document.querySelector('#detail-dialog').open);
  assert.equal(await page.locator('#detail-dialog').evaluate((el) => el.getAnimations().length), 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction((top) => !document.querySelector('#detail-dialog').open && Math.abs(document.activeElement.getBoundingClientRect().top - top) < 4, original);
  assert.deepEqual(errors, []);
  console.log('OK: clique na biblioteca sobe e abre a caixa; botão/Esc fecham e retornam ao mesmo jogo; busca/ordenação/foco preservados; desktop/celular/movimento reduzido.');
} finally {
  await browser.close();
}
