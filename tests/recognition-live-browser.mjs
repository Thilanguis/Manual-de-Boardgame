// APIs de catálogo REAIS; identidade/Firestore emulados, PDFs locais, nenhum upload.
import { createRequire } from 'node:module';
import { resolve, basename } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { OWNER_UID } from '../js/permissions.js';
import { queryCatalog, researchCapabilities } from '../worker/src/catalog/index.js';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Exige emuladores; nunca usar um projeto Firebase real neste teste.');
const cases = [
  ['O Senhor dos Anéis: Sina da Sociedade', process.env.ACERVO_SINA_PDF],
  ['Colonizadores de Catan', process.env.ACERVO_CATAN_PDF],
  ['O Senhor dos Anéis: Duelo pela Terra-média', process.env.ACERVO_DUELO_PDF],
];
if (cases.some(([, path]) => !path)) throw new Error('Defina ACERVO_SINA_PDF, ACERVO_CATAN_PDF e ACERVO_DUELO_PDF com arquivos locais reais.');
const project = 'demo-acervo',
  base = process.env.ACERVO_TEST_URL || 'http://localhost:4174';
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const env = await initializeTestEnvironment({ projectId: project, firestore: { host, port: Number(port), rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
await env.clearFirestore();
const password = 'Recognition-fixture-123';
assert.equal(
  (
    await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: OWNER_UID, email: 'recognition@example.test', password }),
    })
  ).status,
  200,
);
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore(),
    stamp = Timestamp.fromMillis(Date.now());
  await setDoc(doc(db, 'users', OWNER_UID), {
    uid: OWNER_UID,
    name: 'Teste isolado',
    email: 'recognition@example.test',
    status: 'approved',
    role: 'superadmin',
    permissions: { approveUsers: true, addGames: true, editGames: true, deleteGames: true },
    createdAt: stamp,
    updatedAt: stamp,
    version: 1,
    lastEventId: '',
  });
  await setDoc(doc(db, 'settings', 'library'), { publicRead: true, version: 1, updatedAt: stamp, lastEventId: '' });
});
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json')),
  { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  context = await browser.newContext({ serviceWorkers: 'block' }),
  page = await context.newPage(),
  errors = [],
  reports = [];
const workerEnv = { FIREBASE_PROJECT_ID: project, OWNER_UID };
let currentReport;
await context.route('**/config/app-config.js', (route) =>
  route.fulfill({
    contentType: 'text/javascript',
    body: `export const APP_CONFIG=${JSON.stringify({ firebase: { apiKey: 'demo-key', authDomain: 'demo-acervo.firebaseapp.com', projectId: project, appId: '1:000:web:test' }, fileStorage: { provider: 'drive', apiBase: 'https://recognition-test.invalid' }, emulators: { auth: 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST, host, port: Number(port) }, maxPdfBytes: 52428800, enableBgg: false })};`,
  }),
);
await context.route('https://recognition-test.invalid/**', async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/v1/research/sources') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(researchCapabilities(workerEnv)) });
  const source = url.pathname.split('/').at(-1);
  assert(['wikidata', 'wikipedia'].includes(source), 'Nenhuma operação Drive é permitida neste teste.');
  const input = route.request().postDataJSON(),
    token = route.request().headers().authorization.slice(7),
    start = Date.now(),
    record = currentReport;
  try {
    const data = await queryCatalog(source, input, workerEnv, { uid: OWNER_UID, token }, null, (url, options) => {
      const parsed = new URL(url);
      if (parsed.hostname === 'firestore.googleapis.com') return fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}${parsed.pathname}`, options);
      return fetch(url, options);
    });
    record.responses.push({ source, ms: Date.now() - start, ...data });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  } catch (error) {
    record.responses.push({ source, error: error.message, status: error.status, ms: Date.now() - start });
    return route.fulfill({ status: error.status || 502, contentType: 'application/json', body: JSON.stringify({ error: error.message }) });
  }
});
page.on('pageerror', (error) => errors.push(error.message));
const formValues = () => page.evaluate(() => Object.fromEntries(new FormData(document.getElementById('game-form')).entries()));
async function applyFields(source, fields) {
  const id = source === 'Wikipédia' ? 'wikipedia' : source === 'Wikidata' ? 'wikidata' : 'pdf';
  await page.locator(`[data-research-source=${id}]`).locator('button').click();
  for (const field of fields) {
    const box = page.locator(`[data-research-field=${field}]`);
    if (await box.count()) await box.check();
  }
  await page.locator('[data-research-review] input[type=checkbox]').last().check();
  await page.locator('[data-research-review] button').click();
}
try {
  await page.goto(base);
  await page.waitForFunction(() => document.getElementById('connection-status').textContent.includes('leitura pública'));
  await page.locator('#account-button').click();
  await page.locator('#login-form [name=email]').fill('recognition@example.test');
  await page.locator('#login-form [name=password]').fill(password);
  await page.locator('#login-submit').click();
  await page.locator('#manage-button').waitFor({ state: 'visible' });
  await mkdir('test-output', { recursive: true });
  for (const [title, path] of cases) {
    currentReport = { title, file: basename(path), responses: [] };
    reports.push(currentReport);
    await page.locator('#empty-action').click();
    await page.locator('#pdf-file').setInputFiles(path);
    await page.locator('#game-form').waitFor({ state: 'visible' });
    currentReport.detectedTitle = await page.locator('#game-title').inputValue();
    if (currentReport.detectedTitle !== title) {
      await page.locator('#game-title').fill(title);
      await page.locator('[data-research-search]').click();
    }
    await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
    currentReport.pdfFields = await formValues();
    if (title.includes('Sina')) {
      await page.waitForFunction(() => /OCR local:|atingiu|não encontrou|not a function|Failed/.test(document.querySelector('[data-research-ocr-status]').textContent), null, { timeout: 25000 });
      currentReport.ocrStatus = await page.locator('[data-research-ocr-status]').textContent();
      await applyFields('PDF · OCR local', ['description', 'gameType', 'tags']);
      assert((await page.locator('#game-form [name=description]').inputValue()).includes('Controlando os membros'));
      const description = await page.locator('#game-form [name=description]').inputValue();
      await applyFields('Wikidata', ['minPlayers']);
      assert.equal(await page.locator('#game-form [name=description]').inputValue(), description);
      assert.equal(await page.locator('#game-form [name=minPlayers]').inputValue(), '1');
      assert.equal(await page.locator('#game-form [name=maxPlayers]').inputValue(), '5');
    } else if (title.includes('Catan')) {
      assert.equal(currentReport.pdfFields.recommendedAge, '');
      assert.equal(currentReport.pdfFields.minPlayers, '');
      assert.equal(currentReport.pdfFields.maxPlayers, '');
      await applyFields('Wikipédia', ['description']);
      assert((await page.locator('#game-form [name=description]').inputValue()).includes('Catan'));
    }
    currentReport.finalFields = await formValues();
    currentReport.status = await page.locator('[data-research-status]').textContent();
    assert(currentReport.responses.some((r) => r.source === 'wikidata'));
    assert(currentReport.responses.some((r) => r.source === 'wikipedia'));
    assert(currentReport.responses.every((r) => !r.error));
    const unique = new Map(currentReport.responses.map((r) => [r.source, r]));
    currentReport.responses = [...unique.values()];
    console.log(
      JSON.stringify({
        title,
        counts: currentReport.responses.map((r) => ({ source: r.source, count: r.candidates.length, ms: r.ms, fields: r.candidates.map((c) => Object.keys(c.fields)) })),
        pdfFields: Object.entries(currentReport.pdfFields)
          .filter(([k, v]) => v && ['description', 'recommendedAge', 'gameType', 'mechanics', 'tags'].includes(k))
          .map(([k]) => k),
        ocr: currentReport.ocrStatus,
      }),
    );
    await page.screenshot({ path: `test-output/recognition-real-${reports.length}.png`, fullPage: true });
    await page.locator('#upload-dialog [data-close=upload-dialog]').first().click();
  }
  assert.deepEqual(errors, []);
  await writeFile('test-output/recognition-real.json', JSON.stringify(reports, null, 2));
  console.log('Três PDFs reais e APIs reais passaram; sem gravação/upload em produção.');
} finally {
  await browser.close();
  await env.cleanup();
}
