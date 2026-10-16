import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { browserDependencies as require } from './browser-dependencies.mjs';
const { chromium } = require('playwright'),
  { PDFDocument } = require('pdf-lib'),
  browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { externalRequests: [], errors: [] };
const headers = { Authorization: 'Bearer owner' };
const root = 'http://127.0.0.1:8080/v1/projects/demo-acervo/databases/(default)/documents';
try {
  const c = await browser.newContext({ serviceWorkers: 'block' });
  await c.route('**/*', (r) => {
    if (!['localhost', '127.0.0.1'].includes(new URL(r.request().url()).hostname)) {
      report.externalRequests.push(r.request().url());
      return r.abort();
    }
    return r.continue();
  });
  const p = await c.newPage();
  p.on('pageerror', (e) => report.errors.push(e.message));
  await p.goto('http://localhost:4173');
  await p.locator('#login-form [name=email]').fill('proprietario@acervo.test');
  await p.locator('#login-form [name=password]').fill('Acervo-teste-123');
  await p.locator('#login-submit').click();
  await p.waitForFunction(() => document.body.classList.contains('access-approved'));
  const image = await p.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1500;
    canvas.height = 1800;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 1500, 1800);
    ctx.fillStyle = '#000';
    ctx.font = '48px Arial';
    ['ILHA DOS FAROLEIROS - TESTE OCR', 'PREPARACAO DA PARTIDA', 'Distribua quatro cartas para cada jogador.', 'Coloque os barcos no centro da mesa.', 'TURNO DO JOGADOR', 'Compre uma carta e mova seu barco.', 'Cada farol vale tres pontos.'].forEach(
      (text, i) => ctx.fillText(text, 80, 180 + i * 125),
    );
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  const pdf = await PDFDocument.create();
  pdf.setTitle('Ilha Escaneada de Teste');
  const jpeg = await pdf.embedJpg(Buffer.from(image, 'base64'));
  for (let i = 0; i < 2; i++) pdf.addPage([600, 720]).drawImage(jpeg, { x: 0, y: 0, width: 600, height: 720 });
  const name = `Ilha Escaneada ${Date.now()}`;
  await p.locator('[data-add]').first().click();
  await p.locator('#pdf-file').setInputFiles({ name: 'ficticio-escaneado.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await p.locator('#game-title').fill(name);
  await p.locator('[data-step-target="2"]').click();
  await p.locator('select[name=language]').selectOption('pt-BR');
  await p.locator('[data-step-target="3"]').click();
  await p.locator('[name=confirmed]').check();
  await p.locator('#save-game').click();
  await p.waitForFunction(() => !document.querySelector('#upload-dialog').open);
  const games = await (await fetch(root + '/games', { headers })).json();
  const game = games.documents.find((g) => g.fields.title.stringValue === name),
    id = game.fields.id.stringValue;
  const end = Date.now() + 120000;
  let index;
  while (Date.now() < end) {
    const response = await fetch(`${root}/games/${id}/indexes/main`, { headers });
    if (response.ok) {
      index = await response.json();
      if (index.fields.readablePages.integerValue === '2') break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(index?.fields.readablePages.integerValue, '2');
  report.ocrPages = 2;
  report.state = index.fields.state.stringValue;
  await p.locator('.card-main').filter({ hasText: name }).click();
  await p.locator('#quick-rules').click();
  await p.locator('#guide-search').fill('barco');
  await p.waitForFunction(() => document.querySelectorAll('.rule-result').length > 0);
  report.searchResults = await p.locator('.rule-result').count();
  await p.reload();
  await p.waitForFunction(() => document.body.classList.contains('access-approved'));
  await p.waitForTimeout(1000);
  const restored = await (await fetch(`${root}/games/${id}/indexes/main`, { headers })).json();
  assert.equal(restored.fields.revision.integerValue, index.fields.revision.integerValue);
  report.reusedAfterReload = true;
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await writeFile('test-output/development-ocr-report.json', JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
