import '../scripts/test-guard.mjs';
import { openGameManagement } from './game-ui-fixture.mjs';
// Somente Auth/Firestore emulados e perfis descartáveis. Não cria contas reais.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, Timestamp } from 'firebase/firestore';
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
    title: 'ZMGPSM0101 v1.0.indd',
    description: '',
    minPlayers: null,
    maxPlayers: null,
    durationMinutes: 45,
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
      body: `export const APP_CONFIG=${JSON.stringify({ firebase: { apiKey: 'demo-api-key', authDomain: 'demo-acervo.firebaseapp.com', projectId, appId: '1:000:web:test' }, sdkBase: '/__dev/sdk', fileStorage: { provider: 'drive', apiBase: 'http://127.0.0.1:8789' }, emulators: { auth: 'http://127.0.0.1:9099', host: '127.0.0.1', port: 8080 }, enableBgg: false, enableGoogleLogin: false, maxPdfBytes: 209715200 })};`,
    }),
  );
  await context.route('http://127.0.0.1:8789/v1/catalog/status', (route) =>
    route.fulfill({
      status: driveFailure ? 502 : 200,
      contentType: 'application/json',
      body: JSON.stringify(driveFailure ? { error: 'Falha transitória de teste' } : { games: [{ id: gameId, available: driveAvailable, reason: driveAvailable ? 'available' : 'trashed' }] }),
    }),
  );
  await context.route('http://127.0.0.1:8789/v1/research/sources', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ protocol: 2, apiVersion: '1.5.0', sources: [{ id: 'wikidata', name: 'Wikidata', enabled: true, url: 'https://www.wikidata.org', reason: 'fixture CC0' }] }) }),
  );
  await context.route('http://127.0.0.1:8789/v1/research/wikidata', (route) => {
    assert(route.request().headers().authorization.startsWith('Bearer '));
    assert.equal(route.request().postDataJSON().preferredLanguage, 'pt-BR');
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        source: 'wikidata',
        candidates: [
          {
            source: 'wikidata',
            id: 'Q137295527',
            url: 'https://www.wikidata.org/wiki/Q137295527',
            // API simulada; fatos conferidos na página oficial Z-Man. Resumo próprio para o teste.
            fields: {
              title: 'The Lord of the Rings: Fate of the Fellowship',
              description: 'Trabalhe com a Sociedade para proteger Frodo e enfrentar as ameaças da Terra-média.',
              minPlayers: 1,
              maxPlayers: 5,
              durationMinutes: '1–2,5 horas',
              minDurationMinutes: null,
              maxDurationMinutes: null,
              recommendedAge: 14,
              tags: ['Aventura', 'Estratégia'],
              mechanics: ['Cooperação'],
              gameType: 'Cooperativo',
            },
            names: [
              { value: 'O Senhor dos Anéis: Sina da Sociedade', language: 'pt-BR' },
              { value: 'The Lord of the Rings: Fate of the Fellowship', language: 'en' },
            ],
            identifiers: { wikidata: 'Q137295527' },
            kind: 'unknown',
            edition: '',
            language: 'pt-br',
            descriptionLanguage: 'pt-br',
            license: 'CC0',
            conflicts: [],
          },
        ],
      }),
    });
  });
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
  await form.locator('[name=confirmation]').press('Enter');
  await p.waitForFunction(() => document.getElementById('notice-text').textContent === 'Conta criada! Aguarde a aprovação de um administrador.');
}
try {
  const guest = await page();
  await guest.waitForFunction(() => document.querySelectorAll('.game-card').length === 1);
  await guest.clock.install();
  async function refreshOnFocus() {
    // A biblioteca atualiza ao recuperar foco; o botão manual foi removido.
    await guest.clock.fastForward(61000);
    await guest.evaluate(() => window.dispatchEvent(new Event('focus')));
    await guest.clock.runFor(400);
  }
  driveFailure = true;
  await refreshOnFocus();
  await guest.waitForFunction(() => document.getElementById('library-error').textContent.includes('Falha transitória'));
  assert.equal(await guest.locator('.game-card').count(), 1);
  driveFailure = false;
  driveAvailable = false;
  await refreshOnFocus();
  await guest.waitForFunction(() => document.querySelectorAll('.game-card').length === 0);
  assert.equal(await guest.locator('#unavailable-games').isVisible(), false);
  const owner = await page();
  await owner.locator('#account-button').click();
  await owner.locator('#login-form [name=email]').fill('owner@example.test');
  await owner.locator('#login-form [name=email]').press('Tab');
  assert.equal(await owner.evaluate(() => document.activeElement.name), 'password');
  await owner.locator('#login-form [name=password]').fill('Fixture-password-123');
  await owner.locator('#login-form [name=password]').press('Enter');
  await owner.locator('#manage-button').waitFor({ state: 'visible' });
  await owner.locator('#account-button').click();
  assert.equal(await owner.locator('#login-title').textContent(), 'Minha conta');
  assert.equal(await owner.locator('#session-message').textContent(), 'Proprietário de teste');
  assert.equal(await owner.locator('#profile-role').textContent(), 'Administrador principal');
  assert.equal(await owner.locator('#profile-email').textContent(), 'owner@example.test');
  assert.match(await owner.locator('#profile-providers').textContent(), /E-mail e senha/);
  assert.equal(await owner.locator('#session-uid').isVisible(), false);
  for (const [label, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
    ['tablet', 768, 1024],
  ]) {
    await owner.setViewportSize({ width, height });
    assert.equal(await owner.evaluate(() => document.getElementById('login-dialog').scrollWidth <= document.getElementById('login-dialog').clientWidth + 1), true);
    await owner.screenshot({ path: `test-output/profile-${label}.png`, fullPage: false });
  }
  await owner.setViewportSize({ width: 1440, height: 1000 });
  await owner.locator('#profile-technical summary').click();
  await owner.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => (window.copiedUid = value) } }));
  await owner.locator('#copy-uid').click();
  assert.equal(await owner.evaluate(() => window.copiedUid), '7TitBObtb8a0W8GisSstSM1RHiX2');
  await owner.keyboard.press('Escape');
  await owner.locator('#login-dialog').waitFor({ state: 'hidden' });
  assert.equal(await owner.evaluate(() => document.activeElement.id), 'account-button');
  await owner.locator('#unavailable-games').waitFor({ state: 'visible' });
  await owner.getByRole('button', { name: 'Gerenciar cadastro' }).click();
  assert.equal(await owner.locator('#read-manual').isDisabled(), true);
  assert.equal(await owner.locator('#delete-game').isVisible(), true);
  driveAvailable = true;
  await owner.evaluate(() => window.dispatchEvent(new Event('focus')));
  await owner.waitForFunction(() => !document.getElementById('read-manual').disabled);
  assert.match(await owner.locator('#detail-manual').textContent(), /páginas/);
  await owner.locator('[data-close=detail-dialog]').click();
  await refreshOnFocus();
  await guest.waitForFunction(() => document.querySelectorAll('.game-card').length === 1);
  assert.equal(await owner.locator('#unavailable-games').isVisible(), false);
  assert.equal(await owner.locator('.hero').isVisible(), false, 'Não há destaque antes de clicar em um jogo');
  await owner.locator('.card-main').click();
  await openGameManagement(owner, 'manage-information');
  await owner.locator('#edit-game').click();
  assert.equal(await owner.locator('#title-warning').isVisible(), true);
  assert.equal(await owner.locator('#game-title').inputValue(), 'ZMGPSM0101 v1.0.indd');
  assert(
    await owner
      .locator('#title-suggestions')
      .textContent()
      .then((t) => t.includes('Sina da Sociedade')),
  );
  await owner.locator('#game-title').fill('O Senhor dos Anéis: Sina da Sociedade');
  await owner.locator('#game-next').click();
  assert.equal(await owner.locator('[name=minDurationMinutes]').inputValue(), '45');
  assert.equal(await owner.locator('[name=maxDurationMinutes]').inputValue(), '45');
  await owner.locator('[name=minDurationMinutes]').fill('60');
  await owner.locator('[name=maxDurationMinutes]').fill('120');
  await owner.locator('#game-back').click();
  await owner.locator('[data-research-search]').click();
  await owner.locator('.research-card').getByRole('button', { name: 'Revisar sugestões', exact: true }).click();
  assert.equal(await owner.locator('[data-research-field=title]').isChecked(), false);
  assert.equal(await owner.locator('[data-research-field=maxDurationMinutes]').isChecked(), false);
  await owner.locator('[data-research-field=maxDurationMinutes]').check();
  await owner.locator('[data-research-review] input[type=checkbox]').last().check();
  await owner.locator('[data-research-review] button').click();
  assert.equal(await owner.locator('[data-game-step="2"]').isVisible(), true);
  for (const [field, value] of Object.entries({
    description: 'Trabalhe com a Sociedade para proteger Frodo e enfrentar as ameaças da Terra-média.',
    minPlayers: '1',
    maxPlayers: '5',
    minDurationMinutes: '60',
    maxDurationMinutes: '150',
    recommendedAge: '14',
    tags: 'Aventura, Estratégia',
    mechanics: 'Cooperação',
    gameType: 'Cooperativo',
  }))
    assert.equal(await owner.locator(`#game-form [name=${field}]`).inputValue(), value);
  await owner.locator('#game-back').click();
  await owner.locator('#game-next').click();
  assert.equal(await owner.locator('#game-form [name=description]').inputValue(), 'Trabalhe com a Sociedade para proteger Frodo e enfrentar as ameaças da Terra-média.');
  await owner.locator('[data-step-target="3"]').click();
  await owner.locator('#game-form [name=confirmed]').check();
  await owner.locator('#save-game').click();
  await owner.locator('#upload-dialog').waitFor({ state: 'hidden' });
  const saved = (await getDoc(doc(env.unauthenticatedContext().firestore(), 'games', gameId))).data();
  assert.equal(saved.title, 'O Senhor dos Anéis: Sina da Sociedade');
  assert.equal(saved.minDurationMinutes, 60);
  assert.equal(saved.maxDurationMinutes, 150);
  assert.equal(saved.durationMinutes, null);
  let researchSaved;
  await env.withSecurityRulesDisabled(async (context) => {
    researchSaved = (await getDoc(doc(context.firestore(), 'gameResearch', gameId))).data();
  });
  assert(researchSaved?.aliases.includes('o senhor dos aneis sina da sociedade'));
  assert.equal(JSON.parse(researchSaved.content).candidates[0].id, 'Q137295527');
  assert.equal(JSON.parse(researchSaved.content).decisions.length > 0, true);
  assert.equal(saved.description, 'Trabalhe com a Sociedade para proteger Frodo e enfrentar as ameaças da Terra-média.');
  assert.equal(saved.minPlayers, 1);
  assert.equal(saved.maxPlayers, 5);
  assert.equal(saved.recommendedAge, 14);
  const secondDevice = await page();
  let extraQueries = 0;
  secondDevice.on('request', (request) => {
    if (request.url().endsWith('/v1/research/wikidata')) extraQueries++;
  });
  await secondDevice.locator('#account-button').click();
  await secondDevice.locator('#login-form [name=email]').fill('owner@example.test');
  await secondDevice.locator('#login-form [name=password]').fill('Fixture-password-123');
  await secondDevice.locator('#login-form [name=password]').press('Enter');
  await secondDevice.locator('#manage-button').waitFor({ state: 'visible' });
  await secondDevice.locator('.card-main').click();
  await openGameManagement(secondDevice, 'manage-information');
  await secondDevice.locator('#edit-game').click();
  await secondDevice.locator('[data-research-search]').click();
  await secondDevice.waitForFunction(() => document.querySelector('[data-research-status]').textContent.startsWith('Informações recuperadas'));
  assert.equal(extraQueries, 0, 'Segundo dispositivo recupera pesquisa do Firestore sem consultar API');
  await secondDevice.close();

  assert.deepEqual(saved.tags, ['Aventura', 'Estratégia']);
  assert.deepEqual(saved.mechanics, ['Cooperação']);
  assert.equal(saved.gameType, 'Cooperativo');
  assert.equal(saved.sources.description.license, 'CC0');
  assert.equal(saved.sources.catalog.matches[0].id, 'Q137295527');
  assert.match(saved.sources.title.source, /ajustado por você/);
  await owner.locator('.card-main').click();
  await openGameManagement(owner, 'manage-guide');
  await owner.locator('#edit-guide').click();
  await owner.getByRole('button', { name: 'Nova seção', exact: true }).click();
  await owner.locator('.guide-editor-section [name=title]').fill('Preparação revisada');
  await owner.locator('.guide-editor-section [name=text]').fill('Explicação aprovada pelo administrador.');
  await owner.locator('.guide-editor-section [name=reviewed]').check();
  await owner.getByRole('button', { name: 'Salvar rascunho' }).click();
  await owner.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('Rascunho salvo'));
  await guest.locator('.card-main').click();
  await guest.locator('#learn-game').click();
  await guest.waitForFunction(() => document.getElementById('guide-content').textContent.includes('ainda não tem um guia publicado'));
  assert.equal(await guest.locator('#guide-edit').isVisible(), false);
  await owner.getByRole('button', { name: 'Publicar guia' }).click();
  await owner.waitForFunction(() => document.getElementById('guide-status').textContent.startsWith('Guia publicado'));
  await guest.locator('#guide-close').click();
  await guest.locator('.card-main').click();
  await guest.locator('#learn-game').click();
  await guest.waitForFunction(() => document.getElementById('guide-content').textContent.includes('Explicação aprovada pelo administrador'));
  await guest.locator('#guide-close').click();
  await owner.locator('#guide-close').click();
  await owner.locator('#manage-button').click();
  const applicant = await page();
  assert.equal(await applicant.locator('#manage-button').isVisible(), false);
  await applicant.locator('#account-button').click();
  for (const [label, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
    ['tablet', 768, 1024],
  ]) {
    await applicant.setViewportSize({ width, height });
    for (const view of ['login', 'register', 'recovery']) {
      if (view !== 'login') await applicant.locator(`[data-auth-view=${view}]`).click();
      assert.equal(await applicant.evaluate(() => document.getElementById('login-dialog').scrollWidth <= document.getElementById('login-dialog').clientWidth + 1), true);
      await applicant.screenshot({ path: `test-output/auth-${view}-${label}.png`, fullPage: false });
      if (view !== 'login') await applicant.locator(`#${view}-form [data-auth-view=login]`).click();
    }
    assert.equal(await applicant.locator('#google-login').isVisible(), false);
    assert((await applicant.locator('[data-auth-view=register]').boundingBox()).height >= 44);
  }
  await applicant.setViewportSize({ width: 1440, height: 1000 });
  await applicant.locator('[data-close=login-dialog]').click();
  await signup(applicant, 'Pessoa teste', 'person@example.test');
  await owner.locator('#pending-users .person-row').filter({ hasText: 'person@example.test' }).waitFor();
  assert.equal(await owner.locator('#pending-count').textContent(), '1');
  assert.ok((await owner.locator('#notice-text').textContent()).includes('solicitação'));
  await applicant.locator('#account-button').click();
  await applicant.waitForFunction(() => document.getElementById('profile-status').textContent.includes('Aguardando aprovação'));
  await owner.locator('#pending-users .person-row').filter({ hasText: 'person@example.test' }).getByRole('button', { name: 'Aprovar', exact: true }).click();
  await applicant.waitForFunction(() => document.getElementById('profile-status').textContent.startsWith('Aprovado'));
  assert.equal(await applicant.locator('#manage-button').isVisible(), false);
  await applicant.locator('[data-close=login-dialog]').click();
  await owner.locator('[data-admin-tab=people]').click();
  await owner.locator('#all-users .person-row').filter({ hasText: 'person@example.test' }).getByRole('button', { name: 'Gerenciar', exact: true }).click();
  await owner.getByRole('button', { name: 'Promover a subadministrador' }).click();
  await owner.waitForFunction(() => document.querySelector('#person-status').textContent.includes('Subadministrador'));
  assert.equal(await owner.locator('#permission-add').isChecked(), false);
  assert.equal(await owner.locator('#permission-edit').isChecked(), false);
  assert.equal(await applicant.locator('#manage-button').isVisible(), false);
  await owner.locator('[data-close=person-dialog]').click();
  const second = await page();
  await signup(second, 'Outra pessoa', 'second@example.test');
  assert.equal(await applicant.locator('#manage-button').isVisible(), false);
  await owner.locator('#all-users .person-row').filter({ hasText: 'second@example.test' }).waitFor();
  await owner.locator('#all-users .person-row').filter({ hasText: 'second@example.test' }).getByRole('button', { name: 'Aprovar', exact: true }).click();
  await owner.locator('#all-users .person-row').filter({ hasText: 'person@example.test' }).getByRole('button', { name: 'Gerenciar', exact: true }).click();
  await owner.getByRole('button', { name: 'Bloquear conta', exact: true }).click();
  await applicant.locator('#manage-button').waitFor({ state: 'hidden' });
  assert.equal(await applicant.locator('#admin-dialog').isVisible(), false);
  await applicant.locator('#account-button').click();
  await applicant.waitForFunction(() => document.getElementById('profile-status').textContent.includes('Conta bloqueada'));
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
  await applicant.locator('#logout-button').click();
  await applicant.waitForFunction(() => document.getElementById('account-label').textContent === 'Entrar');
  await applicant.locator('#account-button').click();
  await applicant.locator('[data-auth-view=recovery]').click();
  await applicant.locator('#recovery-form [name=email]').fill('person@example.test');
  await applicant.locator('#recovery-submit').click();
  await applicant.waitForFunction(() => document.getElementById('recovery-message').textContent.includes('instruções para recuperar'));
  const oobResponse = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/oobCodes`);
  const codes = (await oobResponse.json()).oobCodes;
  const reset = codes.find((c) => c.email === 'person@example.test' && c.requestType === 'PASSWORD_RESET');
  assert(reset, 'Firebase Auth emulado gerou uma recuperação real, sem envio de e-mail externo');
  const changed = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=demo-api-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oobCode: reset.oobCode, newPassword: 'Nova-fixture-password-123' }),
  });
  assert.equal(changed.status, 200);
  await applicant.locator('#recovery-form [data-auth-view=login]').click();
  await applicant.locator('#login-form [name=email]').fill('person@example.test');
  await applicant.locator('#login-form [name=password]').fill('senha-errada-123');
  await applicant.locator('#login-submit').click();
  await applicant.locator('#login-error').waitFor({ state: 'visible' });
  assert.match(await applicant.locator('#login-error').textContent(), /incorretos/);
  await applicant.locator('#login-form [name=password]').fill('Nova-fixture-password-123');
  await applicant.locator('#login-submit').click();
  await applicant.locator('#login-dialog').waitFor({ state: 'hidden' });
  await applicant.locator('#account-button').click();
  await applicant.waitForFunction(() => document.getElementById('profile-status').textContent === 'Conta bloqueada');
  assert.equal(await applicant.locator('#profile-role').textContent(), 'Subadministrador');
  assert.equal(await applicant.locator('#profile-status').textContent(), 'Conta bloqueada');
  assert.deepEqual(errors, []);
  console.log(
    'QA de contas/dados em emuladores: recuperação de senha aplicada e novo login, perfil sem UID em destaque, duração 60–150 salva a partir de horas, cadastro pendente, aviso/contador em tempo real, aprovação, promoção, aprovação por subadmin, bloqueio imediato, histórico, pesquisa privada salva, reutilização via Firestore em segundo dispositivo sem chamadas externas e responsividade passaram.',
  );
} finally {
  await browser.close();
  await env.cleanup();
}
