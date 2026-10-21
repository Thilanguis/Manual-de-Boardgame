import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, Timestamp } from 'firebase/firestore';
import { OWNER_UID, emptyPermissions } from '../js/permissions.js';
import { execFileSync } from 'node:child_process';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Exige Auth e Firestore locais demo-acervo.');
const require = createRequire(resolve('tests/runtime/package.json'));
const { chromium } = require('playwright');
const project = 'demo-acervo', base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
const rules = await readFile('firestore.rules', 'utf8');
const previousRules = execFileSync('git', ['show', '92e6c6d:firestore.rules'], { encoding: 'utf8' });
const env = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: 8080, rules: previousRules } });
await env.clearFirestore();
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${project}/accounts`, { method: 'DELETE' });
const accounts = [
  [OWNER_UID, 'owner', 'superadmin', 'approved', emptyPermissions()],
  ['person', 'person', 'user', 'pending', emptyPermissions()],
  ['existing', 'existing', 'subadmin', 'approved', { ...emptyPermissions(), addGames: true, editGames: true }],
  ['rejected', 'rejected', 'user', 'rejected', emptyPermissions()],
  ['legacy', 'legacy', 'subadmin', 'blocked', { ...emptyPermissions(), editGames: true }],
];
for (const [uid, name] of accounts) {
  const response = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${project}/accounts`, {
    method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, email: `${name}@example.test`, password: 'Fixture-password-123', displayName: name }),
  });
  assert.equal(response.status, 200);
}
await env.withSecurityRulesDisabled(async (context) => {
  for (const [uid, name, role, status, permissions] of accounts) await setDoc(doc(context.firestore(), 'users', uid), { uid, name, email: `${name}@example.test`, role, status, permissions, createdAt: Timestamp.now(), updatedAt: Timestamp.now(), version: 1, lastEventId: '' });
  const permissions = { ...emptyPermissions(), editGames: true };
  await setDoc(doc(context.firestore(), 'users', 'legacy'), { uid: 'legacy', name: 'legacy', email: 'legacy@example.test', role: 'subadmin', status: 'blocked', permissions, createdAt: Timestamp.now(), updatedAt: Timestamp.now(), version: 2, lastEventId: 'old-block' });
  await setDoc(doc(context.firestore(), 'auditEvents', 'old-block'), { id: 'old-block', targetType: 'user', targetId: 'legacy', actorUid: OWNER_UID, action: 'block', version: 2, before: { role: 'subadmin', status: 'approved', permissions }, after: { role: 'subadmin', status: 'blocked', permissions }, createdAt: Timestamp.now() });
  await setDoc(doc(context.firestore(), 'settings', 'library'), { publicRead: true, version: 1, updatedAt: Timestamp.now(), lastEventId: '' });
});
const config = { ownerUid: OWNER_UID, firebase: { apiKey: 'demo-key', projectId: project, appId: '1:000:web:permissions', authDomain: 'demo-acervo.firebaseapp.com' }, sdkBase: '/__dev/sdk', emulators: { auth: 'http://127.0.0.1:9099', host: '127.0.0.1', port: 8080 }, fileStorage: { provider: 'drive', apiBase: 'http://127.0.0.1:8787' }, enableGoogleLogin: false, enableBgg: false, maxPdfBytes: 52428800 };
const out = 'test-output/permissions';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], external = [], screenshots = [];
async function readProfile(uid) {
  let profile;
  await env.withSecurityRulesDisabled(async (context) => { profile = (await getDoc(doc(context.firestore(), 'users', uid))).data(); });
  return profile;
}
async function auditCount() {
  let count;
  await env.withSecurityRulesDisabled(async (context) => { count = (await getDocs(collection(context.firestore(), 'auditEvents'))).size; });
  return count;
}
async function createPage() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) return route.continue();
    external.push(url.origin);
    return route.abort();
  });
  await context.route('**/config/app-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export const APP_CONFIG=' + JSON.stringify(config) }));
  await context.route('http://127.0.0.1:8787/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, apiVersion: '1.11.0', privateAccess: true, games: [], knowledgeConfigured: true, firebaseProject: project }) }));
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (dialog) => { errors.push('Diálogo nativo: ' + dialog.message()); void dialog.dismiss(); });
  await page.goto(base);
  return page;
}
async function login(page, name) {
  await page.waitForFunction(() => document.querySelector('#login-dialog').open || document.querySelector('#account-button').offsetParent);
  if (!(await page.locator('#login-dialog').evaluate((el) => el.open))) await page.locator('#account-button').click();
  await page.locator('#login-form [name=email]').fill(`${name}@example.test`);
  await page.locator('#login-form [name=password]').fill('Fixture-password-123');
  await page.locator('#login-submit').click();
  await page.waitForFunction(() => document.querySelector('#account-label').textContent !== 'Entrar' && !document.querySelector('#login-form').offsetParent);
}
async function manage(page, name) {
  if (!(await page.locator('#admin-dialog').evaluate((el) => el.open))) await page.locator('#manage-button').click();
  await page.locator('[data-admin-tab=people]').click();
  await page.locator('#all-users .person-row').filter({ hasText: `${name}@example.test` }).getByRole('button', { name: 'Gerenciar', exact: true }).click();
}
async function save(page, add, edit, approve = false) {
  await page.locator('#permission-approve').setChecked(approve);
  await page.locator('#permission-add').setChecked(add);
  await page.locator('#permission-edit').setChecked(edit);
  assert.match(await page.locator('#person-permissions-state').textContent(), /não salvas/);
  await page.getByRole('button', { name: 'Salvar permissões', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#person-save-state').textContent.includes('salvas e confirmadas'));
  assert.equal(await page.locator('#save-person-permissions').isDisabled(), true);
}
try {
  const owner = await createPage();
  await login(owner, 'owner');
  await owner.locator('#manage-button').waitFor({ state: 'visible' });
  console.log('Login do proprietário confirmado no emulador.');
  // Usuário aprovado é leitor e não exibe checkboxes administrativos.
  await manage(owner, 'person');
  assert.equal(await owner.locator('#person-permissions').isVisible(), false);
  assert.equal(await owner.locator('#permission-approve').isVisible(), false);
  await owner.locator('#person-dialog').getByRole('button', { name: 'Aprovar', exact: true }).click();
  assert.deepEqual((await readProfile('person')).permissions, emptyPermissions());
  await manage(owner, 'person');
  assert.equal(await owner.locator('#person-permissions').isVisible(), false);
  await owner.getByRole('button', { name: 'Promover a subadministrador' }).click();
  await owner.waitForFunction(() => document.querySelector('#person-status').textContent.includes('Subadministrador'));
  assert.equal(await owner.locator('#permission-add').isChecked(), false);
  assert.equal(await owner.locator('#permission-edit').isChecked(), false);
  assert.equal(await owner.locator('#permission-approve').isChecked(), false);
  assert.deepEqual((await readProfile('person')).permissions, emptyPermissions());
  // Novas concessões independentes, incluindo remoção total e persistência real.
  for (const [add, edit] of [[true, false], [false, true], [true, true], [false, false]]) {
    await save(owner, add, edit);
    assert.deepEqual((await readProfile('person')).permissions, { ...emptyPermissions(), addGames: add, editGames: edit });
    await owner.locator('[data-close=person-dialog]').click();
    await manage(owner, 'person');
    assert.equal(await owner.locator('#permission-add').isChecked(), add);
    assert.equal(await owner.locator('#permission-edit').isChecked(), edit);
  }
  const unchangedVersion = (await readProfile('person')).version, unchangedAudits = await auditCount();
  console.log('Frontend novo: aprovação, promoção sem flags e quatro combinações salvas/reabertas sob as regras anteriores.');
  await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: 8080, rules } });
  await owner.locator('#save-person-permissions').evaluate((el) => el.click());
  assert.equal((await readProfile('person')).version, unchangedVersion);
  assert.equal(await auditCount(), unchangedAudits);
  // Fechar/Escape/backdrop pedem descarte, sem falso salvamento.
  await owner.locator('#permission-add').check();
  await owner.locator('[data-close=person-dialog]').click();
  assert.equal(await owner.locator('#person-discard').isVisible(), true);
  await owner.getByRole('button', { name: 'Continuar editando' }).click();
  assert.equal(await owner.locator('#permission-add').isChecked(), true);
  await owner.mouse.click(5, 5);
  assert.equal(await owner.locator('#person-discard').isVisible(), true, 'clique fora também pede descarte');
  await owner.getByRole('button', { name: 'Continuar editando' }).click();
  await owner.keyboard.press('Escape');
  assert.equal(await owner.locator('#person-discard').isVisible(), true);
  for (const width of [1440, 390]) {
    await owner.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    assert.equal(await owner.locator('#person-dialog').evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
    const path = `${out}/discard-${width}.png`;
    await owner.screenshot({ path }); screenshots.push(path);
  }
  await owner.getByRole('button', { name: 'Descartar alterações' }).click();
  await manage(owner, 'person');
  assert.equal(await owner.locator('#permission-add').isChecked(), false);
  assert.equal((await readProfile('person')).version, unchangedVersion);
  await owner.setViewportSize({ width: 1440, height: 1000 });
  // Falha real de backend não anuncia sucesso e conserva o rascunho.
  await owner.locator('#permission-edit').check();
  const noticeBefore = await owner.locator('#notice-text').textContent();
  const deniedRules = rules.replace("(action == 'permissions' && before.role", "(false && action == 'permissions' && before.role");
  const deniedEnv = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: 8080, rules: deniedRules } });
  await owner.locator('#save-person-permissions').click();
  await owner.locator('#person-error').waitFor({ state: 'visible' });
  assert.equal(await owner.locator('#permission-edit').isChecked(), true);
  assert.equal(await owner.locator('#person-save-state').textContent(), '');
  assert.equal(await owner.locator('#notice-text').textContent(), noticeBefore);
  assert.equal((await readProfile('person')).permissions.editGames, false);
  await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: 8080, rules } });
  await deniedEnv.cleanup();
  await owner.locator('#save-person-permissions').click();
  await owner.waitForFunction(() => document.querySelector('#person-save-state').textContent.includes('salvas e confirmadas'));
  // Recarregar e entrar novamente conserva exatamente a concessão salva.
  await owner.reload();
  await owner.locator('#manage-button').waitFor({ state: 'visible' });
  await manage(owner, 'person');
  assert.equal(await owner.locator('#permission-add').isChecked(), false);
  assert.equal(await owner.locator('#permission-edit').isChecked(), true);
  await owner.locator('[data-close=person-dialog]').click();
  await owner.locator('[data-close=admin-dialog]').click();
  await owner.locator('#account-button').click();
  await owner.locator('#logout-button').click();
  await login(owner, 'owner');
  await owner.locator('#manage-button').waitFor({ state: 'visible' });
  await manage(owner, 'existing');
  assert.equal(await owner.locator('#permission-add').isChecked(), true, 'concessão antiga preservada');
  assert.equal(await owner.locator('#permission-edit').isChecked(), true);
  await owner.locator('[data-close=person-dialog]').click();
  await manage(owner, 'person');
  assert.equal(await owner.locator('#permission-edit').isChecked(), true);
  for (const width of [1440, 390]) {
    await owner.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    assert.equal(await owner.locator('#person-dialog').evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
    const path = `${out}/saved-${width}.png`;
    await owner.screenshot({ path }); screenshots.push(path);
  }
  // Rebaixamento e desbloqueio não deixam poderes residuais.
  await owner.locator('#permission-add').check();
  const otherOwner = await createPage();
  await login(otherOwner, 'owner');
  await manage(otherOwner, 'person');
  await save(otherOwner, false, false);
  await owner.locator('#person-error').waitFor({ state: 'visible' });
  assert.match(await owner.locator('#person-error').textContent(), /outra sessão/);
  const concurrentVersion = (await readProfile('person')).version;
  await owner.locator('#save-person-permissions').click();
  await owner.waitForFunction(() => document.querySelector('#person-error').textContent.includes('Feche e reabra'));
  assert.equal((await readProfile('person')).version, concurrentVersion, 'rascunho antigo não sobrescreve a outra sessão');
  await owner.locator('[data-close=person-dialog]').click();
  await owner.getByRole('button', { name: 'Descartar alterações' }).click();
  await manage(owner, 'person');
  assert.equal(await owner.locator('#permission-add').isChecked(), false);
  assert.equal(await owner.locator('#permission-edit').isChecked(), false);
  await owner.getByRole('button', { name: 'Rebaixar a usuário' }).click();
  await owner.locator('#person-dialog').waitFor({ state: 'hidden' });
  assert.deepEqual((await readProfile('person')).permissions, emptyPermissions());
  await manage(owner, 'person');
  assert.equal(await owner.locator('#person-permissions').isVisible(), false);
  await owner.getByRole('button', { name: 'Bloquear conta', exact: true }).click();
  await owner.locator('#person-dialog').waitFor({ state: 'hidden' });
  await manage(owner, 'person');
  await owner.getByRole('button', { name: 'Desbloquear conta', exact: true }).click();
  await owner.locator('#person-dialog').waitFor({ state: 'hidden' });
  assert.equal((await readProfile('person')).status, 'approved');
  await manage(owner, 'rejected');
  await owner.getByRole('button', { name: 'Bloquear conta', exact: true }).click();
  await owner.locator('#person-dialog').waitFor({ state: 'hidden' });
  await manage(owner, 'rejected');
  await owner.getByRole('button', { name: 'Desbloquear conta', exact: true }).click();
  await owner.locator('#person-dialog').waitFor({ state: 'hidden' });
  assert.equal((await readProfile('rejected')).status, 'rejected');
  await manage(owner, 'legacy');
  await owner.getByRole('button', { name: 'Desbloquear conta', exact: true }).click();
  await owner.locator('#person-dialog').waitFor({ state: 'hidden' });
  assert.equal((await readProfile('legacy')).status, 'approved', 'evento antigo preserva aprovação real anterior');
  assert.equal((await readProfile('legacy')).permissions.editGames, true);
  const reader = await createPage();
  await login(reader, 'person');
  assert.equal(await reader.locator('#manage-button').isVisible(), false);
  assert.equal(await reader.locator('[data-add]').first().isVisible(), false);
  // O proprietário delega somente revisão de cadastros e a revoga na mesma sessão.
  await manage(owner, 'person');
  await owner.getByRole('button', { name: 'Promover a subadministrador' }).click();
  await owner.waitForFunction(() => document.querySelector('#person-status').textContent.includes('Subadministrador'));
  await save(owner, false, false, true);
  assert.deepEqual((await readProfile('person')).permissions, { ...emptyPermissions(), approveUsers: true });
  await owner.locator('[data-close=person-dialog]').click();
  await manage(owner, 'person');
  assert.equal(await owner.locator('#permission-approve').isChecked(), true, 'aprovação delegada persiste ao reabrir');
  await env.withSecurityRulesDisabled(async (context) => {
    for (const uid of ['new-approve', 'new-reject']) await setDoc(doc(context.firestore(), 'users', uid), { uid, name: uid, email: `${uid}@example.test`, role: 'user', status: 'pending', permissions: emptyPermissions(), createdAt: Timestamp.now(), updatedAt: Timestamp.now(), version: 1, lastEventId: '' });
  });
  await reader.locator('#manage-button').waitFor({ state: 'visible' });
  await reader.locator('#manage-button').click();
  for (const tab of ['people', 'history', 'settings']) assert.equal(await reader.locator(`[data-admin-tab=${tab}]`).isVisible(), false);
  assert.equal(await reader.locator('[data-add]').first().isVisible(), false, 'aprovar não concede escrita em jogos');
  assert.equal(await reader.locator('#person-permissions').isVisible(), false);
  for (const [uid, action, status] of [['new-approve', 'Aprovar', 'approved'], ['new-reject', 'Recusar', 'rejected']]) {
    const row = reader.locator('#pending-users .person-row').filter({ hasText: `${uid}@example.test` });
    assert.equal(await row.getByRole('button', { name: 'Gerenciar', exact: true }).count(), 0);
    await row.getByRole('button', { name: action, exact: true }).click();
    await row.waitFor({ state: 'hidden' });
    assert.equal((await readProfile(uid)).status, status);
    assert.deepEqual((await readProfile(uid)).permissions, emptyPermissions());
  }
  await reader.setViewportSize({ width: 390, height: 844 });
  await reader.screenshot({ path: `${out}/reviewer-mobile.png` });
  await save(owner, false, false, false);
  await reader.locator('#manage-button').waitFor({ state: 'hidden' });
  assert.equal(await reader.locator('#admin-dialog').isVisible(), false, 'revogar fecha imediatamente a revisão');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await writeFile(`${out}/browser.json`, JSON.stringify({ passed: true, screenshots, external, errors, realServices: false, limitations: 'Auth e Firestore emulados; API de arquivos simulada; nenhum dado real alterado.' }, null, 2));
  console.log('Permissões: promoção sem flags; concessões independentes de jogos e aprovação; aprovação/recusa como subadmin; revogação imediata; persistência, descarte, concorrência e bloqueio; desktop e celular; zero serviços reais.');
} finally {
  await browser.close();
  await env.cleanup();
}
