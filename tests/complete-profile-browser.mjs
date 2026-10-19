import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { synthesizePublicKnowledge, knowledgeFields } from '../worker/src/game-knowledge.js';
import { extractFixturePages } from './profile-pdf-extract-browser.mjs';
import { profileDefinitions } from '../js/profile-facts.js';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts } = require('pdf-lib');
const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const reports = [];
await mkdir('test-output/complete-profile', { recursive: true });
try {
  for (const scenario of ['fixed-min', 'fixed-max', 'range', 'range-inverted']) {
    const range = scenario.startsWith('range');
    const expected = {
      title: 'Ficha Total',
      edition: '2025',
      description: 'Coopere com os heróis em uma aventura com cartas.',
      minPlayers: 1,
      maxPlayers: 4,
      minDurationMinutes: range ? 60 : 90,
      maxDurationMinutes: range ? 120 : 90,
      recommendedAge: 14,
      tags: ['Cooperativo', 'Aventura'],
      mechanics: ['Gestão de cartas'],
      gameType: 'Cooperativo',
    };
    const text = `Ficha Total\n${scenario === 'fixed-max' ? 'Edição 2025' : 'Edição: 2025'}\nCoopere com os heróis em uma aventura com cartas.\nPara 1 a 4 jogadores. Duração: ${range ? '60 a 120' : '90'} minutos. Idade: 14 anos.\nJogo cooperativo de aventura com gestão de cartas.`;
    const pdf = await PDFDocument.create(),
      font = await pdf.embedFont(StandardFonts.Helvetica);
    // O leitor inicial inspeciona até 12 páginas. Os fatos da página 13 não
    // podem preencher os inputs antes de serem entregues pela ficha Gemini.
    for (let n = 1; n <= 13; n++) pdf.addPage([595, 842]).drawText(n === 13 ? text : 'Ficha Total', { x: 30, y: 750, size: 12, font, lineHeight: 22 });
    const bytes = Buffer.from(await pdf.save()),
      hash = createHash('sha256').update(bytes).digest('hex');
    const pages = await extractFixturePages(browser, bytes, base);
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
    const external = [],
      errors = [];
    let generations = 0,
      fieldsSent;
    await context.route('**/*', (r) => {
      if (['localhost', '127.0.0.1'].includes(new URL(r.request().url()).hostname)) return r.continue();
      external.push(r.request().url());
      return r.abort();
    });
    await context.route('**/config/app-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export const APP_CONFIG={allowLocalDevelopment:true,maxPdfBytes:52428800};' }));
    await context.route('**/js/local-repository.js', async (r) => {
      const response = await r.fetch();
      const body = (await response.text())
        .replace(
          "mode: 'local',",
          "mode:'fixture',async draftKnowledge(input){return(await fetch('/__whole/draft',{method:'POST',body:JSON.stringify(input)})).json();},async research(){return {protocol:2,apiVersion:'1.11.0',queryStrategyVersion:2,sources:[]};},",
        )
        .replace('user: null', "user:{uid:'whole-owner'},cacheReady:true,storageStatus:{profileMetadataProtocol:1,knowledgeConfigured:true,manualAiEnabled:true}");
      await r.fulfill({ response, body });
    });
    await context.route('**/__whole/draft', async (r) => {
      try {
        const input = r.request().postDataJSON(),
          sources = input.documents.map((d, i) => ({ id: `manual-${i + 1}`, documentId: d.id, sourceHash: d.hash, pages: d.pages, language: 'pt-BR', scope: 'edition-confirmed' }));
        assert.equal(input.edition, scenario === 'fixed-max' ? '' : '2025', 'edição do índice incorporada antes da análise; caso sem rótulo será preenchido pelo Gemini');
        const knowledge = await synthesizePublicKnowledge({ id: 'draft', title: input.title, edition: input.edition }, sources, { GEMINI_API_KEY: 'isolated' }, async (_url, options) => {
          generations++;
          const body = JSON.parse(options.body),
            data = JSON.parse(body.contents[0].parts[0].text),
            source = data.sources[0],
            page = source.pages.find((p) => p.page === 13),
            passage = page.passages[0];
          assert.deepEqual(body.generationConfig.responseSchema.properties.metadata.required.sort(), Object.keys(profileDefinitions).sort());
          const fact = (value) => ({ value, sourceId: source.id, page: 13, evidenceId: passage.id });
          const metadata = Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, fact(value)]));
          if (scenario === 'fixed-min') metadata.maxDurationMinutes = null;
          if (scenario === 'fixed-max') metadata.minDurationMinutes = null;
          if (scenario === 'range-inverted') {
            metadata.minDurationMinutes.value = 120;
            metadata.maxDurationMinutes.value = 60;
          }
          const raw = { language: 'pt-BR', metadata, unconfirmed: [], sections: [{ topic: 'visao-geral', title: 'Visão geral', text: expected.description, sourceId: source.id, page: 13, evidenceId: passage.id }] };
          return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] });
        });
        fieldsSent = Object.keys(knowledge.profile);
        await r.fulfill({ json: { status: 'ready', analysisOrigin: 'generation', knowledge: { ...knowledge, fields: knowledgeFields(knowledge) } } });
      } catch (e) {
        errors.push(e.stack);
        await r.fulfill({ status: 500, json: { error: e.message } });
      }
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.stack));
    await page.goto(base + '/?local=1');
    await page.locator('#empty-action').click();
    await page.locator('#pdf-file').setInputFiles({ name: 'Ficha_Total_pt-BR.pdf', mimeType: 'application/pdf', buffer: bytes });
    await page
      .locator('#game-form')
      .waitFor({ state: 'visible' })
      .catch(async (error) => {
        throw new Error(JSON.stringify({ scenario, errors, external, status: await page.locator('#upload-status').textContent() }), { cause: error });
      });
    await page.locator('#game-title').fill(expected.title);
    await page.locator('#game-next').click();
    for (const key of Object.keys(expected).filter((k) => k !== 'title')) assert.equal(await page.locator(`#game-form [name=${key}]`).inputValue(), '', 'não veio da extração inicial: ' + key);
    await page.evaluate(
      async ({ hash, pages }) => {
        const { cachedIndex } = await import('/js/index-cache.js');
        await cachedIndex(`draft-profile-index:whole-owner:${hash}`, {
          schemaVersion: 1,
          gameId: 'draft:whole-owner',
          documentId: 'main',
          sourceHash: hash,
          pageCount: 13,
          headings: [],
          analysisComplete: true,
          language: 'pt-BR',
          pages: pages.map((p) => ({ ...p, extracted: true, ...(p.page < 13 ? { ocrStatus: 'low-confidence' } : {}) })),
        });
      },
      { hash, pages },
    );
    await page.locator('[data-research-search]').click();
    await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
    assert(fieldsSent, JSON.stringify({ errors, generations, status: await page.locator('[data-research-status]').textContent() }));
    assert.deepEqual(fieldsSent.sort(), Object.keys(expected).sort());
    for (const [key, value] of Object.entries(expected)) {
      const input = key === 'title' ? page.locator('[data-metadata-title]') : page.locator(`#game-form [name=${key}]`);
      assert.equal(await input.inputValue(), Array.isArray(value) ? value.join(', ') : String(value), scenario + '/' + key);
    }
    assert.equal(generations, 1);
    await page.locator('[data-research-search]').click();
    await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
    assert.equal(generations, 1, 'ficha completa reutilizada mesmo após a edição ser preenchida');
    await page.locator('#game-next').click();
    await page.locator('#game-back').click();
    assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), String(expected.maxDurationMinutes));
    // Correção manual continua prioritária na reconsulta do resultado salvo.
    await page.locator('[name=recommendedAge]').fill('16');
    await page.locator('[data-research-search]').click();
    await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
    assert.equal(await page.locator('[name=recommendedAge]').inputValue(), '16');
    if (scenario === 'fixed-min') {
      await page.locator('[name=minDurationMinutes]').fill('');
      await page.locator('[name=maxDurationMinutes]').fill('');
      await page.locator('[name=minDurationMinutes]').fill('75');
      await page.locator('[name=gameType]').click();
      assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '75', 'entrada manual única também repete');
      expected.minDurationMinutes = expected.maxDurationMinutes = 75;
    }
    await page.locator('#game-next').click();
    await page.locator('[name=confirmed]').check();
    await page.locator('#save-game').click();
    await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
    const saved = await page.evaluate(async () => {
      const request = indexedDB.open('acervo-library-v1');
      const db = await new Promise((r) => (request.onsuccess = () => r(request.result)));
      const read = db.transaction('games').objectStore('games').getAll();
      return await new Promise((r) => (read.onsuccess = () => r(read.result[0])));
    });
    for (const [key, value] of Object.entries({ ...expected, recommendedAge: 16 })) assert.deepEqual(saved[key], value, scenario + '/salvo/' + key);
    assert.equal(saved.durationMinutes, expected.minDurationMinutes === expected.maxDurationMinutes ? expected.minDurationMinutes : null);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.game-card').length === 1);
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    reports.push({ scenario, generations, fieldsSent, saved, external, errors });
    await context.close();
  }
  await writeFile('test-output/complete-profile/browser.json', JSON.stringify(reports, null, 2));
  console.log('4 fluxos completos: todos os 11 campos Gemini nos inputs e no registro; duração única pelos dois lados, intervalo e extremos invertidos; cache após edição, correção manual, ida/volta, salvamento e reload. Nenhuma API real.');
} finally {
  await browser.close();
}
