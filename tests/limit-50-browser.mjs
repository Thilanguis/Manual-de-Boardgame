import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { browserDependencies as require } from './browser-dependencies.mjs';
import { writeSizedPdf } from './sized-pdf-fixture.mjs';
import { openGameManagement } from './game-ui-fixture.mjs';
const { chromium } = require('playwright'),
  { PDFDocument } = require('pdf-lib');
const dir = resolve('test-output/development-fixtures');
await mkdir(dir, { recursive: true });
const pdf = await PDFDocument.create();
pdf.addPage().drawText('Manual FICTICIO - Ilha Grande. Preparacao: distribua seis cartas.', { x: 40, y: 700, size: 12 });
await writeSizedPdf(pdf, resolve(dir, 'exact50.pdf'), 52428800);
await writeSizedPdf(pdf, resolve(dir, 'above50.pdf'), 52428801);
await writeSizedPdf(pdf, resolve(dir, 'legacy100.pdf'), 104857600);
const report = { errors: [], externalRequests: [], limit: 52428800 };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (r) => {
    if (!['localhost', '127.0.0.1'].includes(new URL(r.request().url()).hostname)) {
      report.externalRequests.push(r.request().url());
      return r.abort();
    }
    return r.continue();
  });
  const p = await context.newPage();
  p.on('pageerror', (e) => report.errors.push(e.message));
  await p.goto('http://localhost:4173');
  await p.locator('#login-form [name=email]').fill('proprietario@acervo.test');
  await p.locator('#login-form [name=password]').fill('Acervo-teste-123');
  await p.locator('#login-submit').click();
  await p.waitForFunction(() => document.body.classList.contains('access-approved'));
  await p.locator('[data-add]').first().click();
  await p.locator('#pdf-file').setInputFiles(resolve(dir, 'above50.pdf'));
  await p.waitForFunction(() => document.querySelector('#upload-status').textContent.includes('50 MiB'));
  report.aboveLimitRejected = true;
  await p.locator('#pdf-file').setInputFiles(resolve(dir, 'exact50.pdf'));
  await p.locator('#game-title').fill('Ilha Grande de Teste');
  await p.locator('[data-step-target="3"]').click();
  await p.locator('[name=confirmed]').check();
  await p.locator('#save-game').click();
  await p.waitForFunction(() => !document.querySelector('#upload-dialog').open, null, { timeout: 60000 });
  report.exact50Saved = true;
  const bytes = await readFile(resolve(dir, 'legacy100.pdf')),
    hash = createHash('sha256').update(bytes).digest('hex'),
    id = '30000000-0000-4000-8000-000000000001';
  const installed = await fetch('http://127.0.0.1:8788/fixtures', { method: 'POST', body: JSON.stringify({ name: 'legacy100.pdf', gameId: id, fileId: 'dev-legacy-100' }) });
  assert(installed.ok);
  const fields = {
    id,
    title: 'Arquivo antigo de 100 MiB',
    description: 'Registro fictício anterior ao novo limite.',
    minPlayers: null,
    maxPlayers: null,
    durationMinutes: null,
    tags: [],
    language: 'pt-BR',
    manual: { path: `games/${id}/manual.pdf`, name: 'legacy100.pdf', type: 'application/pdf', size: bytes.length, pages: 1, sha256: hash, storage: 'drive', driveFileId: 'dev-legacy-100' },
    cover: {},
    sources: {},
    createdBy: 'dev-acervo-owner',
    schemaVersion: 1,
    isPublic: true,
    deleting: false,
  };
  const encode = (v) =>
    v === null
      ? { nullValue: null }
      : typeof v === 'string'
        ? { stringValue: v }
        : typeof v === 'boolean'
          ? { booleanValue: v }
          : typeof v === 'number'
            ? { integerValue: String(v) }
            : Array.isArray(v)
              ? { arrayValue: { values: v.map(encode) } }
              : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) } };
  const response = await fetch(`http://127.0.0.1:8080/v1/projects/demo-acervo/databases/(default)/documents/games/${id}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { ...encode(fields).mapValue.fields, createdAt: { timestampValue: new Date().toISOString() }, updatedAt: { timestampValue: new Date().toISOString() } } }),
  });
  assert(response.ok);
  const card = p.locator('.card-main').filter({ hasText: 'Arquivo antigo de 100 MiB' });
  await card.click();
  await p.locator('#read-manual').click();
  await p.waitForFunction(() => document.querySelector('#page-total').textContent === '/ 1', null, { timeout: 30000 });
  report.legacy100Readable = true;
  await p.locator('#reader-close').click();
  await card.click();
  await openGameManagement(p, 'manage-information');
  await p.locator('#edit-game').click();
  await p.locator('[data-step-target="2"]').click();
  await p.locator('textarea[name=description]').fill('Descrição revisada; PDF antigo preservado.');
  await p.locator('[data-step-target="3"]').click();
  await p.locator('[name=confirmed]').check();
  await p.locator('#save-game').click();
  await p.waitForFunction(() => !document.querySelector('#upload-dialog').open);
  const saved = await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-acervo/databases/(default)/documents/games/${id}`, { headers: { Authorization: 'Bearer owner' } })).json();
  assert.equal(saved.fields.description.stringValue, 'Descrição revisada; PDF antigo preservado.');
  assert.equal(saved.fields.manual.mapValue.fields.size.integerValue, '104857600');
  report.legacyMetadataEditable = true;
  for (const viewport of [
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
  ]) {
    await p.setViewportSize(viewport);
    await card.click();
    await p.locator('#read-manual').click();
    await p.waitForFunction(() => document.querySelector('#page-total').textContent === '/ 1');
    await p.locator('#reader-close').click();
  }
  report.legacyTabletMobileReadable = true;
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.externalRequests, []);
  report.passed = true;
} finally {
  await writeFile('test-output/limit-50-browser-report.json', JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
