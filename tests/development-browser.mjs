// Testa o ambiente que o desenvolvedor inicia, sem interceptar a configuração.
import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { browserDependencies as require } from './browser-dependencies.mjs';
import { testPdf } from '../scripts/dev-seed.mjs';
import { openGameManagement } from './game-ui-fixture.mjs';
const { chromium } = require('playwright');
const report = { externalRequests: [], errors: [], checks: [], viewports: [], metrics: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const contexts = [];
async function page() {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  contexts.push(context);
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
      report.externalRequests.push(url.origin + url.pathname);
      return route.abort();
    }
    return route.continue();
  });
  const p = await context.newPage();
  p.on('pageerror', (e) => report.errors.push(e.message));
  await p.goto('http://localhost:4173');
  return p;
}
async function login(p, email) {
  await p.locator('#login-form [name=email]').fill(email);
  await p.locator('#login-form [name=password]').fill('Acervo-teste-123');
  await p.locator('#login-submit').click();
}
async function approved(p) {
  await p.waitForFunction(() => document.body.classList.contains('access-approved'));
  await p.locator('.card-main').first().waitFor();
}
async function metrics(p) {
  return p.evaluate(() => structuredClone(globalThis.__ACERVO_METRICS__));
}
async function api(p, path, input) {
  return p.evaluate(
    async ({ path, input }) => {
      const { getAuth } = await import('/__dev/sdk/firebase-auth.js');
      const token = await getAuth().currentUser?.getIdToken();
      const response = await fetch('http://127.0.0.1:8787' + path, {
        method: input ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
        body: input ? JSON.stringify(input) : undefined,
      });
      return { status: response.status, data: await response.json() };
    },
    { path, input },
  );
}
async function eventually(action, condition, timeout = 20000) {
  const end = Date.now() + timeout;
  let result;
  while (Date.now() < end) {
    result = await action();
    if (condition(result)) return result;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Resultado não atingido: ' + JSON.stringify(result));
}
try {
  const owner = await page();
  assert.equal(await owner.locator('.game-card').count(), 0);
  await login(owner, 'proprietario@acervo.test');
  await approved(owner);
  await owner.waitForFunction(() => [...document.querySelectorAll('.game-card img')].every((i) => i.naturalWidth > 0));
  await owner.waitForTimeout(1200);
  report.metrics.push({ stage: 'library', ...(await metrics(owner)) });
  const initialFiles = (await (await fetch('http://127.0.0.1:8788/metrics')).json()).files;
  assert.equal((await metrics(owner)).activeListeners, 4);
  assert.equal((await metrics(owner)).rest['GET cacheKeys'], 1);
  report.checks.push('visitante bloqueado; proprietário fictício autenticado; capas protegidas carregadas');
  const pending = await page();
  await pending.locator('[data-auth-view=register]').first().click();
  const email = `novo-${Date.now()}@acervo.test`;
  await pending.locator('#register-form [name=name]').fill('Pessoa de teste');
  await pending.locator('#register-form [name=email]').fill(email);
  await pending.locator('#register-form [name=password]').fill('Acervo-teste-123');
  await pending.locator('#register-form [name=confirmation]').fill('Acervo-teste-123');
  await pending.locator('#register-submit').click();
  await pending.waitForFunction(() => document.querySelector('#profile-status').dataset.status === 'pending');
  assert.equal(await pending.locator('.game-card').count(), 0);
  await owner.locator('#manage-button').click();
  const request = owner.locator('#pending-users .person-row').filter({ hasText: email });
  await request.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await approved(pending);
  assert.equal(await pending.locator('[data-add]:visible').count(), 0);
  await owner.locator('[data-close=admin-dialog]').click();
  report.checks.push('cadastro pendente sem conteúdo; aprovação pelo proprietário; usuário comum somente leitura');
  await owner.locator('.card-main').filter({ hasText: 'Ilha dos Faroleiros' }).click();
  await owner.locator('#read-manual').click();
  await owner.waitForFunction(() => document.querySelector('#page-total').textContent.includes('1'));
  await owner.locator('#reader-close').click();
  if (!(await owner.locator('#detail-dialog').evaluate((d) => d.open))) await owner.locator('.card-main').filter({ hasText: 'Ilha dos Faroleiros' }).click();
  await owner.locator('#quick-rules').click();
  await owner.locator('#guide-search').fill('farol');
  await owner.waitForFunction(() => document.querySelectorAll('.rule-result').length > 0);
  await owner.locator('#guide-close').click();
  if (!(await owner.locator('#detail-dialog').evaluate((d) => d.open))) await owner.locator('.card-main').filter({ hasText: 'Ilha dos Faroleiros' }).click();
  await owner.locator('#quick-rules').click();
  await owner.locator('#guide-search').fill('preparação');
  await owner.waitForFunction(() => document.querySelector('#guide-content').textContent.includes('Distribua quatro'));
  await owner.locator('#guide-close').click();
  if (!(await owner.locator('#detail-dialog').evaluate((d) => d.open))) await owner.locator('.card-main').filter({ hasText: 'Ilha dos Faroleiros' }).click();
  await openGameManagement(owner, 'manage-documents-section');
  assert.equal(await owner.locator('#manage-documents > label').isVisible(), true);
  assert.equal(await owner.locator('#delete-game').isVisible(), true);
  assert.equal(await owner.locator('#game-management-dialog details details').count(), 0);
  report.metrics.push({ stage: 'one game', ...(await metrics(owner)) });
  assert((await metrics(owner)).activeListeners <= 5);
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
  ]) {
    await owner.setViewportSize(viewport);
    assert(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const deletion = await owner.locator('#delete-game').boundingBox();
    assert(deletion.y >= 0 && deletion.y + deletion.height <= viewport.height, 'Excluir jogo deve ficar totalmente visível.');
    await owner.screenshot({ path: `test-output/dev-management-${viewport.width}.png` });
    report.viewports.push(viewport);
  }
  await owner.locator('[data-close=game-management-dialog]').click();
  await owner.locator('[data-close=detail-dialog]').click();
  const id = '10000000-0000-4000-8000-000000000002',
    path = `/v1/games/${id}/knowledge`;
  let knowledge = await api(owner, path);
  if (!knowledge.data?.knowledge) await api(owner, path, { requestId: crypto.randomUUID() });
  knowledge = await eventually(
    () => api(owner, path),
    (r) => r.data?.knowledge?.sections?.length > 0,
  );
  report.knowledge = { status: knowledge.data.status, sections: knowledge.data.knowledge.sections.length };
  const before = (await (await fetch('http://127.0.0.1:8788/metrics')).json()).geminiCalls;
  await owner.reload();
  await approved(owner);
  const restored = await api(owner, path);
  assert.deepEqual(restored.data.knowledge, knowledge.data.knowledge);
  assert.equal((await (await fetch('http://127.0.0.1:8788/metrics')).json()).geminiCalls, before);
  assert.equal((await metrics(owner)).activeListeners, 4);
  report.checks.push('PDF, índice de complemento, guia publicado, janela de gestão responsiva; SQLite recuperado após reload sem repetir Gemini');
  for (let i = 0; i < 3; i++) {
    await owner.locator('#account-button').click();
    await owner.locator('#logout-button').click();
    await owner.waitForFunction(() => globalThis.__ACERVO_METRICS__.activeListeners === 0);
    await login(owner, 'proprietario@acervo.test');
    await approved(owner);
    assert.equal((await metrics(owner)).activeListeners, 4);
  }
  report.checks.push('três ciclos de login/logout: zero listeners ao sair, quatro ao voltar');
  // Upload real de um PDF fictício, passando pelo cadastro e envio em blocos.
  await owner.locator('[data-add]').first().click();
  await owner.locator('#pdf-file').setInputFiles({ name: 'Ilha de Teste.pdf', mimeType: 'application/pdf', buffer: testPdf(['Preparacao: embaralhe seis cartas de teste.', `Turno: mova o barco. Teste ${Date.now()}`]) });
  await owner.locator('#game-title').fill('Ilha de Teste');
  await owner.locator('[data-step-target="3"]').click();
  await owner.locator('[name=confirmed]').check();
  await owner.locator('#save-game').click();
  await owner.waitForFunction(() => !document.querySelector('#upload-dialog').open);
  await owner.locator('.card-main').filter({ hasText: 'Ilha de Teste' }).waitFor();
  report.checks.push('cadastro fictício salvo no Firestore e Drive simulado');
  // Revogação real pelas regras e perfil em tempo real.
  await owner.locator('#manage-button').click();
  await owner.locator('[data-admin-tab=people]').click();
  const person = owner.locator('#all-users .person-row').filter({ hasText: email });
  await person.getByRole('button', { name: 'Gerenciar', exact: true }).click();
  await owner.locator('#person-actions').getByRole('button', { name: 'Bloquear conta', exact: true }).click();
  await pending.waitForFunction(() => !document.body.classList.contains('access-approved'));
  assert.equal((await api(pending, path)).status, 403);
  report.checks.push('bloqueio em sessão aberta interrompe conteúdo e rejeita API direta');
  if (await owner.locator('#person-dialog').evaluate((d) => d.open)) await owner.locator('[data-close=person-dialog]').click();
  if (await owner.locator('#admin-dialog').evaluate((d) => d.open)) await owner.locator('[data-close=admin-dialog]').click();
  await owner.locator('.card-main').filter({ hasText: 'Ilha de Teste' }).click();
  await openGameManagement(owner, 'manage-documents-section');
  await owner.locator('#delete-game').click();
  await owner.locator('#confirm-delete').click();
  await owner.waitForFunction(() => !document.querySelector('#delete-dialog').open && ![...document.querySelectorAll('.card-main')].some((card) => card.textContent.includes('Ilha de Teste')));
  report.checks.push('exclusão confirmada pelo proprietário remove o jogo e seus arquivos fictícios');
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.errors, []);
  report.worker = await (await fetch('http://127.0.0.1:8788/metrics')).json();
  assert.equal(report.worker.files, initialFiles, 'A exclusão deve remover também os arquivos novos, preservando os anteriores.');
  assert.deepEqual(report.worker.blockedOutbound, []);
  report.passed = true;
} finally {
  await mkdir('test-output', { recursive: true });
  await writeFile('test-output/development-browser-report.json', JSON.stringify(report, null, 2));
  for (const context of contexts) await context.close();
  await browser.close();
}
console.log(JSON.stringify({ passed: report.passed, checks: report.checks, viewports: report.viewports, externalRequests: report.externalRequests.length }, null, 2));
