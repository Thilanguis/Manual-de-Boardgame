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
async function pdf(name, term, pages = 3) {
  const document = await PDFDocument.create(),
    font = await document.embedFont(StandardFonts.Helvetica);
  document.setTitle(name);
  for (let i = 1; i <= pages; i++) {
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
await context.route('**/config/app-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const APP_CONFIG={allowLocalDevelopment:true,firebase:null,fileStorage:{},maxPdfBytes:52428800};` }));
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
  const principalPdf = await pdf('Ilha dos Documentos', 'Exploracao', 13), referencePdf = await pdf('Referencia da Ilha', 'Navegacao', 60), errataPdf = await pdf('Errata da Ilha', 'Correcoes', 8);
  await page.locator('#pdf-file').setInputFiles([principalPdf, referencePdf]);
  await page.waitForFunction(() => document.querySelectorAll('[data-registration-document]').length === 1 && !document.querySelector('#registration-pdfs').disabled);
  await page.locator('#additional-pdf-file').setInputFiles(errataPdf);
  await page.waitForFunction(() => document.querySelectorAll('[data-registration-document]').length === 2 && !document.querySelector('#registration-pdfs').disabled);
  // Rejeitar um duplicado não perde a seleção acumulada.
  await page.locator('#additional-pdf-file').setInputFiles(referencePdf);
  await page.waitForFunction(() => document.querySelector('#save-error').textContent.includes('já está na lista'));
  assert.equal(await page.locator('[data-registration-document]').count(), 2);
  await page.getByLabel('Retirar Errata da Ilha.pdf', { exact: true }).click();
  assert.equal(await page.locator('[data-registration-document]').count(), 1);
  await page.locator('#additional-pdf-file').setInputFiles(errataPdf);
  await page.waitForFunction(() => document.querySelectorAll('[data-registration-document]').length === 2 && !document.querySelector('#registration-pdfs').disabled);
  await page.getByLabel('Tipo de Referencia da Ilha.pdf', { exact: true }).selectOption('referencia');
  await page.getByLabel('Tipo de Errata da Ilha.pdf', { exact: true }).selectOption('errata');
  await page.getByLabel('Nome de Errata da Ilha.pdf', { exact: true }).fill('Errata da Ilha');
  await page.locator('#game-title').fill('Ilha dos Documentos');
  for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1024], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.locator('#registration-pdfs').scrollIntoViewIfNeeded();
    assert(await page.locator('#registration-pdfs').evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
    const footer = await page.locator('.wizard-footer').boundingBox();
    assert(footer && footer.y + footer.height <= height, 'ações do cadastro permanecem visíveis');
    await page.screenshot({ path: `test-output/registration-pdfs-${name}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-step-target="3"]').click();
  await page.locator('[name=confirmed]').check();
  await page.locator('#save-game').click();
  await page.waitForFunction(() => !document.getElementById('upload-dialog').open && document.querySelectorAll('.game-card').length === 1);
  await waitReady(3);
  const [saved] = await readStore();
  assert.equal(Object.keys(saved.documents).length, 3);
  assert.equal(saved.primaryDocumentId, 'main');
  assert.deepEqual(Object.values(saved.documents).filter((d) => d.id !== 'main').map((d) => d.documentType), ['referencia', 'errata']);
  const guides = await readStore('drafts', 'acervo-guides-local-v1');
  assert.equal(guides.length, 0, 'O índice automático não cria rascunho didático.');
  await page.locator('.card-main').click();
  assert.equal(await page.locator('.document-row').count(), 3);
  const files = [
    { id: 'main', name: 'Ilha dos Documentos', term: 'Exploracao', pages: 13 },
    ...Object.values(saved.documents)
      .filter((document) => document.id !== 'main')
      .map((document) => ({ id: document.id, name: document.name, pages: document.manual.pages, term: document.name === 'Referencia da Ilha' ? 'Navegacao' : 'Correcoes' })),
  ];
  assert.deepEqual(
    files.map((file) => file.pages),
    [13, 60, 8],
  );
  assert.equal(await page.locator('#detail-documents .document-reading-row').count(), 3);
  for (const file of files) {
    const row = page.locator(`[data-read-document-id="${file.id}"]`);
    assert.equal(await row.locator('strong').textContent(), file.name);
    assert.match(await row.textContent(), new RegExp(`${file.pages} páginas`));
  }
  for (const [index, file] of files.entries()) {
    if (index === 0) await page.locator(`[data-read-document-id="${file.id}"] button`).click();
    else await page.locator('#reader-document').selectOption(file.id);
    await page.waitForFunction(({ name, total }) => document.querySelector('#reader-subtitle').textContent.includes(name) && document.querySelector('#page-total').textContent === `/ ${total}` && document.querySelector('#reader-status').hidden, {
      name: file.name,
      total: file.pages,
    });
    assert.equal(await page.locator('#reader-document').inputValue(), file.id);
    assert.equal(await page.locator('#reader-document option').count(), 3);
    await page.waitForFunction((term) => document.querySelector('#pdf-text').textContent.includes(term), file.term);
    await page.locator('#page-number').fill(String(index + 2));
    await page.locator('#page-number').dispatchEvent('change');
    await page.waitForFunction((number) => document.querySelector('#reader-subtitle').textContent.startsWith(`Página ${number} `) && document.querySelector('#reader-status').hidden, index + 2);
  }
  for (const [index, file] of files.entries()) {
    await page.locator('#reader-document').selectOption(file.id);
    await page.waitForFunction(
      ({ name, total, number }) =>
        document.querySelector('#reader-subtitle').textContent.includes(name) &&
        document.querySelector('#page-total').textContent === `/ ${total}` &&
        document.querySelector('#reader-status').hidden &&
        document.querySelector('#page-number').value === String(number),
      { name: file.name, total: file.pages, number: index + 2 },
    );
  }
  for (const [width, height] of [
    [1440, 1000],
    [768, 1024],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.locator('#reader-document-picker').isVisible(), true);
    assert.equal(
      await page.evaluate(() => {
        const rect = document.querySelector('#reader-document').getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth;
      }),
      true,
    );
    if (width === 390) {
      await page.waitForFunction(() => document.querySelector('#reader-status').hidden && parseFloat(document.querySelector('#pdf-canvas').style.width) <= document.querySelector('#reader-stage').clientWidth);
      await mkdir('test-output', { recursive: true });
      await page.screenshot({ path: 'test-output/documents-reader-mobile.png' });
    }
  }
  await page.locator('#reader-close').click();
  await page.reload();
  await page.locator('.card-main').click();
  assert.equal(await page.locator('#detail-documents .document-reading-row').count(), 3, 'cada PDF continua separado após recarregar');
  await page.locator('#detail-documents').screenshot({ path: 'test-output/documents-list-mobile.png' });
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
  await page.evaluate(async () => {
    const { createLocalRepository } = await import('/js/local-repository.js');
    const repository = await createLocalRepository();
    const game = await new Promise((resolve) => {
      const off = repository.subscribeGames((games) => {
        if (games.length) {
          off();
          resolve(games[0]);
        }
      });
    });
    await repository.saveGuide(game, {
      gameId: game.id,
      revision: 0,
      sourceHash: game.manual.sha256,
      sections: Object.values(game.documents).map((document) => ({
        id: crypto.randomUUID(),
        title: 'Referência antiga',
        text: 'Conteúdo antigo preservado.',
        type: 'texto',
        page: 1,
        documentId: document.id,
        sourceHash: document.manual.sha256,
        reviewed: true,
      })),
      assets: {},
      indexFileId: '',
    });
    repository.close();
  });
  assert.equal(await page.locator('#edit-guide, [data-game-management=manage-guide]').count(), 0);
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
      {
        documents: 3,
        documentPages: [13, 60, 8],
        separateReading: true,
        separateReadingProgress: true,
        readerDocumentSelector: true,
        sharedIndexWithoutDraft: true,
        unifiedQuery: true,
        correctPDF: true,
        persistence: true,
        replacedOneWithoutChangingOthers: true,
        oldGuideReferencesPreserved: true,
        primaryChanged: true,
        removedOne: true,
        viewports: 3,
        errors,
      },
      null,
      2,
    ),
  );
  console.log('PDFs separados de 13/60/8 páginas: cadastro, abertura por nome, seletor, texto e progresso individuais, recarga, consulta com referência correta, substituição, principal e remoção; computador/tablet/celular.');
} finally {
  await browser.close();
}
