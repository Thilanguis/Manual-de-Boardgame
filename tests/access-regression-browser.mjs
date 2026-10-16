import '../scripts/test-guard.mjs';
// Firebase real nos emuladores; API de arquivos isolada. Nenhum dado de produção.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { workerFixture } from './worker-browser-fixture.mjs';
import { OWNER_UID } from '../js/permissions.js';
import { openGameManagement } from './game-ui-fixture.mjs';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Exige emuladores.');
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts } = require('pdf-lib');
const project = 'demo-acervo',
  id = '12345678-1234-1234-1234-123456789abc',
  base = process.env.ACERVO_TEST_URL || 'http://localhost:4174';
const env = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
await env.clearFirestore();
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${project}/accounts`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${project}/accounts`, {
  method: 'POST',
  headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
  body: JSON.stringify({ localId: OWNER_UID, email: 'owner@example.test', password: 'Fixture-password-123', displayName: 'Proprietário' }),
});
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.setTitle('Ilha Privada');
for (let n = 1; n <= 3; n++) {
  const page = pdf.addPage([595, 842]);
  page.drawText('Ilha Privada', { x: 40, y: 740, size: 24, font });
  page.drawText(n === 3 ? 'Navegacao: coloque quatro cartas no centro da mesa e avance uma casa.' : 'Preparacao: distribua todas as cartas e coloque as fichas na mesa.', { x: 40, y: 650, size: 12, font });
}
pdf.context.register(pdf.context.stream(new Uint8Array(1024 * 1024), { BoundaryFixture: true }));
const bytes = Buffer.from(await pdf.save({ useObjectStreams: false })),
  hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore(),
    stamp = Timestamp.now();
  await setDoc(doc(db, 'users', OWNER_UID), {
    uid: OWNER_UID,
    name: 'Proprietário',
    email: 'owner@example.test',
    role: 'superadmin',
    status: 'approved',
    permissions: { approveUsers: true, addGames: true, editGames: true, deleteGames: true },
    createdAt: stamp,
    updatedAt: stamp,
    version: 1,
    lastEventId: '',
  });
  await setDoc(doc(db, 'games', id), {
    id,
    title: 'Ilha Privada',
    description: '',
    minPlayers: null,
    maxPlayers: null,
    durationMinutes: null,
    tags: [],
    language: 'pt-BR',
    manual: { path: `games/${id}/manual.pdf`, name: 'Ilha Privada.pdf', type: 'application/pdf', size: bytes.length, pages: 3, sha256: hash, storage: 'drive', driveFileId: 'manual-private' },
    cover: {},
    sources: {},
    createdAt: stamp,
    updatedAt: stamp,
    createdBy: OWNER_UID,
    schemaVersion: 1,
    isPublic: true,
    deleting: false,
  });
  await setDoc(doc(db, 'settings', 'library'), { publicRead: true, version: 1, updatedAt: stamp, lastEventId: '' });
});
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  errors = [],
  requests = [],
  contexts = [],
  files = new Map(),
  uploads = new Map();
async function inspect(path) {
  let result;
  await env.withSecurityRulesDisabled(async (c) => {
    result = (await getDoc(doc(c.firestore(), ...path.split('/')))).data();
  });
  return result;
}
const imagePage = await browser.newPage();
const jpeg = Buffer.from(
  await imagePage.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 360;
    const x = c.getContext('2d');
    x.fillStyle = '#8c1728';
    x.fillRect(0, 0, 240, 360);
    x.fillStyle = 'white';
    x.font = '24px sans-serif';
    x.fillText('Ilha Privada', 35, 100);
    return c.toDataURL('image/jpeg').split(',')[1];
  }),
  'base64',
);
await imagePage.close();
const extraPdf = await PDFDocument.load(bytes);
extraPdf.addPage([595, 842]).drawText('TravessiaExtra: avance as fichas ate o porto para concluir a navegacao.', { x: 40, y: 700, size: 12 });
const extraBytes = Buffer.from(await extraPdf.save({ useObjectStreams: false })),
  extraHash = Buffer.from(await crypto.subtle.digest('SHA-256', extraBytes)).toString('hex'),
  extraId = '22345678-1234-1234-1234-123456789abc';
const backend = await workerFixture({
  project,
  origin: base,
  initialFiles: [
    ['manual-private', { bytes, name: 'Ilha Privada.pdf', appProperties: { acervoProject: project, gameId: id, kind: 'manual' } }],
    ['cover-private', { bytes: jpeg, name: 'Ilha Privada.jpg', mimeType: 'image/jpeg', appProperties: { acervoProject: project, gameId: id, kind: 'cover' } }],
    ['extra-private', { bytes: extraBytes, name: 'Referencia.pdf', appProperties: { acervoProject: project, gameId: id, kind: 'document', documentId: extraId, sourceHash: extraHash } }],
  ],
});
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  const game = (await getDoc(doc(db, 'games', id))).data();
  await updateDoc(doc(db, 'games', id), {
    cover: { driveFileId: 'cover-private', storage: 'drive', path: `games/${id}/cover.jpg` },
    documents: {
      main: { id: 'main', name: 'Manual principal', documentType: 'principal', language: 'pt-BR', edition: '', manual: game.manual },
      [extraId]: {
        id: extraId,
        name: 'Referencia',
        documentType: 'referencia',
        language: 'pt-BR',
        edition: '',
        manual: { ...game.manual, path: `games/${id}/documents/${extraId}.pdf`, driveFileId: 'extra-private', sha256: extraHash, size: extraBytes.length, pages: 4 },
      },
    },
    primaryDocumentId: 'main',
    documentChanges: ['main', extraId],
  });
});
async function page() {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  contexts.push(context);
  await context.route('**/config/app-config.js', (r) =>
    r.fulfill({
      contentType: 'text/javascript',
      body: `export const APP_CONFIG=${JSON.stringify({ firebase: { apiKey: 'demo-key', authDomain: 'demo-acervo.firebaseapp.com', projectId: project, appId: '1:000:web:test' }, emulators: { auth: 'http://127.0.0.1:9099', host: '127.0.0.1', port: 8080 }, fileStorage: { apiBase: backend.apiBase }, enableGoogleLogin: false, maxPdfBytes: 209715200 })};`,
    }),
  );
  await context.addInitScript(() => {
    window.authModals = [];
    const original = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function (...args) {
      if (this.id === 'login-dialog') window.authModals.push(document.getElementById('login-title').textContent);
      return original.apply(this, args);
    };
  });
  const p = await context.newPage();
  p.on('pageerror', (error) => errors.push(error.message));
  await p.goto(base);
  await p.locator('#login-dialog').waitFor();
  await p.waitForFunction(() => !document.getElementById('login-submit').disabled);
  return p;
}
async function login(p, email) {
  await p.locator('#login-form [name=email]').fill(email);
  await p.locator('#login-form [name=password]').fill('Fixture-password-123');
  await p.locator('#login-submit').click();
}
try {
  console.log('QA visitante');
  const guest = await page();
  assert.equal(await guest.locator('main').isVisible(), false);
  assert.equal(await guest.locator('.game-card').count(), 0);
  assert.equal(backend.calls.filter((c) => c.path.startsWith('/v1/')).length, 0);
  await guest.goto(`${base}/?local=1`);
  await guest.locator('#login-dialog').waitFor();
  assert.equal(await guest.locator('main').isVisible(), false, 'Parâmetro local não contorna autenticação.');
  await guest.locator('[data-auth-view=register]').click();
  for (const [name, value] of Object.entries({ name: 'Leitor', email: 'reader@example.test', password: 'Fixture-password-123', confirmation: 'Fixture-password-123' })) await guest.locator(`#register-form [name=${name}]`).fill(value);
  await guest.locator('#register-submit').click();
  await guest.waitForFunction(() => !document.getElementById('session-info').hidden && document.getElementById('session-uid').value && document.getElementById('profile-status').textContent === 'Aguardando aprovação');
  assert.equal(await guest.locator('main').isVisible(), false);
  assert.equal(await guest.locator('.game-card').count(), 0);
  assert.match(await guest.locator('#session-status').textContent(), /aguardando aprovação/);
  const readerUid = await guest.locator('#session-uid').inputValue();
  assert.equal((await inspect(`users/${readerUid}`)).status, 'pending');
  const pendingStatuses = await guest.evaluate(
    async ({ api, id, extraId }) => {
      const sdk = await import('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js');
      const token = await sdk.getAuth().currentUser.getIdToken();
      return Promise.all([`/v1/games/${id}/manual`, `/v1/games/${id}/cover`, `/v1/games/${id}/documents/${extraId}/pdf`].map(async (path) => (await fetch(api + path, { headers: { Authorization: 'Bearer ' + token } })).status));
    },
    { api: backend.apiBase, id, extraId },
  );
  assert.deepEqual(pendingStatuses, [403, 403, 403]);
  console.log('QA proprietario');
  const owner = await page();
  await login(owner, 'owner@example.test');
  await owner.locator('#manage-button').waitFor({ state: 'visible' });
  console.log('QA restaurar sessao');
  await owner.reload();
  await owner.locator('.game-card').waitFor();
  assert.deepEqual(await owner.evaluate(() => window.authModals), [], 'Restauração de sessão não pode abrir login ou Minha conta.');
  await owner.waitForFunction(() => document.querySelector('.game-card img')?.naturalWidth > 0);
  assert.equal(await owner.locator('#preparation-warning').isVisible(), false);
  await owner.locator('#manage-button').waitFor({ state: 'visible' });
  console.log('QA falha cache');
  await owner.context().route('**/documents/cacheKeys/**', (r) => r.fulfill({ status: 403, json: { error: { message: 'fixture cache denied' } } }));
  console.log('QA restaurar sessao');
  await owner.reload();
  await owner.locator('.game-card').waitFor();
  assert.equal(await owner.locator('#preparation-warning').isVisible(), false);
  assert.equal(await owner.locator('main #preparation-warning').count(), 0);
  assert.deepEqual(await owner.evaluate(() => window.authModals), []);
  await owner.locator('#account-button').click();
  await owner.locator('#preparation-warning > summary').click();
  assert.equal(await owner.locator('#preparation-warning').isVisible(), true);
  assert.match(await owner.locator('#preparation-diagnostic').textContent(), /403/);
  await owner.context().unroute('**/documents/cacheKeys/**');
  await owner.locator('#retry-preparation').click();
  await owner.waitForFunction(() => document.querySelector('#preparation-warning').hidden);
  await owner.keyboard.press('Escape');
  console.log('QA aprovar');
  await owner.locator('#manage-button').click();
  await owner.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await guest.locator('.game-card').waitFor();
  assert.equal(await guest.locator('#login-dialog').isVisible(), false);
  assert.equal(await guest.locator('[data-add]').first().isVisible(), false);
  await owner.keyboard.press('Escape');
  console.log('QA preparacao');
  const deadline = Date.now() + 90000;
  while (!(await inspect(`games/${id}/indexes/main`)) || !(await inspect(`games/${id}/indexes/${extraId}`))) {
    if (Date.now() > deadline) throw new Error('Índice não foi persistido no Firestore.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await inspect(`guideDrafts/${id}`), undefined, 'Preparação automática não depende de rascunho.');
  console.log('QA leitor');
  const fresh = await page();
  await login(fresh, 'reader@example.test');
  await fresh.locator('.card-main').click();
  await fresh.locator('#quick-rules').click();
  await fresh.locator('#guide-search').fill('Navegacao');
  await fresh.locator('.rule-result').first().waitFor();
  await fresh.locator('.rule-result button').first().click();
  await fresh.waitForFunction(() => document.getElementById('page-number').value === '3');
  await fresh.locator('#reader-close').click();
  await fresh.locator('.card-main').click();
  await fresh.waitForFunction(() => document.querySelector('#hero-backdrop').style.backgroundImage.includes('blob:'));
  assert.ok(
    await fresh.evaluate(async () => {
      const value = document.querySelector('#hero-backdrop').style.backgroundImage;
      const url = JSON.parse(value.slice(4, -1));
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const good = bitmap.width > 0;
      bitmap.close();
      return good;
    }),
  );
  await fresh.waitForFunction(() => document.querySelector('#detail-cover').naturalWidth > 0 && !document.querySelector('#detail-cover').hidden);
  await fresh.locator('#detail-documents-disclosure > summary').click();
  await fresh.locator('.document-reading-row').filter({ hasText: 'Referencia' }).getByRole('button', { name: 'Ler documento' }).click();
  await fresh.waitForFunction(() => document.querySelector('#page-total').textContent.includes('4') && !document.querySelector('#reader-status').textContent);
  await fresh.locator('#reader-close').click();
  await fresh.locator('.card-main').click();
  await fresh.locator('#learn-game').click();
  await fresh.waitForFunction(() => document.querySelector('#guide-content').textContent.includes('ainda não tem um guia publicado'));
  await fresh.locator('#guide-close').click();
  await env.withSecurityRulesDisabled((c) =>
    setDoc(doc(c.firestore(), 'gameGuides', id), {
      gameId: id,
      schemaVersion: 1,
      revision: 1,
      sourceHash: hash,
      assets: {},
      indexFileId: '',
      reviewed: true,
      content: JSON.stringify([
        { id: '33333333-3333-3333-3333-333333333333', title: 'Preparação revisada', text: 'Distribua as cartas conforme a página do manual.', type: 'texto', page: 1, documentId: 'main', sourceHash: hash, reviewed: true, language: 'pt-BR' },
      ]),
      updatedAt: Timestamp.now(),
      updatedBy: OWNER_UID,
    }),
  );
  await fresh.locator('.card-main').click();
  await fresh.locator('#learn-game').click();
  await fresh.waitForFunction(() => document.querySelector('#guide-content').textContent.includes('Preparação revisada'));
  await fresh.locator('#guide-close').click();
  assert.ok(
    backend.calls.some((c) => c.range && c.status === 206),
    'PDF.js deve ler com Range pelo Worker real.',
  );
  assert.ok(
    backend.calls.filter((c) => c.path.endsWith('/cover')).every((c) => !c.hashHeader),
    'Capas não devem enviar cabeçalho de hash do PDF.',
  );
  for (const path of [`/v1/games/${id}/manual`, `/v1/games/${id}/cover`, `/v1/games/${id}/documents/${extraId}/pdf`]) assert.equal((await fetch(backend.apiBase + path)).status, 401);
  const modifyStatus = await fresh.evaluate(
    async ({ api, id }) => {
      const sdk = await import('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js');
      const token = await sdk.getAuth().currentUser.getIdToken();
      return (
        await fetch(api + '/v1/uploads', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameId: id, kind: 'manual', size: 10, mimeType: 'application/pdf', name: 'invalid.pdf' }),
        })
      ).status;
    },
    { api: backend.apiBase, id },
  );
  assert.equal(modifyStatus, 403);
  console.log('QA offline');
  await fresh.context().setOffline(true);
  await fresh.locator('#login-dialog').waitFor();
  assert.equal(await fresh.locator('main').isVisible(), false);
  assert.equal(
    await fresh.evaluate(async () => {
      const { privateValue } = await import('/js/private-cache.js');
      return privateValue('sample');
    }),
    null,
  );
  await fresh.context().setOffline(false);
  await fresh.locator('.card-main').waitFor();
  await fresh.locator('.card-main').click();
  await fresh.locator('#read-manual').click();
  await fresh.waitForFunction(() => document.getElementById('page-total').textContent.includes('3'));
  await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), 'users', readerUid), { status: 'blocked', updatedAt: Timestamp.now() }));
  await fresh.locator('#login-dialog').waitFor();
  await fresh.waitForFunction(() => document.getElementById('reader').hidden && document.querySelectorAll('.game-card').length === 0);
  assert.equal(await fresh.locator('main').isVisible(), false);
  assert.equal(await fresh.locator('#pdf-text').textContent(), '');
  let remaining = 1;
  for (let n = 0; n < 100 && remaining; n++) {
    remaining = await fresh.evaluate(
      async () =>
        new Promise((resolve) => {
          const r = indexedDB.open('acervo-private-v1');
          r.onsuccess = () => {
            const q = r.result.transaction('entries').objectStore('entries').count();
            q.onsuccess = () => resolve(q.result);
          };
        }),
    );
    if (remaining) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(remaining, 0, 'Cache privado deve ser esvaziado após bloqueio.');
  console.log('QA fim');
  await owner.locator('#account-button').click();
  assert.equal(await owner.locator('#profile-role').textContent(), 'Administrador principal');
  await owner.keyboard.press('Escape');
  const originalCount = backend.files.size;
  const remove = () =>
    owner.evaluate(
      async ({ api, id, extraId }) => {
        const sdk = await import('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js');
        const token = await sdk.getAuth().currentUser.getIdToken();
        return (await fetch(`${api}/v1/games/${id}/documents/${extraId}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } })).status;
      },
      { api: backend.apiBase, id, extraId },
    );
  backend.faults.commit = 503;
  assert.equal(await remove(), 503);
  assert.ok((await inspect(`games/${id}`)).documents[extraId]);
  assert.equal(backend.files.size, originalCount);
  delete backend.faults.commit;
  backend.faults.delete = 1;
  assert.equal(await remove(), 502);
  assert.equal((await inspect(`games/${id}`)).documents[extraId], undefined);
  assert.ok(await inspect(`games/${id}/removals/${extraId}`));
  assert.ok(backend.files.has('extra-private'));
  const wholeGameStatus = await owner.evaluate(
    async ({ api, id }) => {
      const sdk = await import('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js');
      const token = await sdk.getAuth().currentUser.getIdToken();
      return (await fetch(`${api}/v1/games/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } })).status;
    },
    { api: backend.apiBase, id },
  );
  assert.equal(wholeGameStatus, 409);
  assert.ok(backend.files.has('manual-private'));

  await owner.locator('.card-main').click();
  await openGameManagement(owner, 'manage-documents-section');
  await owner.getByRole('button', { name: 'Concluir remoções', exact: true }).click();
  await owner.waitForFunction(() => !Array.from(document.querySelectorAll('#manage-documents button')).some((b) => b.textContent === 'Concluir remoções'));
  assert.equal(await inspect(`games/${id}/removals/${extraId}`), undefined);
  assert.ok(backend.files.has('manual-private'));
  assert.ok(backend.files.has('cover-private'));
  assert.ok(!backend.files.has('extra-private'));
  assert.ok(await inspect(`games/${id}/indexes/main`));
  assert.ok(await inspect(`gameGuides/${id}`));
  await owner.locator('#read-manual').click();
  await owner.waitForFunction(() => document.querySelector('#page-total').textContent.includes('3') && !document.querySelector('#reader-status').textContent);
  await owner.locator('#reader-close').click();
  await owner.reload();
  await owner.locator('.game-card').waitFor();
  await owner.locator('.card-main').click();
  await owner.waitForFunction(() => document.querySelector('#detail-cover').naturalWidth > 0 && !document.querySelector('#detail-cover').hidden);
  assert.equal(await owner.locator('#detail-documents').getByRole('button', { name: 'Ler documento' }).count(), 0, 'Um PDF não duplica o botão principal.');
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['tablet', 768, 1024],
    ['mobile', 390, 844],
  ]) {
    await owner.setViewportSize({ width, height });
    assert.ok(await owner.evaluate(() => document.querySelector('#detail-dialog').scrollWidth <= document.querySelector('#detail-dialog').clientWidth + 1));
    await owner.screenshot({ path: `test-output/details-regression-${name}.png` });
  }
  await owner.keyboard.press('Escape');
  backend.faults.legacy = true;
  await owner.reload();
  await owner.locator('.game-card').waitFor();
  assert.deepEqual(await owner.evaluate(() => window.authModals), []);
  await owner.waitForFunction(() => document.querySelector('.game-card img')?.naturalWidth > 0);
  await owner.locator('.card-main').click();
  await owner.locator('#read-manual').click();
  await owner.waitForFunction(() => document.querySelector('#page-total').textContent.includes('3') && !document.querySelector('#reader-status').textContent);
  assert.ok(backend.calls.some((c) => c.path === `/v1/games/${id}/manual` && c.status === 206 && !c.hashHeader));
  await owner.locator('#reader-close').click();
  delete backend.faults.legacy;
  await owner.locator('#account-button').click();
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['tablet', 768, 1024],
    ['mobile', 390, 844],
  ]) {
    await fresh.setViewportSize({ width, height });
    assert(await fresh.evaluate(() => document.getElementById('login-dialog').scrollWidth <= document.getElementById('login-dialog').clientWidth + 1));
    await mkdir('test-output', { recursive: true });
    await fresh.screenshot({ path: `test-output/access-regression-${name}.png` });
  }
  await owner.locator('#logout-button').click();
  await owner.locator('#login-form').waitFor();
  assert.equal(await owner.locator('main').isVisible(), false);
  assert.equal(await owner.locator('.game-card').count(), 0);
  assert.deepEqual(errors, []);
  await writeFile(
    'test-output/access-regression-report.json',
    JSON.stringify(
      {
        anonymousDenied: true,
        localBypassDenied: true,
        pendingDenied: true,
        ownerApproved: true,
        restoredWithoutAccountFlash: true,
        coversVisible: true,
        heroImageVisible: true,
        complementaryPDF: true,
        publishedGuide: true,
        cacheFailureVisibleAndRecovered: true,
        actualAuthenticatedRange: true,
        actualWorkerWithEmulators: true,
        legacyWorkerAuthenticatedRead: true,
        safeRemovalAndRetry: true,
        singlePDFWithoutDuplicateButton: true,
        approvedReadPDF: true,
        sharedQuickIndexWithoutGuide: true,
        blockedSessionClosed: true,
        cachePurged: true,
        offlineLockedAndRecovered: true,
        ownerPreserved: true,
        logout: true,
        viewports: 3,
        errors,
      },
      null,
      2,
    ),
  );
  console.log('Acervo privado: visitante, cadastro pendente, aprovação, leitura, índice compartilhado, bloqueio ao vivo, cache, logout e proprietário verificados no navegador.');
} finally {
  console.log('QA closing browser');
  await browser.close();
  console.log('QA closing backend');
  await backend.close();
  await env.cleanup();
}
