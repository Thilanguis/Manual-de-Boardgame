import '../scripts/test-guard.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { openGameManagement } from './game-ui-fixture.mjs';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts } = require('pdf-lib');
const base = process.env.ACERVO_TEST_URL || 'http://localhost:4174';
async function pdf(name, term) {
  const document = await PDFDocument.create(),
    font = await document.embedFont(StandardFonts.Helvetica);
  document.setTitle(name);
  for (let i = 1; i <= 3; i++) {
    const p = document.addPage([595, 842]);
    p.drawText(i === 1 ? name : 'REGRAS IMPORTANTES', { x: 40, y: 740, size: 23, font });
    p.drawText(`${term}: coloque as cartas na mesa e distribua quatro fichas para cada jogador.`, { x: 40, y: 660, size: 11, font });
  }
  return { name: `${name}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await document.save()) };
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ serviceWorkers: 'block' }),
  page = await context.newPage(),
  errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('dialog', (dialog) => dialog.accept());
await context.route('**/config/app-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const APP_CONFIG={allowLocalDevelopment:true,firebase:null,fileStorage:{},maxPdfBytes:209715200};` }));
const readStore = async (store = 'games', database = 'acervo-library-v1') =>
  page.evaluate(
    async ({ store, database }) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open(database);
        r.onsuccess = () => {
          const db = r.result;
          const q = db.transaction(store).objectStore(store).getAll();
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(q.error);
        };
      }),
    { store, database },
  );
async function eventually(read, predicate, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Estado esperado não foi confirmado no armazenamento.');
}
async function waitReady(count) {
  return eventually(
    () =>
      page.evaluate(
        async () =>
          new Promise((resolve) => {
            const r = indexedDB.open('acervo-documents-local-v1');
            r.onsuccess = () => {
              if (!r.result.objectStoreNames.contains('files')) return resolve([]);
              const q = r.result.transaction('files').objectStore('files').getAllKeys();
              q.onsuccess = () => resolve(q.result.filter((k) => k.startsWith('index:')));
            };
          }),
      ),
    (keys) => keys.length >= count,
  );
}
try {
  await page.goto(`${base}/?local=1`);
  await page.locator('#empty-action').click();
  await page.locator('#pdf-file').setInputFiles([await pdf('Ilha dos Documentos', 'Exploracao'), await pdf('Referencia da Ilha', 'Navegacao'), await pdf('Errata da Ilha', 'Correcoes')]);
  await page.locator('#game-title').fill('Ilha dos Documentos');
  await page.locator('[data-step-target="3"]').click();
  await page.locator('[name=confirmed]').check();
  await page.locator('#save-game').click();
  await page.waitForFunction(() => !document.getElementById('upload-dialog').open && document.querySelectorAll('.game-card').length === 1);
  await waitReady(3);
  const [saved] = await readStore();
  assert.equal(Object.keys(saved.documents).length, 3);
  assert.equal(saved.primaryDocumentId, 'main');
  const guides = await readStore('drafts', 'acervo-guides-local-v1');
  assert.equal(guides.length, 0, 'O índice automático não cria rascunho didático.');
  await page.locator('.card-main').click();
  assert.equal(await page.locator('.document-row').count(), 3);
  await page.locator('#quick-rules').click();
  await page.locator('#guide-search').fill('Navegacao');
  await page.waitForFunction(() => document.querySelectorAll('.rule-result').length > 0);
  assert.match(await page.locator('#guide-content').textContent(), /Referencia da Ilha/);
  await page.locator('.rule-result button').first().click();
  await page.waitForFunction(() => document.getElementById('reader-subtitle').textContent.includes('Referencia da Ilha'));
  assert.equal(await page.locator('#page-number').inputValue(), '1');
  await page.locator('#reader-close').click();
  await page.reload();
  await page.locator('.card-main').click();
  await openGameManagement(page, 'manage-guide');
  await page.locator('#edit-guide').click();
  await page.getByRole('button', { name: 'Adicionar sugestões de todos os documentos', exact: true }).click();
  assert((await page.locator('.guide-editor-section').count()) >= 9);
  const names = await page.locator('.guide-editor-section [name=documentId]').evaluateAll((fields) => [...new Set(fields.map((f) => f.value))]);
  assert.equal(names.length, 3);
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('guide-status').textContent.includes('Rascunho salvo'));
  await page.locator('#guide-close').click();
  await page.locator('.card-main').click();
  await openGameManagement(page, 'manage-documents-section');
  const beforeReplace = (await readStore())[0],
    ref = Object.values(beforeReplace.documents).find((doc) => doc.name === 'Referencia da Ilha');
  const reference = page.locator(`[data-document-id="${ref.id}"]`);
  await reference.locator('summary').click();
  await reference.locator('input[type=file]').setInputFiles(await pdf('Referencia revisada', 'TravessiaNova'));
  await eventually(readStore, (records) => records[0]?.documents[ref.id]?.manual.sha256 !== ref.manual.sha256);
  const afterReplace = (await readStore())[0];
  assert.equal(afterReplace.documents.main.manual.sha256, beforeReplace.documents.main.manual.sha256);
  assert.notEqual(afterReplace.documents[ref.id].manual.sha256, ref.manual.sha256);
  const draftAfter = await readStore('drafts', 'acervo-guides-local-v1');
  assert(draftAfter[0].sections.filter((s) => s.documentId === ref.id).every((s) => s.sourceHash === ref.manual.sha256));
  const extra = page.locator('.document-row').filter({ hasText: 'Referencia da Ilha' });
  if (!(await extra.locator('details').evaluate((d) => d.open))) await extra.locator('summary').click();
  await extra.getByRole('button', { name: 'Tornar principal' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.document-row').length === 3 && [...document.querySelectorAll('.document-row')].some((row) => row.textContent.includes('Referencia da Ilha') && row.textContent.includes('· Principal')));
  const errata = page.locator('.document-row').filter({ hasText: 'Errata da Ilha' });
  await errata.locator('summary').click();
  await errata.getByRole('button', { name: 'Remover PDF' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.document-row').length === 2);
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['tablet', 768, 1024],
    ['mobile', 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    assert(await page.evaluate(() => document.getElementById('detail-dialog').scrollWidth <= document.getElementById('detail-dialog').clientWidth + 1));
    await mkdir('test-output', { recursive: true });
    await page.screenshot({ path: `test-output/documents-${name}.png` });
  }
  assert.deepEqual(errors, []);
  await writeFile(
    'test-output/documents-report.json',
    JSON.stringify(
      { documents: 3, sharedIndexWithoutDraft: true, unifiedQuery: true, correctPDF: true, persistence: true, replacedOneWithoutChangingOthers: true, oldGuideReferencesPreserved: true, primaryChanged: true, removedOne: true, viewports: 3, errors },
      null,
      2,
    ),
  );
  console.log('Múltiplos PDFs: cadastro, preparo automático, consulta unificada, PDF correto, persistência, sugestões por documento, principal e remoção; 3 tamanhos.');
} finally {
  await browser.close();
}
