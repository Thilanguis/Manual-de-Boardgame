// Somente Auth/Firestore emulados e perfis descartáveis. Não cria contas reais.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { OWNER_UID } from '../js/permissions.js';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Este teste exige os dois emuladores locais.');
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
const projectId = 'demo-acervo',
  base = process.env.ACERVO_TEST_URL || 'http://localhost:4174';
const gameId = '12345678-1234-1234-1234-123456789abc';
let driveAvailable = true,
  driveFailure = false;
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
await env.clearFirestore();
const ownerAccount = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts`, {
  method: 'POST',
  headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
  body: JSON.stringify({ localId: OWNER_UID, email: 'owner@example.test', password: 'Fixture-password-123', displayName: 'Proprietário de teste' }),
});
assert.equal(ownerAccount.status, 200);
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore(),
    stamp = Timestamp.fromMillis(Date.now());
  await setDoc(doc(db, 'users', OWNER_UID), {
    uid: OWNER_UID,
    name: 'Proprietário de teste',
    email: 'owner@example.test',
    status: 'approved',
    role: 'superadmin',
    permissions: { approveUsers: true, addGames: true, editGames: true, deleteGames: true },
    createdAt: stamp,
    updatedAt: stamp,
    version: 1,
    lastEventId: '',
  });
  await setDoc(doc(db, 'settings', 'library'), { publicRead: true, version: 1, updatedAt: stamp, lastEventId: '' });
  await setDoc(doc(db, 'games', gameId), {
    id: gameId,
    title: 'Manual de teste',
    description: '',
    minPlayers: null,
    maxPlayers: null,
    durationMinutes: null,
    tags: [],
    language: 'pt',
    manual: { path: `games/${gameId}/manual.pdf`, name: 'manual.pdf', type: 'application/pdf', size: 100, pages: 1, sha256: 'a'.repeat(64), storage: 'drive', driveFileId: 'manual123' },
    cover: {},
    sources: {},
    createdAt: stamp,
    updatedAt: stamp,
    createdBy: OWNER_UID,
    schemaVersion: 1,
    isPublic: true,
    deleting: false,
  });
});
await mkdir('test-output', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  contexts = [],
  errors = [];
async function page() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  contexts.push(context);
  await context.route('**/config/app-config.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export const APP_CONFIG=${JSON.stringify({ firebase: { apiKey: 'demo-api-key', authDomain: 'demo-acervo.firebaseapp.com', projectId, appId: '1:000:web:test' }, fileStorage: { provider: 'drive', apiBase: 'https://api.example.test' }, emulators: { auth: 'http://127.0.0.1:9099', host: '127.0.0.1', port: 8080 }, enableBgg: false, maxPdfBytes: 52428800 })};`,
    }),
  );
  await context.route('https://api.example.test/v1/catalog/status', (route) =>
    route.fulfill({
      status: driveFailure ? 502 : 200,
      contentType: 'application/json',
      body: JSON.stringify(driveFailure ? { error: 'Falha transitória de teste' } : { games: [{ id: gameId, available: driveAvailable, reason: driveAvailable ? 'available' : 'trashed' }] }),
    }),
  );
  const p = await context.newPage();
  p.on('pageerror', (error) => errors.push(error.message));
  await p.goto(base);
  await p.waitForFunction(() => document.getElementById('connection-status').textContent.includes('leitura pública'));
  return p;
}
async function signup(p, name, email) {
  await p.locator('#account-button').click();
  await p.locator('[data-auth-view=register]').click();
  const form = p.locator('#register-form');
  await form.locator('[name=name]').fill(name);
  await form.locator('[name=email]').fill(email);
  await form.locator('[name=password]').fill('Fixture-password-123');
  await form.locator('[name=confirmation]').fill('Fixture-password-123');
  await p.locator('#register-submit').click();
  await p.waitForFunction(() => document.getElementById('notice-text').textContent === 'Conta criada! Aguarde a aprovação de um administrador.');
}
try {
  const guest = await page();
  await guest.waitForFunction(() => document.querySelectorAll('.game-card').length === 1);
  driveFailure = true;
  await guest.locator('#refresh-library').click();
  await guest.waitForFunction(() => document.getElementById('notice-text').textContent.includes('Falha transitória'));
  assert.equal(await guest.locator('.game-card').count(), 1);
  driveFailure = false;
  driveAvailable = false;
  await guest.locator('#refresh-library').click();
  await guest.waitForFunction(() => document.querySelectorAll('.game-card').length === 0);
  assert.equal(await guest.locator('#unavailable-games').isVisible(), false);
  const owner = await page();
  await owner.locator('#account-button').click();
  await owner.locator('#login-form [name=email]').fill('owner@example.test');
  await owner.locator('#login-form [name=password]').fill('Fixture-password-123');
  await owner.locator('#login-submit').click();
  await owner.locator('#manage-button').waitFor({ state: 'visible' });
  await owner.locator('#unavailable-games').waitFor({ state: 'visible' });
  await owner.getByRole('button', { name: 'Gerenciar cadastro' }).click();
  assert.equal(await owner.locator('#read-manual').isDisabled(), true);
  assert.equal(await owner.locator('#delete-game').isVisible(), true);
  driveAvailable = true;
  await owner.evaluate(() => window.dispatchEvent(new Event('focus')));
  await owner.waitForFunction(() => !document.getElementById('read-manual').disabled);
  assert.match(await owner.locator('#detail-manual').textContent(), /páginas/);
  await owner.locator('[data-close=detail-dialog]').click();
  await guest.locator('#refresh-library').click();
  await guest.waitForFunction(() => document.querySelectorAll('.game-card').length === 1);
  assert.equal(await owner.locator('#unavailable-games').isVisible(), false);
  await owner.locator('#manage-button').click();
  const applicant = await page();
  assert.equal(await applicant.locator('#manage-button').isVisible(), false);
  await signup(applicant, 'Pessoa teste', 'person@example.test');
  await owner.locator('#pending-users .person-row').filter({ hasText: 'person@example.test' }).waitFor();
  assert.equal(await owner.locator('#pending-count').textContent(), '1');
  assert.ok((await owner.locator('#notice-text').textContent()).includes('solicitação'));
  await applicant.locator('#account-button').click();
  await applicant.waitForFunction(() => document.getElementById('session-status').textContent.includes('Aguardando aprovação'));
  await owner.locator('#pending-users .person-row').filter({ hasText: 'person@example.test' }).getByRole('button', { name: 'Aprovar', exact: true }).click();
  await applicant.waitForFunction(() => document.getElementById('session-status').textContent.startsWith('Aprovado'));
  assert.equal(await applicant.locator('#manage-button').isVisible(), false);
  await applicant.locator('[data-close=login-dialog]').click();
  await owner.locator('[data-admin-tab=people]').click();
  await owner.locator('#all-users .person-row').filter({ hasText: 'person@example.test' }).getByRole('button', { name: 'Gerenciar', exact: true }).click();
  await owner.getByRole('button', { name: 'Promover a subadministrador' }).click();
  await applicant.locator('#manage-button').waitFor({ state: 'visible' });
  await applicant.locator('#manage-button').click();
  assert.equal(await applicant.locator('#admin-settings-tab').isVisible(), false);
  const second = await page();
  await signup(second, 'Outra pessoa', 'second@example.test');
  await applicant.locator('#pending-users .person-row').filter({ hasText: 'second@example.test' }).waitFor();
  await applicant.locator('#pending-users .person-row').filter({ hasText: 'second@example.test' }).getByRole('button', { name: 'Aprovar', exact: true }).click();
  await owner.locator('#all-users .person-row').filter({ hasText: 'person@example.test' }).getByRole('button', { name: 'Gerenciar', exact: true }).click();
  await owner.getByRole('button', { name: 'Bloquear conta', exact: true }).click();
  await applicant.locator('#manage-button').waitFor({ state: 'hidden' });
  assert.equal(await applicant.locator('#admin-dialog').isVisible(), false);
  await applicant.locator('#account-button').click();
  await applicant.waitForFunction(() => document.getElementById('session-status').textContent.includes('Conta bloqueada'));
  await owner.locator('[data-admin-tab=history]').click();
  await owner.locator('#audit-list .person-row').first().waitFor();
  assert.ok((await owner.locator('#audit-list').textContent()).includes('Conta bloqueada'));
  await owner.screenshot({ path: 'test-output/admin-desktop.png', fullPage: false });
  for (const [label, width, height] of [
    ['mobile', 390, 844],
    ['tablet', 768, 1024],
  ]) {
    await owner.setViewportSize({ width, height });
    await owner.locator('[data-admin-tab=people]').click();
    assert.equal(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await owner.screenshot({ path: `test-output/admin-${label}.png`, fullPage: false });
  }
  assert.deepEqual(errors, []);
  console.log('QA administrativa em emuladores: cadastro pendente, aviso/contador em tempo real, aprovação, promoção, aprovação por subadmin, bloqueio imediato, histórico e responsividade passaram.');
} finally {
  await browser.close();
  await env.cleanup();
}
