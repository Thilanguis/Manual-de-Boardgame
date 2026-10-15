import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument } = require('pdf-lib');
const pdf = await PDFDocument.create();
pdf.addPage();
const bytes = [...(await pdf.save())];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' }),
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
  await page.waitForFunction(() => document.getElementById('account-label').textContent === 'Local');
  assert.equal(await page.locator('.hero').isVisible(), false);
  await page.evaluate(async (bytes) => {
    const { createLocalRepository } = await import('./js/local-repository.js'),
      repo = await createLocalRepository();
    for (const game of [
      { id: 'older', title: 'Jogo anterior', createdAt: 1 },
      { id: 'newer', title: 'Jogo mais novo', createdAt: 2 },
    ])
      await repo.saveGame(
        { ...game, description: '', minPlayers: 1, maxPlayers: 4, tags: [], mechanics: [], language: 'pt-BR', manual: { name: 'fixture.pdf', pages: 1, size: bytes.length, sha256: game.id }, cover: {}, sources: {}, isPublic: true },
        { manualBlob: new Blob([Uint8Array.from(bytes)]) },
      );
    repo.close();
  }, bytes);
  await page.waitForFunction(() => document.querySelectorAll('.game-card').length === 2);
  assert.equal(await page.locator('.hero').isVisible(), false, 'Adicionar jogos não escolhe o destaque');
  await page.locator('.card-main').filter({ hasText: 'Jogo anterior' }).click();
  await page.locator('[data-close=detail-dialog]').click();
  assert.equal(await page.locator('#hero-title').textContent(), 'Jogo anterior');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const hero = await page.locator('.hero').boundingBox(),
      library = await page.locator('#biblioteca').boundingBox();
    assert(hero.y + hero.height <= library.y + 1, `${width}: destaque fica acima da biblioteca`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: `test-output/last-viewed-${width}.png`, fullPage: true, animations: 'disabled' });
  }
  await page.reload();
  await page.waitForFunction(() => document.getElementById('hero-title').textContent === 'Jogo anterior');
  await page.locator('.card-main').filter({ hasText: 'Jogo mais novo' }).click();
  await page.locator('[data-close=detail-dialog]').click();
  assert.equal(await page.locator('#hero-title').textContent(), 'Jogo mais novo');
  await page.locator('.card-main').filter({ hasText: 'Jogo anterior' }).click();
  await page.locator('[data-close=detail-dialog]').click();
  await page.evaluate(async (bytes) => {
    const { createLocalRepository } = await import('./js/local-repository.js'),
      repo = await createLocalRepository();
    await repo.saveGame(
      { id: 'newest', title: 'Adicionado depois do clique', createdAt: 3, description: '', tags: [], manual: { name: 'new.pdf', pages: 1, size: bytes.length, sha256: 'newest' }, cover: {}, sources: {} },
      { manualBlob: new Blob([Uint8Array.from(bytes)]) },
    );
    repo.close();
  }, bytes);
  await page.waitForFunction(() => document.querySelectorAll('.game-card').length === 3);
  assert.equal(await page.locator('#hero-title').textContent(), 'Jogo anterior', 'Novo upload não troca o último jogo clicado');
  await page.evaluate(async () => {
    const { createLocalRepository } = await import('./js/local-repository.js');
    const repo = await createLocalRepository();
    await repo.deleteGame({ id: 'older' });
    repo.close();
  });
  await page.waitForFunction(() => document.querySelector('.hero').hidden);
  assert.equal(await page.locator('#hero-title').textContent(), '', 'Exclusão não escolhe outro jogo automaticamente');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('Destaque acima da biblioteca em desktop/tablet/celular, vazio antes do clique, último clique persistido, novo upload preserva escolha e exclusão não escolhe substituto.');
} finally {
  await browser.close();
}
