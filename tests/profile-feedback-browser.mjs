import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(resolve('tests/runtime/package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [],
  external = [],
  errors = [];
await mkdir('test-output/profile-feedback', { recursive: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) return r.continue();
    external.push(u.origin);
    return r.abort();
  });
  await context.route('**/js/app.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186');
  await page.evaluate(async () => {
    const { createResearchPanel } = await import('/js/research-panel.js');
    const { createMetadataForm } = await import('/js/metadata-form.js');
    const { profileUnavailable } = await import('/js/profile-availability.js');
    const form = document.querySelector('#game-form');
    form.hidden = false;
    form.reset();
    document.querySelectorAll('[data-game-step]').forEach((el) => (el.hidden = el.dataset.gameStep !== '2'));
    document.querySelector('#game-step-nav').hidden = false;
    const title = 'Sushi Go Party!',
      hash = 'a'.repeat(64);
    const current = { title, edition: '', manual: { sha256: hash, pages: 1, name: 'Manual.pdf' }, language: 'pt-BR', sources: {} };
    const source = { id: 'manual', documentId: 'main', sourceHash: hash, pages: [{ page: 1, text: 'Escolha cartas e passe as cartas restantes para marcar pontos.' }] };
    const knowledge = {
      title,
      edition: '',
      sources: [source],
      profile: {},
      fields: {},
      sections: [{ id: 'intro', topic: 'visao-geral', text: 'Escolha cartas e forme combinações para marcar pontos.', sourceId: source.id, sourceHash: hash, documentId: 'main', page: 1, quote: source.pages[0].text }],
    };
    const candidate = { source: 'wikidata', id: 'Q1', names: [{ value: title, language: 'en' }], fields: { title, minPlayers: 2, maxPlayers: 8 }, manualHash: hash, kind: 'base', license: 'CC0' };
    const snapshot = { query: title, queryStrategyVersion: 2, fetchedAt: 1, candidates: [candidate], decisions: [] };
    const health = { profileMetadataProtocol: 1, knowledgeConfigured: true, manualAiEnabled: true };
    const repo = {
      mode: 'firebase',
      session: { storageStatus: health },
      findResearch: async () => null,
      research: async (id) =>
        id === 'sources'
          ? {
              protocol: 2,
              apiVersion: '1.11.0',
              queryStrategyVersion: 2,
              sources: [
                { id: 'wikidata', enabled: true },
                { id: 'wikipedia', enabled: true },
              ],
            }
          : { candidates: id === 'wikidata' ? [candidate] : [] },
    };
    const metadata = createMetadataForm({
      form,
      getCurrent: () => current,
      apply(values) {
        Object.assign(current, values);
        for (const [key, value] of Object.entries(values)) if (form.elements.namedItem(key)) form.elements.namedItem(key).value = Array.isArray(value) ? value.join(', ') : value;
      },
    });
    let panel;
    panel = createResearchPanel({
      root: document.querySelector('#research-panel'),
      getCurrent: () => current,
      getRepository: () => repo,
      canUse: () => true,
      readPreference: () => 'pt-BR',
      writePreference() {},
      onConsolidated: (model) => metadata.update(model),
      async onPrepareDraft(options) {
        globalThis.requestOptions = options;
        panel.setKnowledgeStatus('Reconhecendo as páginas escaneadas…');
        globalThis.progressText = document.querySelector('[data-research-status]').textContent;
        const record = { status: 'ready', knowledge };
        panel.acceptKnowledge(record, current);
        const unavailable = profileUnavailable(health, { draft: true, combined: options.includePublic });
        panel.setKnowledgeStatus(unavailable.message);
        return { status: 'server_update', knowledge };
      },
    });
    panel.reset();
    await panel.run();
    repo.findResearch = async () => snapshot;
    await panel.run();
    globalThis.feedback = { current, panel, knowledge };
    const root = document.querySelector('#upload-dialog');
    document.querySelector('#upload-picker').hidden = true;
    root.showModal();
    document.querySelector('[data-research-diagnostics]').parentElement.open = true;
  });
  const state = await page.evaluate(() => ({
    progress: progressText,
    options: requestOptions,
    status: document.querySelector('[data-research-status]').textContent,
    details: document.querySelector('[data-research-diagnostics]').textContent,
    availability: document.querySelector('[data-research-availability]').textContent,
    players: [document.querySelector('[name=minPlayers]').value, document.querySelector('[name=maxPlayers]').value],
    buttons: document.querySelectorAll('[data-research-search]').length,
  }));
  assert.equal(state.options.includePublic, true);
  assert.equal(state.progress, 'Reconhecendo as páginas escaneadas…');
  assert.match(state.status, /Worker conectado ainda não oferece/);
  assert.doesNotMatch(state.status, /Nenhuma correspondência|Completando informações/);
  assert.match(state.details, /Análise antiga; ficha ainda não examinada por completo/);
  assert.doesNotMatch(state.details, /Análise concluída/);
  assert.doesNotMatch(state.availability, /Wikidata.*ainda não consultada/);
  assert.match(state.availability, /Wikipédia: sem resultados na pesquisa salva/);
  assert.deepEqual(state.players, ['2', '8']);
  assert.equal(state.buttons, 1);
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 820, height: 1100 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator('[name=minPlayers]').scrollIntoViewIfNeeded();
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      gaps: [...document.querySelectorAll('.metadata-origin')]
        .map((el) => {
          const wrapper = el.parentElement;
          const input = wrapper.querySelector('input,textarea');
          return input ? el.getBoundingClientRect().top - input.getBoundingClientRect().bottom : null;
        })
        .filter((n) => n !== null),
    }));
    assert.equal(layout.overflow, false);
    assert(layout.gaps.every((gap) => gap >= 7));
    await page.screenshot({ path: `test-output/profile-feedback/layout-${viewport.width}.png` });
    results.push({ viewport, ...layout });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await writeFile('test-output/profile-feedback/browser.json', JSON.stringify({ state, results, errors, external }, null, 2));
  console.log('Progresso único, cache legado identificado, Worker antigo explicado, fontes sem estados contraditórios e origens sem sobreposição em desktop/tablet/celular. Zero chamadas externas.');
} finally {
  await browser.close();
}
