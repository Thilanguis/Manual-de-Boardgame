import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, Timestamp } from 'firebase/firestore';
import { workerFixture } from './worker-browser-fixture.mjs';
import { OWNER_UID } from '../js/permissions.js';
import { draftContextKey } from '../worker/src/draft-knowledge.js';

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) throw new Error('Somente emuladores locais.');
const require = createRequire(resolve('tests/runtime/package.json'));
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts } = require('pdf-lib');
const project = 'demo-acervo',
  base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186',
  title = 'Sushi Go Party!';
const fromPublisher = process.env.ACERVO_TEST_PUBLISHER === '1';
const fromModel = process.env.ACERVO_TEST_MODEL_PROFILE === '1';
const env = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]), rules: await readFile('firestore.rules', 'utf8') } });
const backend = await workerFixture({
  project,
  origin: base,
  initialFiles: [],
  enableKnowledge: true,
  manualKnowledge: true,
  port: 8787,
  knowledgeOptions: {
    catalogGame: { title },
    ...(fromPublisher || fromModel ? { emptyPublicSources: true } : {}),
    ...(fromPublisher ? { publisherHtml: await readFile('tests/fixtures/gamewright-profile.html', 'utf8') } : {}),
    names: [title],
    minPlayers: 2,
    maxPlayers: 8,
    durationMinutes: 20,
    recommendedAge: 8,
    overviewText: 'Escolha cartas e passe a mão restante, formando combinações para marcar pontos.'.repeat(fromModel ? 30 : 1),
    actionTitle: 'Selecionar cartas',
    actionText: 'Escolha uma carta e passe as demais cartas ao próximo jogador.',
  },
});
if (!fromPublisher && !fromModel) {
  backend.configuration.BGG_TOKEN = 'fixture-bgg';
  backend.configuration.BGG_LOGO_URL = 'https://thilanguis.github.io/Manual-de-Boardgame/assets/powered-by-bgg.svg';
  backend.configuration.LUDOPEDIA_TOKEN = 'fixture-ludopedia';
}
const catalogRequests = fromPublisher || fromModel ? 0 : 4;
const expected = {
  title,
  edition: fromPublisher || fromModel ? '' : '2025',
  description: 'Escolha cartas e passe a mão restante, formando combinações para marcar pontos.',
  minPlayers: 2,
  maxPlayers: 8,
  minDurationMinutes: fromPublisher ? 30 : 20,
  maxDurationMinutes: fromPublisher ? 30 : 20,
  recommendedAge: 8,
  tags: ['Jogo de cartas'],
  mechanics: ['Seleção de cartas', 'Coleção de conjuntos'],
  gameType: 'Competitivo',
};
backend.knowledge.faults.metadata = (prompt) => {
  assert.equal(prompt.game.title, title, 'título corrigido no prompt');
  if (fromModel) return Object.fromEntries(Object.keys(expected).map((key) => [key, null]));
  const manual = prompt.sources.find((s) => s.pages),
    pub = prompt.sources.find((s) => s.profileOnly && (fromPublisher ? s.catalogSource === 'publisher' : s.name === 'Wikidata'));
  assert(pub, 'catálogo disponível na mesma chamada Gemini');
  return Object.fromEntries(
    Object.entries(expected).map(([key, value]) => [
      key,
      !value || (fromPublisher && ['minDurationMinutes', 'maxDurationMinutes', 'recommendedAge'].includes(key))
        ? null
        : ['minDurationMinutes', 'maxDurationMinutes', 'recommendedAge'].includes(key)
          ? { value, sourceId: pub.id, quote: JSON.stringify(pub.facts) }
          : { value, sourceId: manual.id, page: 1, evidenceId: manual.pages[0].passages[0].id },
    ]),
  );
};
if (fromModel) backend.knowledge.faults.modelProfile = { requestedTitle: title, requestedEdition: '', recognized: true, fields: Object.fromEntries(Object.entries(expected).filter(([key]) => !['title', 'edition'].includes(key))) };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  external = [];
async function api(page, path, input) {
  return page.evaluate(
    async ({ url, input }) => {
      const { getAuth } = await import('/__dev/sdk/firebase-auth.js');
      const token = await getAuth().currentUser.getIdToken();
      const response = await fetch(url, { method: input ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(input ? { 'Content-Type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
      return { status: response.status, data: await response.json() };
    },
    { url: backend.apiBase + path, input },
  );
}
async function stored(path) {
  let value;
  await env.withSecurityRulesDisabled(async (c) => {
    value = (await getDoc(doc(c.firestore(), ...path.split('/')))).data();
  });
  return value;
}
try {
  await env.clearFirestore();
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: OWNER_UID, email: 'combined-owner@example.test', password: 'Local-password-123' }),
  });
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'users', OWNER_UID), {
      uid: OWNER_UID,
      name: 'Proprietário de teste',
      email: 'combined-owner@example.test',
      role: 'superadmin',
      status: 'approved',
      permissions: { approveUsers: true, addGames: true, editGames: true, deleteGames: true },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      version: 1,
      lastEventId: '',
    });
    await setDoc(doc(c.firestore(), 'settings', 'library'), { publicRead: false, version: 1, updatedAt: Timestamp.now(), lastEventId: '' });
  });
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', (r) => {
    const url = new URL(r.request().url());
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) return r.continue();
    if (url.href === backend.configuration.BGG_LOGO_URL) return r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="20"><text y="15">Fixture BGG</text></svg>' });
    external.push(url.origin);
    return r.abort();
  });
  await context.route('**/config/app-config.js', (r) =>
    r.fulfill({
      contentType: 'text/javascript',
      body: `export const APP_CONFIG=${JSON.stringify({ firebase: { apiKey: 'demo-key', projectId: project, authDomain: project + '.firebaseapp.com', appId: '1:000:web:combined' }, ownerUid: OWNER_UID, sdkBase: '/__dev/sdk', emulators: { auth: 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST, host: '127.0.0.1', port: Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]) }, fileStorage: { apiBase: backend.apiBase }, enableGoogleLogin: false, maxPdfBytes: 52428800 })};`,
    }),
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(base);
  await page.locator('#login-dialog').waitFor();
  await page.locator('#login-form [name=email]').fill('combined-owner@example.test');
  await page.locator('#login-form [name=password]').fill('Local-password-123');
  await page.locator('#login-submit').click();
  await page.locator('[data-add]').first().click();
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle('sushi_go_party_manual_63713');
  const sheet = pdf.addPage();
  [
    title,
    fromPublisher ? 'www.gamewright.com. Para 2 a 8 jogadores. Idades: 8+.' : fromModel ? 'Para 2 a 8 jogadores. Idades: 8+.' : 'Edição de 2025. Para 2 a 8 jogadores.',
    'Escolha uma carta e passe as demais cartas para o próximo jogador.',
    'Forme conjuntos de cartas e compare os pontos. Quem tem mais pontos vence.',
  ].forEach((s, i) => sheet.drawText(s, { x: 30, y: 760 - i * 30, size: 12, font }));
  const bytes = Buffer.from(await pdf.save());
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const legacySources = [{ id: 'manual-1', documentId: 'main', sourceHash: hash, pages: [{ page: 1, text: 'Análise anterior com o título técnico do arquivo.' }] }];
  const legacyKey = await draftContextKey(OWNER_UID, legacySources);
  await backend.knowledge.storage.put('job:' + legacyKey, {
    status: 'ready',
    revision: 1,
    knowledge: { title: 'sushi_go_party_manual_63713', edition: '', sources: legacySources, profile: {}, profileAnalysis: { version: 1, complete: true }, sections: [] },
  });
  await page.locator('#pdf-file').setInputFiles({ name: 'sushi_go_party_manual_63713.pdf', mimeType: 'application/pdf', buffer: bytes });
  await page.locator('#game-form').waitFor({ state: 'visible' });
  await page.locator('#game-title').fill(title);
  await page.locator('#game-next').click();
  assert.equal(backend.knowledge.calls.length, 0, 'abrir não gera');
  assert.equal(backend.knowledge.discoveryCalls.length, 0);
  assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '');
  await page.locator('[data-research-search]').click();
  await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled, null, { timeout: 45000 });
  assert.equal(backend.knowledge.calls.length, 1, await page.locator('[data-research-status]').textContent());
  assert.equal(backend.knowledge.discoveryCalls.length, 1, 'descoberta adicional limitada e contada separadamente');
  for (const [key, value] of Object.entries(expected)) assert.equal(await page.locator(key === 'title' ? '[data-metadata-title]' : `#game-form [name=${key}]`).inputValue(), Array.isArray(value) ? value.join(', ') : String(value), key);
  for (const source of fromPublisher || fromModel ? [] : ['bgg', 'ludopedia'])
    assert(
      backend.knowledge.catalogCalls.some((url) => url.includes(source === 'bgg' ? 'boardgamegeek.com' : 'ludopedia.com.br')),
      source + ' participa da consolidação',
    );
  assert.equal(backend.knowledge.catalogCalls.length, catalogRequests, JSON.stringify({ calls: backend.calls.filter((c) => c.path.includes('research')), details: await page.locator('[data-research-diagnostics]').textContent() }));
  await page.locator('[data-research-diagnostics]').evaluate((el) => (el.parentElement.open = true));
  if (!fromPublisher && !fromModel) {
    assert.match(await page.locator('[data-research-diagnostics]').textContent(), /Ludopedia: 1 candidato\(s\), 1 correspondência/);
    assert.match(await page.locator('[data-research-diagnostics]').textContent(), /BoardGameGeek: 1 candidato\(s\), 1 correspondência/);
  } else if (fromPublisher) {
    assert.match(await page.locator('#game-form').textContent(), /Editora · ficha pública/);
    assert.equal(backend.knowledge.publicCalls.filter((url) => url.includes('gamewright.com/product/')).length, 1);
  } else {
    assert.match(await page.locator('#game-form').textContent(), /Gemini · conhecimento do modelo/);
    assert.equal(backend.knowledge.publicCalls.filter((url) => url.includes('gamewright.com')).length, 0);
  }
  assert.equal(backend.calls.filter((c) => /\/v1\/research\/(wikidata|wikipedia)$/.test(c.path)).length, 0, 'não duplica pesquisas do servidor no frontend');
  const publicCalls = backend.knowledge.publicCalls.length;
  await page.locator('[data-research-search]').click();
  await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
  assert.equal(backend.knowledge.calls.length, 1);
  assert.equal(backend.knowledge.discoveryCalls.length, 1);
  assert.equal(backend.knowledge.publicCalls.length, publicCalls);
  assert.equal(backend.knowledge.catalogCalls.length, catalogRequests, 'cache também preserva transportes dos catálogos autorizados');
  if (fromPublisher || fromModel) {
    await mkdir('test-output/profile-research', { recursive: true });
    await page.locator('[name=minDurationMinutes]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: fromModel ? 'test-output/profile-research/model-stage2.png' : 'test-output/profile-research/publisher-stage2.png' });
  }
  await page.locator('[name=recommendedAge]').fill('9');
  await page.locator('#game-next').click();
  await page.locator('[name=confirmed]').check();
  await page.locator('#save-game').click();
  await page.locator('#upload-dialog').waitFor({ state: 'hidden', timeout: 45000 });
  let all;
  await env.withSecurityRulesDisabled(async (c) => {
    const { collection, getDocs } = await import('firebase/firestore');
    all = (await getDocs(collection(c.firestore(), 'games'))).docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  assert.equal(all.length, 1);
  const game = all[0],
    path = `/v1/games/${game.id}/knowledge`;
  assert.equal(game.recommendedAge, 9, 'correção manual salva');
  assert.equal(game.minDurationMinutes, expected.minDurationMinutes);
  assert.equal(game.maxDurationMinutes, expected.maxDurationMinutes);
  if (fromModel) {
    assert.equal(game.sources.description.source, 'Gemini · conhecimento do modelo', 'resumo separado da visão geral longa');
    assert.equal(game.sources.description.verified, false);
    assert.equal(game.sources.duration.source, 'Gemini · conhecimento do modelo');
    assert.equal(game.sources.duration.verified, false);
    assert.equal(game.sources.duration.page, undefined);
    assert.equal(game.sources.duration.url, '');
  }
  const record = await api(page, path);
  assert.equal(record.data.status, 'ready', 'conhecimento vinculado ao concluir cadastro');
  assert(record.data.knowledge.sources.some((s) => s.profileOnly));
  assert.equal(await backend.knowledge.storage.get('quota'), undefined, 'não há contador interno de gerações');
  const index = await stored(`games/${game.id}/indexes/main`);
  assert.equal(index.sourceHash, game.manual.sha256);
  await page.locator('.card-main').click();
  await page.getByRole('button', { name: 'Consultar regras', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#guide-content').textContent.includes('Escolha cartas'));
  for (const query of ['Como escolher cartas?', 'objetivo', 'cartas']) {
    await page.locator('#guide-search').fill(query);
    await page.waitForFunction(() => !document.querySelector('#guide-content').textContent.includes('Pesquisando…'));
  }
  await page.locator('#guide-close').click();
  await page.reload();
  await page.locator('.card-main').waitFor();
  await page.locator('.card-main').click();
  await page.getByRole('button', { name: 'Consultar regras', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#guide-content').textContent.includes('Escolha cartas'));
  assert.equal(backend.knowledge.calls.length, 1);
  assert.equal(backend.knowledge.discoveryCalls.length, 1, 'regras e reload não consultam os modelos');
  assert.equal(backend.knowledge.publicCalls.length, publicCalls, 'consulta/reload não refaz internet ou IA');
  assert.equal(backend.knowledge.catalogCalls.length, catalogRequests, 'consultar regras não reabre catálogos');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(backend.metrics.blockedOutbound, []);
  await mkdir('test-output/combined-profile', { recursive: true });
  await writeFile(
    fromModel ? 'test-output/combined-profile/model-browser.json' : fromPublisher ? 'test-output/combined-profile/publisher-browser.json' : 'test-output/combined-profile/browser.json',
    JSON.stringify(
      {
        game,
        profile: record.data.knowledge.profile,
        publicCalls,
        generations: backend.knowledge.calls.length,
        discoveryCalls: backend.knowledge.discoveryCalls.length,
        catalogCalls: backend.knowledge.catalogCalls,
        workerCalls: backend.calls,
        metrics: backend.metrics,
        errors,
        external,
      },
      null,
      2,
    ),
  );
  console.log(
    `Cadastro completo com nome corrigido: PDF + ${fromModel ? 'conhecimento do próprio Gemini, sem catálogos/editora; duração 20/20 e origem persistida sem fonte externa verificada' : fromPublisher ? 'ficha da editora, sem Wikimedia/BGG/Ludopedia; duração 30/30 e origem Editora; nenhuma edição inventada' : 'catálogos autorizados no servidor, duração 20/20 e edição manual'} + resumo e classificações Gemini; índice e conhecimento vinculados antes de fechar; Consultar regras e reload sem outra IA/pesquisa. Somente emuladores e serviços simulados.`,
  );
} finally {
  await browser.close();
  await backend.close();
  await env.cleanup();
}
