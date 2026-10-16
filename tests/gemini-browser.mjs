import '../scripts/test-guard.mjs';
// Integração real da aplicação/Worker/Auth/Firestore; Gemini, fontes e storage DO simulados.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDocs, collection, Timestamp } from 'firebase/firestore';
import { workerFixture } from './worker-browser-fixture.mjs';
import { openGameManagement } from './game-ui-fixture.mjs';
import { OWNER_UID } from '../js/permissions.js';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Exige emuladores.');
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument } = require('pdf-lib');
const base = process.env.ACERVO_TEST_URL || 'http://localhost:4173',
  project = 'demo-acervo';
const env = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
await env.clearFirestore();
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${project}/accounts`, { method: 'DELETE' });
const profiles = [
  [OWNER_UID, 'owner@example.test', 'superadmin', 'approved'],
  ['reader', 'reader@example.test', 'user', 'approved'],
  ['pending', 'pending@example.test', 'user', 'pending'],
  ['subadmin', 'subadmin@example.test', 'subadmin', 'approved'],
];
for (const [uid, email, role, status] of profiles) {
  await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${project}/accounts`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, email, password: 'Fixture-password-123' }),
  });
  await env.withSecurityRulesDisabled((c) =>
    setDoc(doc(c.firestore(), 'users', uid), {
      uid,
      name: 'Fixture',
      email,
      role,
      status,
      permissions: { approveUsers: role === 'superadmin', addGames: role !== 'user', editGames: role !== 'user', deleteGames: role === 'superadmin' },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      version: 1,
      lastEventId: '',
    }),
  );
}
await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'settings', 'library'), { publicRead: true, version: 1, updatedAt: Timestamp.now(), lastEventId: '' }));
const backend = await workerFixture({ project, origin: base, initialFiles: [], enableKnowledge: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  errors = [];
const context = await browser.newContext({ serviceWorkers: 'block' });
context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
await context.route('**/config/app-config.js', (r) =>
  r.fulfill({
    contentType: 'text/javascript',
    body: `export const APP_CONFIG=${JSON.stringify({ firebase: { apiKey: 'fixture', authDomain: 'demo-acervo.firebaseapp.com', projectId: project, appId: '1:000:web:test' }, emulators: { auth: 'http://127.0.0.1:9099', host: '127.0.0.1', port: 8080 }, fileStorage: { apiBase: backend.apiBase }, enableGoogleLogin: false, maxPdfBytes: 209715200 })};`,
  }),
);
// Preparação automática real: OCR não é necessário nesta fixture com texto nativo.
await context.route('**/js/research-panel.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export function createResearchPanel(){return {reset(){},cancel(){},invalidate(){},run:async()=>{},runOcr:async()=>{},snapshot:()=>null}}' }));
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on('dialog', (d) => d.accept());
async function eventually(fn, predicate) {
  const end = Date.now() + 60000;
  let result;
  do {
    result = await fn();
    if (predicate(result)) return result;
    await new Promise((r) => setTimeout(r, 100));
  } while (Date.now() < end);
  throw new Error(`Estado não alcançado: ${JSON.stringify(result)}`);
}
async function records() {
  let games;
  await env.withSecurityRulesDisabled(async (c) => {
    games = (await getDocs(collection(c.firestore(), 'games'))).docs.map((d) => d.data());
  });
  return games;
}
async function api(p, id, input) {
  return p.evaluate(
    async ({ url, input }) => {
      const sdk = await import('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js');
      const token = await sdk.getAuth().currentUser?.getIdToken();
      const response = await fetch(url, { method: input ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(input ? { 'Content-Type': 'application/json' } : {}) }, body: input ? JSON.stringify(input) : undefined });
      return { status: response.status, data: await response.json() };
    },
    { url: `${backend.apiBase}/v1/games/${id}/knowledge`, input },
  );
}
async function pdf(name) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(name);
  for (let n = 1; n <= 2; n++) pdf.addPage([595, 842]).drawText(`Preparacao: distribua quatro cartas. PRIVATE_PDF_CANARY. Pagina ${n}`, { x: 40, y: 700, size: 12 });
  return { name: name + '.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}
async function add(name, description) {
  await page.locator('[data-add]').click();
  await page.locator('#pdf-file').setInputFiles(await pdf(name));
  await page.locator('#game-title').fill(name);
  await page.locator('[data-step-target="2"]').click();
  await page.locator('textarea[name=description]').fill(description);
  await page.locator('select[name=language]').selectOption('pt-BR');
  await page.locator('[data-step-target="3"]').click();
  await page.locator('[name=confirmed]').check();
  await page.locator('#save-game').click();
  await page.waitForFunction(() => !document.querySelector('#upload-dialog').open);
  return (await records()).find((g) => g.title === name);
}
try {
  console.log('QA IA: cadastro e geração automática');
  await page.goto(base);
  await page.locator('#login-form [name=email]').fill('owner@example.test');
  await page.locator('#login-form [name=password]').fill('Fixture-password-123');
  await page.locator('#login-submit').click();
  await page.waitForFunction(() => document.body.classList.contains('access-approved'));
  let release;
  backend.knowledge.faults.wait = new Promise((r) => {
    release = r;
  });
  const game = await add('Catan', 'Um resumo revisado com contexto para escolher o jogo. '.repeat(24));
  await eventually(
    () => backend.knowledge.calls.length,
    (n) => n === 1,
  );
  const peer = await context.newPage();
  await peer.goto(base);
  await peer.waitForFunction(() => document.body.classList.contains('access-approved'));
  const duplicates = await Promise.all([page, peer, page, peer].map((p) => api(p, game.id, { requestId: crypto.randomUUID() })));
  assert(duplicates.every((r) => r.status === 200));
  assert.equal(backend.knowledge.calls.length, 1);
  await peer.close();
  release();
  delete backend.knowledge.faults.wait;
  await eventually(
    () => api(page, game.id),
    (r) => r.data?.status === 'ready',
  );
  assert(!JSON.stringify(backend.knowledge.calls).includes('PRIVATE_PDF_CANARY'));
  console.log('QA IA: ficha, resumo e documentos');
  await page.locator('.card-main').click();
  assert.equal(await page.locator('[data-preparation-game]').count(), 0);
  assert.equal(await page.locator('#detail-admin > details').count(), 3);
  assert.equal(await page.locator('#guide-edit').count(), 0);
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['tablet', 768, 1024],
    ['mobile', 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator('#detail-description-toggle').waitFor();
    const before = await page.locator('#detail-cover').boundingBox();
    assert(await page.locator('#detail-description').evaluate((e) => e.clientHeight <= parseFloat(getComputedStyle(e).lineHeight) * 4 + 2));
    await page.locator('#detail-description-toggle').click();
    assert.equal(await page.locator('#detail-description-toggle').textContent(), 'Ver menos');
    const after = await page.locator('#detail-cover').boundingBox();
    assert(Math.abs(before.y - after.y) < 2);
    await page.locator('#detail-description-toggle').click();
    assert(await page.locator('#detail-dialog').evaluate((e) => e.scrollWidth <= e.clientWidth + 1));
    await page.screenshot({ path: `test-output/knowledge-detail-${name}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#detail-documents-disclosure > summary').click();
  assert.match(await page.locator('#detail-documents').textContent(), /Manual principal · Português · 2 páginas/);
  assert.equal(await page.locator('#detail-documents button, #detail-documents input').count(), 0);
  await page.locator('#learn-game').click();
  await page.locator('#guide-content').getByText('Este jogo ainda não tem um guia publicado.', { exact: true }).waitFor();
  assert.match(await page.locator('#guide-content').textContent(), /ainda não tem um guia publicado/);
  assert.equal(await page.locator('#guide-dialog [data-mutate]:visible').count(), 0);
  await page.locator('#guide-close').click();
  await page.locator('.card-main').click();
  await page.locator('#quick-rules').click();
  for (const term of ['decisões', 'participantes', 'desenvolvimento']) {
    await page.locator('#guide-search').fill(term);
    await page.locator('.rule-result').first().waitFor();
    assert.match(await page.locator('#guide-content').textContent(), /IA · não confirmado/);
  }
  await page.locator('#guide-close').click();
  assert.equal(backend.knowledge.calls.length, 1);
  await page.reload();
  await page.locator('.card-main').click();
  await page.locator('#quick-rules').click();
  await page.locator('#guide-search').fill('decisões');
  await page.locator('.rule-result').first().waitFor();
  assert.equal(backend.knowledge.calls.length, 1);
  await page.locator('#guide-close').click();
  console.log('QA IA: revisão, guia e atualização');
  await page.locator('.card-main').click();
  await openGameManagement(page, 'manage-information');
  await page.locator('#game-knowledge-admin').getByText('Sugestões para o cadastro', { exact: true }).click();
  await page.locator('[data-knowledge-field]').first().waitFor();
  await page.locator('#game-knowledge-admin').getByText('Selecionar todos', { exact: true }).click();
  await page.getByRole('button', { name: 'Usar campos selecionados', exact: true }).click();
  await page.locator('textarea[name=description]').waitFor();
  assert.match(await page.locator('textarea[name=description]').inputValue(), /decisões dos participantes/);
  for (const [field, value] of Object.entries({ minPlayers: '3', maxPlayers: '4', minDurationMinutes: '75', maxDurationMinutes: '75', recommendedAge: '10' })) assert.equal(await page.locator(`[name=${field}]`).inputValue(), value);
  await page.locator('[data-step-target="3"]').click();
  await page.locator('[name=confirmed]').check();
  await page.locator('#save-game').click();
  await page.waitForFunction(() => !document.querySelector('#upload-dialog').open);
  const updated = (await records()).find((g) => g.id === game.id);
  assert.equal(updated.minDurationMinutes, 75);
  assert.equal(updated.maxPlayers, 4);
  assert.match(updated.description, /decisões/);
  assert.equal(backend.knowledge.calls.length, 1, 'Editar dados não gera IA de novo.');
  await page.locator('.card-main').click();
  await openGameManagement(page, 'manage-information');
  await page.locator('[data-knowledge-section]').first().locator('summary').click();
  await page.locator('[data-knowledge-section] textarea').first().fill('Texto corrigido pelo administrador: decisões compartilhadas.');
  await page.locator('[data-knowledge-section]').nth(1).locator('summary').click();
  await page.locator('[data-knowledge-section] textarea').nth(1).fill('Segunda correção ainda não salva.');
  await page.getByRole('button', { name: 'Salvar revisão', exact: true }).first().click();
  await eventually(
    () => api(page, game.id),
    (r) => r.data.knowledge.sections[0].text.startsWith('Texto corrigido'),
  );
  await page.waitForFunction(() => !document.querySelector('[data-knowledge-section]').open);
  assert.equal(await page.locator('[data-knowledge-section] textarea').nth(1).inputValue(), 'Segunda correção ainda não salva.');
  await page.locator('[data-knowledge-section]').nth(1).locator('summary').click();
  await page.locator('[data-knowledge-section]').nth(1).getByRole('button', { name: 'Salvar revisão', exact: true }).click();
  await eventually(
    () => api(page, game.id),
    (r) => r.data.knowledge.sections[1].text === 'Segunda correção ainda não salva.',
  );
  await page.getByRole('button', { name: 'Atualizar conhecimento com IA', exact: true }).click();
  await eventually(
    () => api(page, game.id),
    (r) => r.data.status === 'ready',
  );
  assert.equal(backend.knowledge.calls.length, 2);
  assert.match((await api(page, game.id)).data.knowledge.sections[0].text, /Texto corrigido/);
  await openGameManagement(page, 'manage-guide');
  await page.locator('#edit-guide').click();
  assert.equal(await page.locator('#guide-analyze, #guide-ocr, #guide-translate').filter({ visible: true }).count(), 0);
  await page.getByRole('button', { name: 'Adicionar sugestões do conhecimento', exact: true }).click();
  assert.equal(await page.locator('.guide-editor-section').count(), 2);
  for (const checkbox of await page.locator('.guide-editor-section [name=reviewed]').all()) {
    assert.equal(await checkbox.isChecked(), false);
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Publicar guia', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#guide-status').textContent.includes('Guia publicado'));
  await page.locator('#guide-close').click();
  await page.locator('.card-main').click();
  await page.locator('#learn-game').click();
  await page.locator('.guide-section').first().waitFor();
  assert.match(await page.locator('#guide-content').textContent(), /Texto corrigido/);
  assert.equal(await page.locator('#guide-dialog [data-mutate]:visible').count(), 0);
  await page.locator('#guide-close').click();
  console.log('QA IA: indisponibilidade e privacidade');
  delete backend.configuration.GEMINI_API_KEY;
  const azul = await add('Azul', 'Resumo curto.');
  await eventually(
    () => api(page, azul.id),
    (r) => r.data?.status === 'pending_configuration',
  );
  assert.equal(backend.knowledge.calls.length, 2);
  await page.reload();
  await page.locator('.card-main').filter({ hasText: 'Azul' }).click();
  assert.equal(await page.locator('#detail-description-toggle').isVisible(), false);
  await page.keyboard.press('Escape');
  assert.equal(backend.knowledge.calls.length, 2);
  backend.configuration.GEMINI_API_KEY = 'fixture-gemini-secret';
  for (const fault of ['quota', 'network', 'invalid']) {
    await backend.knowledge.storage.put('quota', { day: new Date().toISOString().slice(0, 10), count: 0, recent: [] });
    backend.knowledge.faults[fault] = true;
    await api(page, game.id, { force: true, requestId: crypto.randomUUID() });
    const result = await eventually(
      () => api(page, game.id),
      (r) => r.data.status !== 'running',
    );
    assert.equal(result.data.status, fault === 'quota' ? 'quota' : 'attention');
    assert.match(result.data.knowledge.sections[0].text, /Texto corrigido/);
    delete backend.knowledge.faults[fault];
    const before = backend.knowledge.calls.length;
    await api(page, game.id, { requestId: crypto.randomUUID() });
    assert.equal(backend.knowledge.calls.length, before);
  }
  for (const email of ['reader@example.test', 'pending@example.test', 'subadmin@example.test']) {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route('**/config/app-config.js', async (r) =>
      r.fulfill({
        contentType: 'text/javascript',
        body: `export const APP_CONFIG=${JSON.stringify({ firebase: { apiKey: 'fixture', authDomain: 'demo-acervo.firebaseapp.com', projectId: project, appId: '1:000:web:test' }, emulators: { auth: 'http://127.0.0.1:9099', host: '127.0.0.1', port: 8080 }, fileStorage: { apiBase: backend.apiBase }, enableGoogleLogin: false, maxPdfBytes: 209715200 })};`,
      }),
    );
    const p = await ctx.newPage();
    await p.goto(base);
    await p.locator('#login-form [name=email]').fill(email);
    await p.locator('#login-form [name=password]').fill('Fixture-password-123');
    await p.locator('#login-submit').click();
    await p.waitForFunction(() => document.querySelector('#account-label').textContent === 'Minha conta');
    await eventually(
      () => api(p, game.id),
      (r) => r.status === (email.startsWith('pending') ? 403 : 200),
    );
    const status = (await api(p, game.id, { force: true, requestId: crypto.randomUUID() })).status;
    assert.equal(status, email.startsWith('subadmin') ? 202 : 403);
    await ctx.close();
  }
  assert.equal((await fetch(`${backend.apiBase}/v1/games/${game.id}/knowledge`)).status, 401);
  assert.deepEqual(errors, []);
  await writeFile(
    'test-output/gemini-browser-report.json',
    JSON.stringify(
      {
        providerSimulated: true,
        durableStorageSimulated: true,
        workerReal: true,
        firebaseEmulated: true,
        automaticAfterSave: true,
        concurrencyDeduplicated: true,
        persistedAfterReload: true,
        queriesWithoutNewCalls: true,
        reviewPreserved: true,
        unsavedSectionPreserved: true,
        selectedFieldsSaved: true,
        providerRequests: backend.knowledge.calls.length,
        guideReviewedSeparately: true,
        configurationQuotaNetworkInvalid: true,
        permissionCases: 4,
        viewports: 3,
        errors,
      },
      null,
      2,
    ),
  );
  console.log('Ficha e conhecimento persistido verificados no navegador.');
} catch (error) {
  console.log(
    'QA estado da ficha',
    await page.evaluate(() => ({ notice: document.querySelector('#notice-text')?.textContent, status: document.querySelector('.knowledge-status')?.textContent, guide: document.querySelector('#guide-status')?.textContent })),
  );
  throw error;
} finally {
  await browser.close();
  await backend.close();
  await env.cleanup();
}
