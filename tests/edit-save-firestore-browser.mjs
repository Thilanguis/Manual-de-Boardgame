import '../scripts/test-guard.mjs';
// Auth, SDK e regras reais nos emuladores; PDFs, catálogos e Drive fictícios.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, Timestamp } from 'firebase/firestore';
import { OWNER_UID } from '../js/permissions.js';
import { workerFixture } from './worker-browser-fixture.mjs';
import { openGameManagement } from './game-ui-fixture.mjs';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts } = require('pdf-lib');
const project = 'demo-acervo',
  id = '12345678-1234-1234-1234-123456789abc';
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) throw new Error('Exige emuladores locais.');
const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
const firestorePort = Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]);
const env = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: firestorePort, rules: await readFile('firestore.rules', 'utf8') } });
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.addPage().drawText('Dead by Daylight. Objetivo: consulte este manual ficticio. Distribua as cartas e coloque as fichas sobre a mesa.', { x: 20, y: 700, size: 10, font });
const bytes = Buffer.from(await pdf.save()),
  hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts`, {
  method: 'POST',
  headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
  body: JSON.stringify({ localId: OWNER_UID, email: 'edit-owner@example.test', password: 'Fixture-password-123' }),
});
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore(),
    now = Timestamp.now();
  await setDoc(doc(db, 'users', OWNER_UID), {
    uid: OWNER_UID,
    name: 'Proprietário',
    email: 'edit-owner@example.test',
    role: 'superadmin',
    status: 'approved',
    permissions: { approveUsers: true, addGames: true, editGames: true, deleteGames: true },
    createdAt: now,
    updatedAt: now,
    version: 1,
    lastEventId: '',
  });
  await setDoc(doc(db, 'settings', 'library'), { publicRead: false, version: 1, updatedAt: now, lastEventId: '' });
  await setDoc(doc(db, 'games', id), {
    id,
    title: 'Dead by Daylight',
    description: 'Descrição anterior preservada até confirmar.',
    minPlayers: 3,
    maxPlayers: 5,
    durationMinutes: null,
    minDurationMinutes: 30,
    maxDurationMinutes: 60,
    recommendedAge: null,
    mechanics: [],
    gameType: '',
    edition: '',
    tags: [],
    language: 'pt-BR',
    manual: { name: 'dead_by_daylight.pdf', path: `games/${id}/manual.pdf`, size: bytes.length, pages: 1, type: 'application/pdf', sha256: hash, storage: 'drive', driveFileId: 'manual-fixture' },
    cover: {},
    sources: {},
    createdAt: now,
    updatedAt: now,
    createdBy: OWNER_UID,
    schemaVersion: 1,
    isPublic: true,
    deleting: false,
  });
});
const backend = await workerFixture({ project, origin: base, initialFiles: [['manual-fixture', { bytes, name: 'dead_by_daylight.pdf', appProperties: { acervoProject: project, gameId: id, kind: 'manual' } }]] });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await context.route('**/config/app-config.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export const APP_CONFIG=${JSON.stringify({ firebase: { apiKey: 'demo-key', projectId: project, authDomain: `${project}.firebaseapp.com`, appId: '1:000:web:edit' }, ownerUid: OWNER_UID, sdkBase: '/__dev/sdk', emulators: { auth: `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, host: '127.0.0.1', port: firestorePort }, fileStorage: { apiBase: backend.apiBase }, enableGoogleLogin: false, maxPdfBytes: 52428800 })};`,
    }),
  );
  await context.route('**/js/firebase-repository.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('  return repository;\n}', '  window.editFixtureRepository = repository; return repository;\n}') });
  });
  await context.route('**/v1/research/sources', (route) => route.fulfill({ json: { protocol: 2, sources: [{ id: 'wikidata', enabled: true, name: 'Fonte fictícia', url: 'https://example.test', reason: 'fixture' }] } }));
  await context.route('**/v1/research/wikidata', (route) =>
    route.fulfill({
      json: {
        source: 'wikidata',
        candidates: [
          {
            source: 'wikidata',
            id: 'QFIXTURE',
            names: [{ value: 'Dead by Daylight', language: 'pt-BR' }],
            fields: { description: 'Sobreviva às ameaças e cumpra os objetivos apresentados no manual de teste.', minPlayers: 3, maxPlayers: 5, minDurationMinutes: 30, maxDurationMinutes: 60 },
            language: 'pt-BR',
            kind: 'unknown',
            edition: '',
            license: 'CC0',
            identifiers: { wikidata: 'QFIXTURE' },
            conflicts: [],
          },
        ],
      },
    }),
  );
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator('#login-form [name=email]').fill('edit-owner@example.test');
  await page.locator('#login-form [name=password]').fill('Fixture-password-123');
  await page.locator('#login-submit').click();
  await page.locator('.card-main').click();
  await openGameManagement(page, 'manage-information');
  await page.locator('#edit-game').click();
  await page.locator('[data-research-search]').click();
  await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
  await page.getByRole('button', { name: 'Revisar sugestões', exact: true }).click();
  await page.locator('[data-research-all]').check();
  await page.locator('[data-research-review] input[type=checkbox]').last().check();
  await page.getByRole('button', { name: 'Usar campos na etapa 2', exact: true }).click();
  assert.match(await page.locator('#game-form [name=description]').inputValue(), /Sobreviva às ameaças/);
  await page.locator('[data-step-target="3"]').click();
  await page.locator('[name=confirmed]').check();
  await page.locator('#save-game').click();
  await page.waitForFunction(() => !document.querySelector('#upload-dialog').open);
  const inspect = async () => {
    let data;
    await env.withSecurityRulesDisabled(async (context) => {
      data = (await getDoc(doc(context.firestore(), 'games', id))).data();
    });
    return data;
  };
  const saved = await inspect();
  assert.equal(saved.sources.title.url, '');
  assert.equal(saved.sources.title.source, 'Wikidata · confirmado');
  assert.equal(saved.sources.catalog.matches[0].url, '');
  assert.match(saved.description, /Sobreviva às ameaças/);
  assert.equal(saved.manual.driveFileId, 'manual-fixture');
  assert.equal(typeof saved.updatedAt.toMillis, 'function');
  // Exercita a proteção do repositório também para um rascunho em memória com
  // propriedades opcionais undefined, além da correção da origem das sugestões.
  await page.evaluate(async () => {
    const repository = window.editFixtureRepository;
    const latest = await repository.latestGame(repository.games[0]);
    latest.sources.extra = { source: 'Conferido por você', url: undefined, license: undefined, origins: [{ source: 'Manual', optional: undefined }] };
    await repository.saveGame(latest);
  });
  const clean = await inspect();
  assert.deepEqual(clean.sources.extra, { source: 'Conferido por você', origins: [{ source: 'Manual' }] });
  assert.equal(clean.createdAt.toMillis(), saved.createdAt.toMillis());
  assert.equal(clean.createdBy, saved.createdBy);
  await page.reload();
  await page.locator('.card-main').click();
  await openGameManagement(page, 'manage-information');
  await page.locator('#edit-game').click();
  await page.locator('[data-step-target="2"]').click();
  assert.equal(await page.locator('#game-form [name=description]').inputValue(), saved.description);
  assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '30');
  assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '60');
  assert.deepEqual(errors, []);
  assert.deepEqual(backend.metrics.blockedOutbound, []);
  console.log('Firestore/Auth emulados + SDK real + Chrome: editar → pesquisar nome sem URL → revisar → salvar → registro verificado → recarregar; undefined aninhado removido, manual e timestamps preservados.');
} finally {
  await browser.close();
  await backend.close();
  await env.cleanup();
}
