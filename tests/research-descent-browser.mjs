import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { replayResearch, replayStats } from './public-research-replay.mjs';
import { sourceStatus } from '../worker/src/catalog/index.js';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
const pdfPath = process.env.ACERVO_DESCENT_PDF;
assert(pdfPath, 'Informe o manual oficial local; não baixa documentos durante os testes.');
const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = [];
try {
  for (const title of ['Descent: Lendas da Escuridão', 'Descent: Legends of the Dark']) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
    const errors = [],
      external = [],
      calls = [];
    await context.route('**/*', (r) => {
      if (['127.0.0.1', 'localhost'].includes(new URL(r.request().url()).hostname)) return r.continue();
      external.push(r.request().url());
      return r.abort();
    });
    await context.route('**/config/app-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export const APP_CONFIG={allowLocalDevelopment:true,maxPdfBytes:52428800};' }));
    await context.route('**/js/local-repository.js', async (r) => {
      const response = await r.fetch();
      await r.fulfill({ response, body: (await response.text()).replace("mode: 'local',", "mode:'replay', async research(source,input){return(await fetch('/__public-replay/'+source,{method:'POST',body:JSON.stringify(input||{})})).json();},") });
    });
    await context.route('**/__public-replay/*', async (r) => {
      const source = r.request().url().split('/').at(-1),
        input = r.request().postDataJSON();
      calls.push({ source, query: input.query, action: input.action });
      try {
        const result = source === 'sources' ? { protocol: 2, apiVersion: '1.11.0', queryStrategyVersion: 2, sources: sourceStatus({}) } : await replayResearch(source, input);
        await r.fulfill({ json: result });
      } catch (e) {
        errors.push(e.message);
        await r.fulfill({ status: 500, json: { error: e.message } });
      }
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/?local=1');
    await page.waitForFunction(() => document.getElementById('account-label')?.textContent === 'Local');
    await page.locator('#empty-action').click();
    await page.locator('#pdf-file').setInputFiles(pdfPath);
    await page.locator('#game-form').waitFor({ state: 'visible' });
    const extracted = await page.locator('#game-form').evaluate((form) => Object.fromEntries(new FormData(form)));
    await page.locator('#game-title').fill(title);
    await page.locator('#game-next').click();
    await page.locator('[data-research-search]').click();
    await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
    const beforeChoice = await page.locator('[data-research-status]').textContent();
    if (title.includes('Lendas')) {
      assert.match(beforeChoice, /Confira qual jogo/);
      assert(!beforeChoice.includes('1 jogo encontrado'));
      await page
        .locator('[data-research-results] button')
        .filter({ hasText: /^Descent: Legends of the Dark · 2021$/ })
        .click();
    }
    assert.equal(await page.locator('#game-form [name=minPlayers]').inputValue(), '1');
    assert.equal(await page.locator('#game-form [name=maxPlayers]').inputValue(), '4');
    assert((await page.locator('#game-form [name=tags]').inputValue()).includes('Fantasia'));
    const afterChoice = await page.locator('[data-research-status]').textContent();
    assert.match(afterChoice, /1 fonte com dados aproveitáveis/);
    // Uma correção real no input deve sobreviver a uma nova aplicação progressiva.
    await page.locator('#game-form [name=description]').fill('Sinopse corrigida pelo administrador.');
    await page.locator('[data-research-search]').click();
    await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
    assert.equal(await page.locator('#game-form [name=description]').inputValue(), 'Sinopse corrigida pelo administrador.');
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.equal(await page.locator('[data-research-search]').count(), 1);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#game-next').click();
    await page.locator('#game-back').click();
    assert.equal(await page.locator('#game-form [name=maxPlayers]').inputValue(), '4');
    await page.locator('#game-next').click();
    await page.locator('#game-form [name=confirmed]').check();
    await page.locator('#save-game').click();
    await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
    const saved = await page.evaluate(async () => {
      const repo = await (await import('/js/local-repository.js')).createLocalRepository();
      const result = await new Promise((resolve) => {
        const stop = repo.subscribeGames((games) => {
          stop();
          resolve(games[0]);
        });
      });
      repo.close();
      return result;
    });
    assert.equal(saved.title, title);
    assert.equal(saved.minPlayers, 1);
    assert.equal(saved.maxPlayers, 4);
    assert(saved.tags.includes('Fantasia'));
    assert.equal(saved.description, 'Sinopse corrigida pelo administrador.');
    assert(saved.sources.catalog.matches.some((m) => m.identifiers?.wikidata === 'Q111669176'));
    assert(saved.sources.metadata.origins.tags.origins.some((o) => o.source === 'wikidata' && o.id === 'Q111669176'));
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.game-card').length === 1);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    assert.deepEqual(replayStats.missing, []);
    report.push({ title, extracted, beforeChoice, afterChoice, saved, calls, external, errors });
    await context.close();
  }
  // Sem PDF de Arnak: testa somente a transferência de fatos públicos reais aos
  // mesmos inputs, sem atribuir ao manual dados que não foram inspecionados.
  {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', (r) => (['127.0.0.1', 'localhost'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort()));
    await context.route('**/js/app.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
    const page = await context.newPage();
    await page.exposeFunction('publicReplay', async (source, input) => (source === 'sources' ? { protocol: 2, queryStrategyVersion: 2, sources: sourceStatus({}) } : replayResearch(source, input)));
    await page.goto(base);
    const transfer = await page.evaluate(async () => {
      const { createResearchPanel } = await import('/js/research-panel.js'),
        { createMetadataForm } = await import('/js/metadata-form.js');
      const form = document.getElementById('game-form');
      form.reset();
      form.elements.title.value = 'As Ruínas Perdidas de Arnak';
      const current = { title: form.elements.title.value, language: 'pt-BR', sources: {} };
      const get = () => current;
      const metadata = createMetadataForm({
        form,
        getCurrent: get,
        apply(values) {
          Object.assign(current, values);
          for (const [key, value] of Object.entries(values)) form.elements[key].value = Array.isArray(value) ? value.join(', ') : (value ?? '');
        },
        onManualEdit(key, value) {
          current[key] = value;
        },
      });
      const panel = createResearchPanel({
        root: document.getElementById('research-panel'),
        getCurrent: get,
        getRepository: () => ({ mode: 'replay', research: publicReplay }),
        canUse: () => true,
        readPreference: () => 'pt-BR',
        writePreference() {},
        onConsolidated: (model) => metadata.update(model),
      });
      panel.reset();
      await panel.run();
      const before = { ...current };
      document.querySelector('[data-research-results] button').click();
      const values = Object.fromEntries(['minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes', 'recommendedAge', 'description'].map((k) => [k, form.elements[k].value]));
      const count = document.querySelector('[data-metadata-review]').textContent;
      panel.cancel();
      return { before, values, count };
    });
    assert.equal(transfer.before.recommendedAge, undefined);
    assert.deepEqual(transfer.values, { minPlayers: '1', maxPlayers: '4', minDurationMinutes: '60', maxDurationMinutes: '60', recommendedAge: '12', description: '' });
    assert.match(transfer.count, /5 informações preenchidas automaticamente/);
    assert.deepEqual(replayStats.missing, []);
    report.push({ title: 'Arnak · transferência nos inputs', ...transfer });
    await context.close();
  }
  await writeFile('test-output/research-descent/browser.json', JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      report.map(({ title, saved, beforeChoice, afterChoice, calls, values, count }) => ({
        title,
        ...(saved ? { minPlayers: saved.minPlayers, maxPlayers: saved.maxPlayers, tags: saved.tags } : { values, count }),
        beforeChoice,
        afterChoice,
        requests: calls?.length,
      })),
    ),
  );
} finally {
  await browser.close();
}
