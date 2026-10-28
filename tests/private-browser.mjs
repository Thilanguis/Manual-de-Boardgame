import '../scripts/test-guard.mjs';
// Firebase real nos emuladores; API de arquivos isolada. Nenhum dado de produção.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { OWNER_UID } from '../js/permissions.js';
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
const bytes = Buffer.from(await pdf.save()),
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
async function page() {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  contexts.push(context);
  await context.route('**/config/app-config.js', (r) =>
    r.fulfill({
      contentType: 'text/javascript',
      body: `export const APP_CONFIG=${JSON.stringify({ firebase: { apiKey: 'demo-key', authDomain: 'demo-acervo.firebaseapp.com', projectId: project, appId: '1:000:web:test' }, emulators: { auth: 'http://127.0.0.1:9099', host: '127.0.0.1', port: 8080 }, fileStorage: { apiBase: 'http://127.0.0.1:8789' }, enableGoogleLogin: false, maxPdfBytes: 209715200 })};`,
    }),
  );
  await context.route('http://127.0.0.1:8789/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      authorization = request.headers().authorization;
    if (path === '/health') return route.fulfill({ json: { ok: true, diagnosticsProtocol: 1, fileProtocol: 2, privateAccess: true, documentRemovalProtocol: 2, maxPdfBytes: 209715200 } });
    let uid;
    try {
      uid = JSON.parse(Buffer.from(authorization.split(' ')[1].split('.')[1], 'base64url')).sub;
    } catch {}
    const profile = uid && (await inspect(`users/${uid}`));
    requests.push({ path, uid, status: profile?.status });
    if (!profile || profile.status !== 'approved') return route.fulfill({ status: uid ? 403 : 401, json: { error: 'Acesso não autorizado.' } });
    if (path === '/v1/admin/health') return uid !== OWNER_UID ? route.fulfill({ status: 403, json: { error: 'Somente administrador.' } }) : route.fulfill({ json: { checkedAt: Date.now(), firebase: { state: 'operational', verified: true }, drive: { state: 'operational', configured: true, verified: true }, gemini: { state: 'configured', configured: true, verified: false } } });
    if (path === '/v1/catalog/status') return route.fulfill({ json: { games: [{ id, available: true, reason: 'available' }] } });
    if (path === '/v1/uploads') {
      const input = request.postDataJSON(),
        ticket = crypto.randomUUID();
      uploads.set(ticket, { ...input, id: `index-${crypto.randomUUID()}` });
      return route.fulfill({ json: { ticket, received: 0 } });
    }
    if (path === '/v1/uploads/chunk') {
      const upload = uploads.get(request.headers()['x-upload-ticket']);
      files.set(upload.id, request.postDataBuffer());
      return route.fulfill({ json: { complete: true, driveFileId: upload.id, receipt: upload.id, received: upload.size } });
    }
    if (path === '/v1/uploads/finalize' || path === '/v1/uploads/discard') return route.fulfill({ json: { ok: true } });
    if (path.endsWith('/pdf') || path.endsWith('/manual')) return route.fulfill({ contentType: 'application/pdf', body: bytes, headers: { 'Cache-Control': 'no-store' } });
    if (path.endsWith('/index')) {
      const index = await inspect(`games/${id}/indexes/main`);
      return route.fulfill({ contentType: 'application/gzip', body: files.get(index.fileId), headers: { 'Cache-Control': 'no-store' } });
    }
    if (path === '/v1/research/sources') return route.fulfill({ json: { sources: [] } });
    return route.fulfill({ status: 404, json: { error: 'Sem fixture para esta operação.' } });
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
  const guest = await page();
  assert.equal(await guest.locator('main').isVisible(), false);
  assert.equal(await guest.locator('.game-card').count(), 0);
  assert.equal(requests.length, 0);
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
  const owner = await page();
  await login(owner, 'owner@example.test');
  await owner.locator('#manage-button').waitFor({ state: 'visible' });
  await owner.locator('#manage-button').click();
  await owner.locator('[data-admin-tab=settings]').click();
  await owner.locator('#admin-health-disclosure > summary').click();
  await owner.waitForFunction(() => document.querySelectorAll('#admin-health [data-health-state=operational]').length === 2);
  assert.equal(requests.filter(request => request.path === '/v1/admin/health').length, 1, 'diagnóstico verifica uma vez ao abrir');
  assert.match(await owner.locator('#admin-health').textContent(), /Configurado · não testado/);
  await owner.locator('[data-admin-tab=requests]').click();
  await owner.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await guest.locator('.game-card').waitFor();
  assert.equal(await guest.locator('#login-dialog').isVisible(), false);
  assert.equal(await guest.locator('[data-add]').first().isVisible(), false);
  await owner.keyboard.press('Escape');
  const deadline = Date.now() + 90000;
  while (!(await inspect(`games/${id}/indexes/main`))) {
    if (Date.now() > deadline) throw new Error('Índice não foi persistido no Firestore.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await inspect(`guideDrafts/${id}`), undefined, 'Preparação automática não depende de rascunho.');
  const fresh = await page();
  await login(fresh, 'reader@example.test');
  await fresh.locator('.card-main').click();
  await fresh.locator('#quick-rules').click();
  await fresh.locator('#guide-search').fill('Navegacao');
  await fresh.locator('.rule-result').waitFor();
  await fresh.locator('.rule-result button').first().click();
  await fresh.waitForFunction(() => document.getElementById('page-number').value === '3');
  await fresh.locator('#reader-close').click();
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
  assert.equal(await fresh.locator('#reader .textLayer').count(), 0, 'texto de todas as páginas removido após bloqueio');
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
  await owner.locator('#account-button').click();
  assert.equal(await owner.locator('#profile-role').textContent(), 'Administrador principal');
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['tablet', 768, 1024],
    ['mobile', 390, 844],
  ]) {
    await fresh.setViewportSize({ width, height });
    assert(await fresh.evaluate(() => document.getElementById('login-dialog').scrollWidth <= document.getElementById('login-dialog').clientWidth + 1));
    await mkdir('test-output', { recursive: true });
    await fresh.screenshot({ path: `test-output/private-${name}.png` });
  }
  await owner.keyboard.press('Escape');
  await owner.locator('.card-favorite').first().click();
  await owner.locator('.card-main').first().click();
  await owner.locator('#read-manual').click();
  await owner.waitForFunction(() => document.getElementById('page-total').textContent.includes('3'));
  await owner.locator('#page-number').fill('2');
  await owner.locator('#page-number').press('Enter');
  await owner.locator('#reader-close').click();
  if (await owner.locator('[data-close=detail-dialog]').isVisible()) await owner.locator('[data-close=detail-dialog]').click();
  await owner.locator('#account-button').click();
  await owner.locator('#logout-button').click();
  await owner.locator('#login-form').waitFor();
  assert.equal(await owner.locator('main').isVisible(), false);
  assert.equal(await owner.locator('.game-card').count(), 0);
  const favoriteKey = `acervo:firebase:${project}:${OWNER_UID}:favorites`, readingKey = `acervo:firebase:${project}:${OWNER_UID}:reading`;
  assert.deepEqual(await owner.evaluate(key => JSON.parse(localStorage.getItem(key)), favoriteKey), [id]);
  assert.equal((await owner.evaluate(key => JSON.parse(localStorage.getItem(key)), readingKey))[id].page, 2);
  await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'users', readerUid), { status: 'approved', updatedAt: Timestamp.now() }));
  await login(owner, 'reader@example.test');
  await owner.locator('.game-card').waitFor();
  assert.equal(await owner.locator('.card-favorite').first().getAttribute('aria-pressed'), 'false', 'outra conta não herda favoritos');
  assert.equal(await owner.locator('#recent-list > *').count(), 0, 'outra conta não herda progresso');
  await owner.locator('#account-button').click();
  await owner.locator('#logout-button').click();
  await owner.locator('#login-form').waitFor();
  await login(owner, 'owner@example.test');
  await owner.locator('.game-card').waitFor();
  assert.equal(await owner.locator('.card-favorite').first().getAttribute('aria-pressed'), 'true');
  await owner.locator('.card-main').first().click();
  await owner.locator('#read-manual').click();
  await owner.waitForFunction(() => document.getElementById('page-number').value === '2' && document.getElementById('reader-status').hidden);
  await owner.locator('#reader-close').click();
  assert.deepEqual(errors, []);
  await writeFile(
    'test-output/private-report.json',
    JSON.stringify(
      {
        anonymousDenied: true,
        localBypassDenied: true,
        pendingDenied: true,
        ownerApproved: true,
        approvedReadPDF: true,
        sharedQuickIndexWithoutGuide: true,
        blockedSessionClosed: true,
        cachePurged: true,
        offlineLockedAndRecovered: true,
        ownerPreserved: true,
        logout: true,
        favoritesAndProgressSurviveLogout: true,
        preferencesIsolatedByAccount: true,
        administrativeHealthPanel: true,
        viewports: 3,
        errors,
      },
      null,
      2,
    ),
  );
  console.log('Acervo privado: visitante, cadastro pendente, aprovação, leitura, índice compartilhado, bloqueio ao vivo, cache, logout e proprietário verificados no navegador.');
} finally {
  await browser.close();
  await env.cleanup();
}
