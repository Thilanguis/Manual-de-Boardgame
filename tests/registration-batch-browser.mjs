import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'), { PDFDocument } = require('pdf-lib');
const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.route('**/config/app-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export const APP_CONFIG={allowLocalDevelopment:true,firebase:null,fileStorage:{},maxPdfBytes:52428800};' }));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  const pdfs = [];
  for (const name of ['Manual principal', 'Livro do traidor', 'Livro dos sobreviventes']) {
    const pdf = await PDFDocument.create();
    pdf.setTitle(name);
    pdf.addPage().drawText(`${name}: distribua as cartas e siga as regras do cenario durante cada turno.`, { x: 30, y: 700, size: 12 });
    pdfs.push({ name: `${name}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  }
  await page.goto(`${base}/?local=1`);
  await page.locator('#empty-action').click();
  await page.locator('#pdf-file').setInputFiles([pdfs[0], { ...pdfs[1], buffer: Buffer.from('PDF corrompido') }, { ...pdfs[2], buffer: Buffer.alloc(0) }]);
  await page.waitForFunction(() => document.querySelectorAll('[data-registration-document]').length === 2 && !document.querySelector('#registration-pdfs').disabled);
  assert.match(await page.locator('#registration-pdfs legend').textContent(), /3 PDFs/);
  assert.equal(await page.locator('.registration-pdf-row .inline-error').count(), 2, 'arquivos inválidos continuam visíveis com os motivos');
  await page.locator('#game-title').fill('Cadastro inicial com três PDFs');
  await page.locator('[data-step-target="3"]').click();
  assert.equal(await page.locator('#upload-dialog').getAttribute('data-step'), '1', 'não permite salvar apenas o principal por descartar falhas');
  assert.match(await page.locator('#save-error').textContent(), /Há PDFs/);
  assert.equal(await page.locator('.card-main').count(), 0);
  await page.getByLabel('Retirar Livro do traidor.pdf', { exact: true }).click();
  await page.getByLabel('Retirar Livro dos sobreviventes.pdf', { exact: true }).click();
  await page.locator('#additional-pdf-file').setInputFiles(pdfs.slice(1));
  await page.waitForFunction(() => document.querySelectorAll('[data-registration-document]').length === 2 && !document.querySelector('#registration-pdfs').disabled);
  await page.locator('[data-step-target="3"]').click();
  const summary = await page.locator('#game-summary').textContent();
  assert.match(summary, /3 arquivos/);
  assert.match(summary, /Livro do traidor/);
  assert.match(summary, /Livro dos sobreviventes/);
  await page.locator('[name=confirmed]').check();
  await page.locator('#save-game').click();
  await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
  assert.match(await page.locator('#notice-text').textContent(), /3 PDFs/);
  const records = await page.evaluate(() => new Promise((resolve) => {
    const r = indexedDB.open('acervo-library-v1');
    r.onsuccess = () => { const q = r.result.transaction('games').objectStore('games').getAll(); q.onsuccess = () => resolve(q.result); };
  }));
  assert.equal(records.length, 1);
  assert.equal(Object.keys(records[0].documents).length, 3, 'registro salvo inclui os três documentos');
  for (let i = 0; i < 2; i++) {
    if (i) await page.reload();
    await page.locator('.card-main').click();
    assert.equal(await page.locator('#detail-documents .document-reading-row').count(), 3, 'ficha exibe os três PDFs antes e depois do reload');
    await page.locator('#read-manual').click();
    await page.waitForFunction(() => document.querySelector('#reader-status').hidden);
    assert.equal(await page.locator('#reader-document option').count(), 3);
    await page.locator('#reader-close').click();
  }
  assert.deepEqual(errors, []);
  console.log('Cadastro inicial: três seleções preservadas, falhas impedem perda silenciosa, resumo confirma três PDFs, registro e ficha mantêm os três após reload.');
} finally {
  await browser.close();
}
