import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { workerFixture } from './worker-browser-fixture.mjs';
import { OWNER_UID } from '../js/permissions.js';
import { openGameManagement } from './game-ui-fixture.mjs';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts } = require('pdf-lib');
const project = 'demo-acervo',
  base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) throw new Error('Exige emuladores locais.');
const port = Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]);
const env = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port, rules: await readFile('firestore.rules', 'utf8') } });
const backend = await workerFixture({ project, origin: base, initialFiles: [], enableKnowledge: true, manualKnowledge: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const contexts = [],
  errors = [];
const title = 'O Senhor dos Anéis: Sina da Sociedade';
async function inspect(path) {
  let value;
  await env.withSecurityRulesDisabled(async (c) => {
    value = (await getDoc(doc(c.firestore(), ...path.split('/')))).data();
  });
  return value;
}
async function eventually(fn, condition) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const value = await fn();
    if (condition(value)) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Estado esperado não foi confirmado.');
}
async function api(page, path, input) {
  return page.evaluate(
    async ({ url, input }) => {
      const { getAuth } = await import('/__dev/sdk/firebase-auth.js');
      const token = await getAuth().currentUser?.getIdToken();
      const response = await fetch(url, {
        method: input ? 'POST' : 'GET',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(input ? { 'Content-Type': 'application/json' } : {}) },
        body: input ? JSON.stringify(input) : undefined,
      });
      return { status: response.status, data: await response.json() };
    },
    { url: backend.apiBase + path, input },
  );
}
async function account(uid, email, role, status) {
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, email, password: 'Fixture-password-123' }),
  });
  await env.withSecurityRulesDisabled((c) =>
    setDoc(doc(c.firestore(), 'users', uid), {
      uid,
      email,
      name: role,
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
async function pageFor(email) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  contexts.push(context);
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await context.route('**/config/app-config.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export const APP_CONFIG=${JSON.stringify({ firebase: { apiKey: 'demo-key', projectId: project, authDomain: `${project}.firebaseapp.com`, appId: '1:000:web:unified' }, ownerUid: OWNER_UID, sdkBase: '/__dev/sdk', emulators: { auth: `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, host: '127.0.0.1', port }, fileStorage: { apiBase: backend.apiBase }, enableGoogleLogin: false, maxPdfBytes: 52428800 })};`,
    }),
  );
  await context.route('**/v1/research/sources', (route) => route.fulfill({ json: { protocol: 2, sources: [{ id: 'wikidata', name: 'Wikidata', url: 'https://example.test', enabled: true, reason: 'fixture' }] } }));
  await context.route('**/v1/research/wikidata', (route) =>
    route.fulfill({
      json: {
        source: 'wikidata',
        candidates: [
          {
            source: 'wikidata',
            id: 'Q137295527',
            identifiers: { wikidata: 'Q137295527', bgg: '436217' },
            names: [
              { value: title, language: 'pt-BR' },
              { value: 'The Lord of the Rings: Fate of the Fellowship', language: 'en' },
            ],
            fields: { title, description: 'Resumo público de teste: coopere com a Sociedade para proteger Frodo.', minPlayers: 2, maxPlayers: 5, minDurationMinutes: 60, maxDurationMinutes: 150 },
            kind: 'base',
            edition: '',
            language: 'pt-BR',
            license: 'CC0',
            conflicts: [],
          },
        ],
      },
    }),
  );
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(base);
  await page.locator('#login-dialog').waitFor();
  if (email) {
    await page.locator('#login-form [name=email]').fill(email);
    await page.locator('#login-form [name=password]').fill('Fixture-password-123');
    await page.locator('#login-submit').click();
  }
  return page;
}
try {
  await account(OWNER_UID, 'unified-owner@example.test', 'superadmin', 'approved');
  await account('unified-reader', 'unified-reader@example.test', 'user', 'approved');
  await account('unified-pending', 'unified-pending@example.test', 'user', 'pending');
  await account('unified-admin', 'unified-admin@example.test', 'subadmin', 'approved');
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'settings', 'library'), { publicRead: false, version: 1, updatedAt: Timestamp.now(), lastEventId: '' }));
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle(title);
  for (const lines of [
    [title, 'Objetivo: a Sociedade coopera para proteger Frodo e cumprir a missao.', 'Jogadores: 1 a 5', 'Duracao: 60 a 150 minutos', 'Idade: 14 anos'],
    ['Preparacao', 'Distribua quatro cartas e coloque as fichas sobre a mesa. Cada jogador recebe um personagem.'],
    ['Acoes e combate', 'Para atacar, gaste uma acao e consulte a carta do cenario.', 'Movimento: mova as pecas respeitando o limite do cenario.'],
  ]) {
    const sheet = pdf.addPage();
    lines.forEach((line, i) => sheet.drawText(line, { x: 30, y: 760 - 35 * i, size: i ? 12 : 18, font }));
  }
  const bytes = Buffer.from(await pdf.save());
  const owner = await pageFor('unified-owner@example.test');
  await owner.locator('[data-add]').first().click();
  const attachments = [];
  for (const name of ['Referencia', 'Errata']) {
    const document = await PDFDocument.create();
    document.addPage().drawText(`${name}: organize as cartas e consulte as regras do manual principal.`, { x: 30, y: 700, size: 12 });
    attachments.push({ name: `${name}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await document.save()) });
  }
  await owner.locator('#pdf-file').setInputFiles([{ name: 'Sina_da_Sociedade.pdf', mimeType: 'application/pdf', buffer: bytes }, ...attachments]);
  await owner.waitForFunction(() => document.querySelectorAll('[data-registration-document]').length === 2 && !document.querySelector('#registration-pdfs').disabled);
  await owner.getByLabel('Tipo de Referencia.pdf', { exact: true }).selectOption('referencia');
  await owner.getByLabel('Tipo de Errata.pdf', { exact: true }).selectOption('errata');
  let failedAttachment = false,
    primaryUploads = 0;
  await owner.route('**/v1/uploads', (route) => {
    const input = route.request().postDataJSON();
    if (input.kind === 'manual') primaryUploads++;
    if (input.kind === 'document' && input.name === 'Errata.pdf' && !failedAttachment) {
      failedAttachment = true;
      return route.fulfill({ status: 503, json: { error: 'Envio interrompido no teste.' } });
    }
    return route.continue();
  });
  await owner.locator('#game-title').fill(title);
  await owner.locator('[data-research-search]').click();
  await owner.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
  await owner.locator('.research-card').getByRole('button', { name: 'Conferir informações', exact: true }).click();
  assert.equal(await owner.locator('[data-metadata-field=minPlayers].metadata-conflict').count(), 1, 'conflito numérico aparece no campo, não em outra ficha');
  assert.equal(await owner.locator('[name=minPlayers]').inputValue(), '1', 'divergência externa não substitui o PDF sem seleção');
  await owner.locator('[name=language]').selectOption('pt-BR');
  await owner.locator('[data-step-target="3"]').click();
  await owner.locator('[name=confirmed]').check();
  await owner.locator('#save-game').click();
  await owner.waitForFunction(() => !document.querySelector('#save-error').hidden && document.querySelector('#save-error').textContent.includes('alguns PDFs'));
  assert.equal(await owner.locator('#upload-dialog').evaluate((dialog) => dialog.open), true);
  assert.equal(await owner.locator('[data-registration-document]').count(), 1, `somente o PDF que falhou continua pendente: ${await owner.locator('.registration-pdf-row .inline-error').allTextContents()}`);
  assert.equal(backend.knowledge.calls.length, 0, 'análise não começa antes de concluir o lote do cadastro');
  await owner.locator('[data-step-target="3"]').click();
  await owner.locator('[name=confirmed]').check();
  await owner.locator('#save-game').click();
  await owner.waitForFunction(() => !document.querySelector('#upload-dialog').open && document.querySelectorAll('.card-main').length === 1);
  assert.equal(primaryUploads, 1, 'tentar novamente um complemento não reenvia o manual principal');
  const game = await eventually(async () => {
    const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${project}/databases/(default)/documents/games`, { headers: { Authorization: 'Bearer owner' } });
    return (await response.json()).documents?.[0];
  }, Boolean);
  const id = game.name.split('/').at(-1),
    path = `/v1/games/${id}/knowledge`;
  const ready = await eventually(
    () => api(owner, path),
    (response) => response.data?.status === 'ready',
  );
  assert.equal(backend.knowledge.calls.length, 1, 'cadastro e preparo fazem uma única geração');
  assert.equal(
    ready.data.knowledge.sections.every((section) => section.review === 'unreviewed'),
    true,
  );
  const saved = await inspect(`games/${id}`);
  assert.equal(saved.sources.metadata.manualHash, saved.manual.sha256);
  assert.equal(saved.sources.metadata.consistency.minPlayers, 'conflict');
  assert.deepEqual(
    saved.sources.metadata.alternatives.minPlayers.map((fact) => fact.value),
    [1, 2],
    'a divergência e suas origens foram persistidas',
  );
  assert.equal(Object.keys(saved.documents).length, 3);
  assert.deepEqual(
    Object.values(saved.documents)
      .filter((item) => item.id !== 'main')
      .map((item) => item.documentType)
      .sort(),
    ['errata', 'referencia'],
  );
  console.log('Cadastro salvo; análise automática única concluída.');
  assert.match(saved.description, /Resumo público de teste/);
  assert.equal(ready.data.knowledge.fields.minPlayers.value, 1);
  const illustration = backend.files.get(saved.cover.driveFileId);
  backend.files.set('legacy-image', { ...illustration, id: 'legacy-image', appProperties: { acervoProject: project, gameId: id, kind: 'guideAsset' } });
  const legacySection = {
    id: crypto.randomUUID(),
    title: 'Preparação revisada',
    text: 'Distribua quatro cartas e organize a mesa conforme o conteúdo revisado antigo.',
    type: 'texto',
    reviewed: true,
    language: 'pt-BR',
    page: 2,
    documentId: 'main',
    sourceHash: saved.manual.sha256,
    imageId: 'legacy-image',
    caption: '',
  };
  const legacy = {
    gameId: id,
    schemaVersion: 1,
    revision: 1,
    content: JSON.stringify([legacySection]),
    sourceHash: saved.manual.sha256,
    assets: { 'legacy-image': { mimeType: 'image/jpeg' } },
    indexFileId: '',
    reviewed: true,
    updatedAt: Timestamp.now(),
    updatedBy: OWNER_UID,
    lastEventId: '',
  };
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'gameGuides', id), { ...legacy, draftRevision: 1 });
    await setDoc(doc(c.firestore(), 'guideDrafts', id), { ...legacy, content: JSON.stringify([{ ...legacySection, text: 'Rascunho antigo privado preservado.' }]) });
  });
  const legacyBefore = await inspect(`gameGuides/${id}`),
    draftBefore = await inspect(`guideDrafts/${id}`);
  await owner.locator('.card-main').click();
  assert.equal(await owner.locator('#detail-documents .document-reading-row').count(), 3, 'a ficha exibe os três PDFs do cadastro inicial');
  assert.equal(await owner.locator('#learn-game, #edit-guide, [data-game-management=manage-guide]').count(), 0);
  await owner.getByRole('button', { name: 'Consultar regras', exact: true }).click();
  await owner.waitForFunction(() => document.querySelector('#guide-content').textContent.includes('A Sociedade coopera'));
  assert.equal(await owner.locator('.rule-result').count(), 1, 'início mostra resumo, não dezenas de títulos');
  assert((await owner.locator('.rules-topics button').count()) <= 12);
  for (const query of ['Como funciona o ataque?', 'preparação', 'movimento', 'objetivo', 'ataque']) {
    console.log(`Consulta local: ${query}`);
    await owner.locator('#guide-search').fill(query);
    try {
      await owner.waitForFunction((query) => document.querySelector('#guide-content').dataset.query === query && document.querySelectorAll('.rule-result').length > 0, query, { timeout: 7000 });
    } catch (error) {
      console.log(
        await owner.evaluate(() => ({
          query: document.querySelector('#guide-search').value,
          rendered: document.querySelector('#guide-content').dataset.query,
          status: document.querySelector('#guide-status').textContent,
          text: document.querySelector('#guide-content').textContent.slice(0, 1800),
        })),
      );
      throw error;
    }
    if (query === 'preparação') await owner.waitForFunction(() => document.querySelector('.rule-result img')?.naturalWidth > 0);
  }
  assert.equal(backend.knowledge.calls.length, 1);
  await owner.getByRole('button', { name: 'Ver no manual · p. 3' }).first().click();
  await owner.waitForFunction(() => document.querySelector('#reader-status').hidden && document.querySelector('#page-number').value === '3');
  await owner.locator('#reader-close').click();
  await owner.locator('.card-main').click();
  await openGameManagement(owner, 'manage-information');
  assert.deepEqual(await owner.locator('.management-tabs button').allTextContents(), ['PDFs', 'Informações']);
  await owner.waitForFunction(() => document.querySelector('.knowledge-status')?.textContent.includes('Conhecimento disponível'));
  assert.equal(await owner.locator('.knowledge-section select').count(), 0);
  assert.equal(await owner.locator('.knowledge-section textarea').first().isVisible(), false);
  await owner.locator('.knowledge-details > summary').click();
  await owner.locator('.knowledge-section').filter({ hasText: 'Como atacar' }).locator('summary').click();
  const correction = owner.locator('.knowledge-section').filter({ hasText: 'Como atacar' });
  await correction.locator('textarea').fill('Para atacar, gaste uma ação e consulte a carta. Correção manual preservada.');
  await correction.getByRole('button', { name: 'Salvar correção' }).click();
  await eventually(
    () => api(owner, path),
    (response) => response.data?.knowledge?.sections.some((section) => section.review === 'manual'),
  );
  await owner.getByRole('button', { name: 'Atualizar conhecimento com IA', exact: true }).click();
  const updated = await eventually(
    () => api(owner, path),
    (response) => response.data?.status === 'ready' && backend.knowledge.calls.length === 2,
  );
  console.log('Correção salva e preservada após atualização explícita.');
  assert(updated.data.knowledge.sections.some((section) => section.text.includes('Correção manual preservada')));
  await owner.reload();
  await owner.locator('.card-main').click();
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['tablet', 768, 1024],
    ['mobile', 390, 844],
  ]) {
    await owner.setViewportSize({ width, height });
    if (!(await owner.locator('#guide-dialog').evaluate((node) => node.open))) await owner.locator('#quick-rules').click();
    await owner.locator('#guide-search').fill('atacar');
    await owner.locator('.rule-result').first().waitFor();
    assert.match(await owner.locator('#guide-content').textContent(), /Correção manual preservada/);
    assert(await owner.locator('#guide-dialog').evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
    await mkdir('test-output', { recursive: true });
    await owner.screenshot({ path: `test-output/unified-rules-${name}.png` });
  }
  assert.equal(backend.knowledge.calls.length, 2, 'recarga, assuntos e pesquisas não geram IA');
  // A indisponibilidade de uma fonte não bloqueia as demais.
  await owner.context().route(`**/v1/games/${id}/knowledge`, (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 503, json: { error: 'Explicações indisponíveis no teste' } }) : route.continue()));
  await owner.locator('#guide-close').click();
  await owner.locator('.card-main').click();
  await owner.locator('#quick-rules').click();
  await owner.locator('#guide-search').fill('movimento');
  await owner.waitForFunction(() => document.querySelector('#guide-content').dataset.query === 'movimento' && document.querySelectorAll('.rule-result').length > 0);
  assert.match(await owner.locator('#guide-content').textContent(), /Trecho do PDF/);
  assert.match(await owner.locator('#guide-status').textContent(), /explicações estão indisponíveis/);
  await owner.context().unroute(`**/v1/games/${id}/knowledge`);
  await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), 'games', id), { recommendedAge: null }));
  await owner.reload();
  await owner.locator('.card-main').click();
  await openGameManagement(owner, 'manage-information');
  await owner.locator('#edit-game').click();
  await owner.waitForFunction(() => document.querySelector('[name=recommendedAge]').value === '14');
  await owner.locator('[data-step-target="2"]').click();
  assert.equal(await owner.locator('#game-form [name=description]').inputValue(), saved.description, 'sugestão não substitui descrição confirmada');
  await owner.locator('[data-step-target="1"]').click();
  await owner.locator('[data-step-target="2"]').click();
  assert.equal(await owner.locator('[name=recommendedAge]').inputValue(), '14');
  await owner.locator('[data-step-target="3"]').click();
  await owner.locator('[name=confirmed]').check();
  await owner.locator('#save-game').click();
  await owner.waitForFunction(() => !document.querySelector('#upload-dialog').open);
  assert.equal((await inspect(`games/${id}`)).recommendedAge, 14, 'campo vazio da etapa 2 foi salvo após confirmação');
  assert.equal(backend.knowledge.calls.length, 2);
  assert.deepEqual(await inspect(`gameGuides/${id}`), legacyBefore);
  assert.deepEqual(await inspect(`guideDrafts/${id}`), draftBefore);
  const reader = await pageFor('unified-reader@example.test');
  await reader.locator('.card-main').click();
  assert.equal(await reader.locator('#detail-admin').isVisible(), false);
  await reader.locator('#quick-rules').click();
  await reader.locator('#guide-search').fill('atacar');
  await reader.locator('.rule-result').first().waitFor();
  assert.equal((await api(reader, path, { force: true, requestId: crypto.randomUUID() })).status, 403);
  await reader.locator('#guide-close').click();
  await reader.locator('.card-main').click();
  await reader.locator('#read-manual').click();
  await reader.waitForFunction(() => !document.querySelector('#reader').hidden && document.querySelector('#reader-status').hidden);
  await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), 'users', 'unified-reader'), { status: 'blocked', updatedAt: Timestamp.now() }));
  await reader.waitForFunction(() => document.querySelector('#reader').hidden && !document.querySelector('.card-main'));
  assert.equal(await reader.locator('#pdf-canvas').evaluate((node) => node.width), 0, 'revogação descarta o PDF já recebido');
  assert.equal((await api(reader, path)).status, 403, 'token anterior não mantém autorização após bloqueio');
  const admin = await pageFor('unified-admin@example.test');
  await admin.locator('.card-main').click();
  await openGameManagement(admin, 'manage-information');
  assert.equal(await admin.locator('#delete-game').isVisible(), false);
  assert.deepEqual(await admin.locator('.management-tabs button').allTextContents(), ['PDFs', 'Informações']);
  const pending = await pageFor('unified-pending@example.test');
  await pending.waitForFunction(() => document.querySelector('#session-status').textContent.includes('aguardando aprovação'));
  assert.equal(await pending.locator('.card-main').count(), 0);
  assert.equal((await api(pending, path)).status, 403);
  const visitor = await pageFor();
  assert.equal(await visitor.locator('.card-main').count(), 0);
  assert.equal((await api(visitor, path)).status, 401);
  assert.equal(backend.knowledge.calls.length, 2);
  assert.deepEqual(errors, []);
  assert.deepEqual(backend.metrics.blockedOutbound, []);
  console.log('Consulta única + Firebase/Worker reais isolados: cadastro, PDF verificado, uma geração automática, etapa 2, pesquisa sem IA, correção e atualização preservadas, legado intacto, recarga, permissões e 3 telas.');
} finally {
  await browser.close();
  await backend.close();
  await env.cleanup();
}
