import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const scenario of ['invalid-result', 'invalidate', 'pdf-offline', 'quota', 'pending-title', 'pending-edition', 'pending-pdf', 'pdf-no-facts']) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', (r) => (['localhost', '127.0.0.1'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort()));
    await context.route('**/js/app.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186');
    try {
      const output = await page.evaluate(async (scenario) => {
        const { createResearchPanel } = await import('/js/research-panel.js'),
          { createMetadataForm } = await import('/js/metadata-form.js'),
          { createInformationFlow } = await import('/js/information-flow.js');
        const cache = await import('/js/private-cache.js');
        cache.requirePrivateCache();
        await cache.unlockPrivateCache('audit-owner', new Uint8Array(32).fill(7));
        const form = document.querySelector('#game-form');
        form.reset();
        let current = { id: 'audit-game', title: 'Jogo', edition: '3', language: 'pt-BR', manual: { sha256: 'a'.repeat(64), pages: 1 }, sources: {} };
        const text = 'Edição: 3\nJogo cooperativo para 2 a 4 jogadores. Duração: 30 a 60 minutos. Idade: 14 anos.\nCategorias: Fantasia\nMecânicas: Gestão de cartas';
        const source = { id: 'manual', documentId: 'main', sourceHash: current.manual.sha256, language: 'pt-BR', pages: [{ page: 1, text }] };
        const valid = {
          status: 'ready',
          knowledge: {
            title: 'Jogo',
            edition: '3',
            sources: [source],
            sections: [],
            profile: { recommendedAge: { value: 14, sourceId: 'manual', page: 1, quote: text } },
            fields: { recommendedAge: { value: 14, sourceId: 'manual', page: 1, quote: text } },
          },
        };
        let generations = 0,
          indexReads = 0,
          model;
        const repository = {
          projectId: 'demo-acervo',
          session: { user: { uid: 'audit-owner' }, canWrite: true, canRead: true, storageStatus: { firebaseProject: 'demo-acervo', knowledgeConfigured: false, manualAiEnabled: false } },
          getKnowledge: async () => (scenario === 'quota' ? { status: 'quota', retryAt: Date.now() + 60000, message: 'Cota esgotada', knowledge: null } : null),
          generateKnowledge: async () => {
            generations++;
            throw new Error('Não deveria gerar');
          },
          getTechnicalIndex: async () => {
            indexReads++;
            return {
              schemaVersion: 1,
              gameId: current.id,
              documentId: 'main',
              sourceHash: current.manual.sha256,
              pageCount: 1,
              pages: [{ page: 1, text: scenario === 'pdf-no-facts' ? 'Documento preparado. Consulte as regras oficiais.' : text }],
              headings: [],
              analysisComplete: true,
            };
          },
          research: async (source) =>
            source === 'sources'
              ? { protocol: 2, sources: [{ id: 'wikidata', enabled: true }] }
              : { candidates: [{ source: 'wikidata', id: 'Q1', fields: { title: 'Jogo', tags: ['Aventura'] }, names: [{ value: 'Jogo', language: 'pt-BR' }], language: 'pt-BR', edition: '3', kind: 'base', license: 'CC0' }] },
        };
        const metadata = createMetadataForm({
          form,
          getCurrent: () => current,
          apply: (values) => {
            Object.assign(current, values);
            for (const [key, value] of Object.entries(values)) {
              const input = form.elements.namedItem(key);
              if (input) input.value = Array.isArray(value) ? value.join(', ') : (value ?? '');
            }
          },
          onManualEdit: (key, value) => (current[key] = value),
        });
        let flow;
        const panel = createResearchPanel({
          root: document.querySelector('#research-panel'),
          getCurrent: () => current,
          getRepository: () => repository,
          canUse: () => true,
          readPreference: () => ({}),
          writePreference() {},
          onConsolidated: (next) => {
            model = next;
            metadata.update(next);
          },
          onPrepareDraft: () => flow.complete(),
          onInvalidate: () => flow?.invalidate(),
        });
        flow = createInformationFlow({
          getRepository: () => repository,
          getCurrent: () => current,
          canUse: () => true,
          draftProfile: { cancel() {}, prepare: async () => {} },
          onRecord: (r, g) => panel.acceptKnowledge(r, g),
          onPdf: (c) => panel.acceptPdf(c),
          onStatus: (s) => panel.setKnowledgeStatus(s),
        });
        panel.reset();
        if (scenario === 'invalid-result' || scenario === 'invalidate') {
          panel.acceptKnowledge(valid, current);
          form.elements.description.value = 'Minha sinopse revisada';
          form.elements.description.dispatchEvent(new Event('input', { bubbles: true }));
          if (scenario === 'invalid-result') panel.acceptKnowledge({ status: 'ready', knowledge: null }, current);
          else {
            current = { ...current, title: 'Outro jogo', manual: { ...current.manual, sha256: 'b'.repeat(64) } };
            panel.invalidate();
          }
          return { fields: model?.fields || {}, age: form.elements.recommendedAge.value, description: form.elements.description.value };
        }
        if (scenario.startsWith('pending-')) {
          repository.session.storageStatus.knowledgeConfigured = true;
          repository.session.storageStatus.manualAiEnabled = true;
          let finish;
          repository.generateKnowledge = () => {
            generations++;
            return new Promise((resolve) => (finish = resolve));
          };
          const pending = flow.complete();
          while (!finish) await new Promise((resolve) => setTimeout(resolve, 1));
          if (scenario === 'pending-title') current = { ...current, title: 'Outro jogo' };
          if (scenario === 'pending-edition') current = { ...current, edition: '4' };
          if (scenario === 'pending-pdf') current = { ...current, manual: { ...current.manual, sha256: 'b'.repeat(64) } };
          panel.invalidate();
          finish(valid);
          await pending;
          flow.stop();
          return { fields: model?.fields || {}, age: form.elements.recommendedAge.value, generations };
        }
        await flow.load();
        await panel.run();
        await flow.complete();
        flow.stop();
        return {
          fields: model?.fields || {},
          age: form.elements.recommendedAge.value,
          description: form.elements.description.value,
          indexReads,
          generations,
          status: document.querySelector('[data-research-status]').textContent,
          buttons: [...document.querySelectorAll('[data-research-search]')].length,
        };
      }, scenario);
      if (['invalid-result', 'invalidate'].includes(scenario)) {
        assert.equal(output.fields.recommendedAge, undefined);
        assert.equal(output.age, '');
        assert.equal(output.description, 'Minha sinopse revisada');
      } else if (scenario.startsWith('pending-')) {
        assert.equal(output.age, '');
        assert.equal(output.fields.recommendedAge, undefined);
        assert.equal(output.generations, 1);
      } else if (scenario === 'pdf-no-facts') {
        assert.equal(output.age, '');
        assert.equal(output.fields.minPlayers, undefined);
        assert.equal(output.indexReads, 1);
        assert.equal(output.generations, 0);
      } else {
        assert.equal(output.age, '14');
        assert.equal(output.fields.minPlayers, 2);
        assert.equal(output.fields.maxPlayers, 4);
        assert.equal(output.fields.minDurationMinutes, 30);
        assert.equal(output.fields.maxDurationMinutes, 60);
        assert.equal(output.description, '');
        assert.equal(output.indexReads, 1);
        assert.equal(output.generations, 0);
        assert.equal(output.buttons, 1);
        if (scenario === 'quota') assert.match(output.status, /Cota esgotada/);
      }
      assert.deepEqual(errors, []);
      results.push({ scenario, passed: true, ...output });
    } catch (error) {
      results.push({ scenario, passed: false, error: error.message });
    }
    await context.close();
  }
  await writeFile(process.env.ACERVO_AUDIT_RESULT || 'test-output/firestore-fixes/audit-browser-after.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  assert(
    results.every((r) => r.passed),
    'regressões do fluxo de informações',
  );
} finally {
  await browser.close();
}
