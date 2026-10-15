// Fluxos reais do frontend e IndexedDB, somente em perfil local descartável.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts } = require('pdf-lib');
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.setTitle('Exploradores da Ilha');
const sheet = pdf.addPage([595, 842]);
for (const [i, line] of ['Exploradores da Ilha', '2-4 jogadores', 'Duração: 60-120 minutos', 'Idade: 12 anos', 'Objetivo do jogo', 'Explore a ilha e reúna os tesouros para vencer a partida.', 'Preparação'].entries())
  sheet.drawText(line, { x: 45, y: 760 - i * 45, size: i === 0 ? 30 : 15, font });
const bytes = Buffer.from(await pdf.save()),
  browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ serviceWorkers: 'block' }),
  page = await context.newPage(),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await mkdir('test-output', { recursive: true });
try {
  await page.goto((process.env.ACERVO_TEST_URL || 'http://localhost:4174') + '/?local=1');
  await page.waitForFunction(() => document.getElementById('connection-status').textContent.includes('Neste dispositivo'));
  for (const [label, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
    ['tablet', 768, 1024],
    ['small', 320, 640],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator('[data-add]').first().click();
    await page.locator('#pdf-file').setInputFiles({ name: 'Exploradores.pdf', mimeType: 'application/pdf', buffer: bytes });
    await page.locator('#game-form').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '60');
    assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '120');
    assert.equal(await page.locator('#save-game').isVisible(), false);
    await page.locator('#game-next').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'information-heading');
    await page.locator('#game-form [name=description]').fill('Resumo conferido sem perder o que foi preenchido.');
    await page.locator('[name=maxDurationMinutes]').fill('30');
    await page.locator('#game-next').click();
    assert.equal(await page.locator('[data-game-step="2"]').isVisible(), true);
    assert.match(await page.locator('#save-error').textContent(), /mínima não pode/);
    await page.locator('[name=maxDurationMinutes]').fill('120');
    await page.locator('#game-back').click();
    await page.locator('#game-next').click();
    assert.equal(await page.locator('#game-form [name=description]').inputValue(), 'Resumo conferido sem perder o que foi preenchido.');
    assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '120');
    await page.locator('#game-next').click();
    assert.match(await page.locator('#game-summary').textContent(), /60–120 min/);
    const footer = await page.locator('#save-game').boundingBox();
    assert(footer.y >= 0 && footer.y + footer.height <= height + 1, label + ': salvar permanece na área visível');
    assert.equal(await page.evaluate(() => document.getElementById('upload-dialog').scrollWidth <= document.getElementById('upload-dialog').clientWidth + 1), true, label + ': formulário sem rolagem horizontal');
    await page.screenshot({ path: `test-output/refinement-publish-${label}.png`, fullPage: false });
    if (label === 'small') {
      await page.locator('[name=confirmed]').check();
      await page.locator('#save-game').click();
      await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
    } else await page.locator('#upload-dialog [data-close]').first().click();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.card-main').click();
  assert.match(await page.locator('#detail-stats').textContent(), /60–120 min/);
  assert.match(await page.locator('#detail-guide-status').textContent(), /Verificando|ainda não/);
  await page.locator('[data-close=detail-dialog]').click();
  assert.match(await page.locator('#hero-meta').textContent(), /60–120 min/);
  assert.match(await page.locator('.card-meta').textContent(), /60–120 min/);
  await page.evaluate(
    async (data) => {
      const { createLocalRepository } = await import('/js/local-repository.js');
      const repo = await createLocalRepository();
      const base = { description: '', minPlayers: 2, maxPlayers: 4, tags: [], language: 'pt-BR', manual: { name: 'fixture.pdf', pages: 1, size: data.length, sha256: 'a'.repeat(64) }, cover: {}, sources: {}, isPublic: true };
      for (const item of [
        { id: 'legacy', title: 'Legado', durationMinutes: 30, sources: { duration: { source: 'PDF', excerpt: '30 minutos' } } },
        { id: 'quick', title: 'Rápido', minDurationMinutes: 15, maxDurationMinutes: 30, durationMinutes: null },
        { id: 'technical', title: 'ZMGPSM0101 v1.0.indd', durationMinutes: null },
      ])
        await repo.saveGame({ ...base, ...item }, { manualBlob: new Blob([Uint8Array.from(data)]) });
      repo.close();
    },
    [...bytes],
  );
  await page.waitForFunction(() => document.querySelectorAll('.game-card').length === 4);
  assert(!(await page.locator('#hero-title').textContent()).includes('.indd'));
  await page.locator('[data-filter=quick]').click();
  assert.equal(await page.locator('.game-card').count(), 2);
  await page.locator('[data-filter=all]').click();
  await page.locator('#sort').selectOption('duration');
  assert.deepEqual((await page.locator('.card-title').allTextContents()).slice(0, 3), ['Rápido', 'Legado', 'Exploradores da Ilha']);
  await page.locator('.card-main').filter({ hasText: 'Legado' }).click();
  await page.locator('#edit-game').click();
  assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '30');
  assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '30');
  await page.locator('#game-title').fill('Legado revisado');
  await page.locator('[data-step-target="3"]').click();
  await page.locator('[name=confirmed]').check();
  await page.locator('#save-game').click();
  await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
  const legacySource = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('acervo-library-v1');
      request.onsuccess = () => resolve(request.result);
    });
    const record = await new Promise((resolve) => {
      const request = db.transaction('games').objectStore('games').get('legacy');
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return record.sources.duration.source;
  });
  assert.equal(legacySource, 'PDF', 'Editar somente o título preserva a evidência antiga da duração');
  await page.locator('#title-repairs button').click();
  await page.locator('#edit-game').click();
  assert.equal(await page.locator('#game-title').inputValue(), 'ZMGPSM0101 v1.0.indd');
  await page.locator('#game-next').click();
  assert.equal(await page.locator('[data-game-step="1"]').isVisible(), true);
  assert.match(await page.locator('#save-error').textContent(), /título técnico/);
  await page.locator('#title-suggestions button').first().click();
  assert.equal(await page.locator('#game-title').inputValue(), 'O Senhor dos Anéis: Sina da Sociedade');
  await page.locator('[data-step-target="3"]').click();
  await page.locator('[name=confirmed]').check();
  await page.locator('#save-game').click();
  await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#title-repairs').isVisible(), false);
  await page.screenshot({ path: 'test-output/refinement-library-desktop.png', fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-output/refinement-library-mobile.png', fullPage: false });
  assert.deepEqual(errors, []);
  console.log('Etapas sem perda de campos, duração 60–120, legado, filtros/ordenação, título técnico e publicação em desktop/tablet/celular/320px passaram.');
} finally {
  await browser.close();
}
