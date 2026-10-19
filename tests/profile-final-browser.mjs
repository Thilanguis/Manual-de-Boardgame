import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { synthesizePublicKnowledge, knowledgeFields } from '../worker/src/game-knowledge.js';
import { sourceStatus } from '../worker/src/catalog/index.js';
import { replayResearch } from './public-research-replay.mjs';
import { extractFixturePages } from './profile-pdf-extract-browser.mjs';
import { profileDefinitions } from '../js/profile-facts.js';

const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
const path = process.env.ACERVO_DESCENT_PDF || 'test-output/research-descent/Descent - Legends of the Dark.pdf';
const bytes = await readFile(path),
  hash = createHash('sha256').update(bytes).digest('hex');
const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
const out = 'test-output/profile-final-audit';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pages = await extractFixturePages(browser, bytes, base);
const reports = [];
let generations = 0;
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  const external = [],
    errors = [],
    requests = [];
  await context.route('**/*', (r) => {
    if (['localhost', '127.0.0.1'].includes(new URL(r.request().url()).hostname)) return r.continue();
    external.push(r.request().url());
    return r.abort();
  });
  await context.route('**/config/app-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export const APP_CONFIG={allowLocalDevelopment:true,maxPdfBytes:52428800};' }));
  await context.route('**/js/local-repository.js', async (r) => {
    const response = await r.fetch();
    let body = await response.text();
    body = body.replace(
      "mode: 'local',",
      "mode:'replay', async draftKnowledge(input){return(await fetch('/__audit/draft',{method:'POST',body:JSON.stringify(input)})).json();}, async research(source,input){return(await fetch('/__audit/'+source,{method:'POST',body:JSON.stringify(input||{})})).json();},",
    );
    body = body.replace('user: null', "user:{uid:'audit-owner'},cacheReady:true,storageStatus:{profileMetadataProtocol:1,knowledgeConfigured:true,manualAiEnabled:true}");
    await r.fulfill({ response, body });
  });
  await context.route('**/__audit/*', async (r) => {
    try {
      const source = r.request().url().split('/').at(-1),
        input = r.request().postDataJSON();
      requests.push({ source, input: source === 'draft' ? { title: input.title, documents: input.documents.length } : input });
      if (source === 'draft') {
        const sources = input.documents.map((d, i) => ({ id: `manual-${i + 1}`, name: d.name, documentId: d.id, sourceHash: d.hash, scope: 'edition-confirmed', language: d.language, pages: d.pages }));
        const knowledge = await synthesizePublicKnowledge({ id: 'draft', title: input.title, edition: input.edition }, sources, { GEMINI_API_KEY: 'isolated-fixture' }, async (url, options) => {
          assert.equal(new URL(url).hostname, 'generativelanguage.googleapis.com');
          generations++;
          const prompt = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
          const source = prompt.sources[0],
            page = source.pages.find((p) => p.passages.some((p) => /is a cooperative game/.test(p.text)));
          const passage = page.passages.find((p) => /is a cooperative game/.test(p.text));
          assert.match(passage.text, /campaign/);
          const fact = (value) => ({ value, sourceId: source.id, page: page.page, evidenceId: passage.id });
          const metadata = {
            ...Object.fromEntries(Object.keys(profileDefinitions).map((k) => [k, null])),
            description: fact('Os jogadores assumem o papel de heróis e cooperam em uma campanha, enfrentando inimigos e explorando Terrinoth.'),
            gameType: fact('Cooperativo'),
            recommendedAge: fact(99),
          };
          const raw = {
            language: 'pt-BR',
            metadata,
            unconfirmed: ['Idade e duração não foram encontradas neste manual.'],
            sections: [{ topic: 'visao-geral', title: 'Visão geral', text: metadata.description.value, sourceId: source.id, page: page.page, evidenceId: passage.id }],
          };
          return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] });
        });
        await r.fulfill({ json: { status: 'ready', revision: 1, analysisOrigin: 'generation', knowledge: { ...knowledge, fields: knowledgeFields(knowledge) } } });
      } else {
        const query = { ...input, query: input.query?.replace(/^Descent Lendas da Escuridão$/, 'Descent: Lendas da Escuridão') };
        // Somente o transporte de replay usa a captura com pontuação original.
        const result = source === 'sources' ? { protocol: 2, apiVersion: '1.11.0', queryStrategyVersion: 2, sources: sourceStatus({}) } : await replayResearch(source, query);
        await r.fulfill({ json: result });
      }
    } catch (e) {
      errors.push(e.stack);
      await r.fulfill({ status: 500, json: { error: e.message } });
    }
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.stack));
  await page.goto(base + '/?local=1');
  await page.locator('#empty-action').click();
  await page.locator('#pdf-file').setInputFiles({ name: 'Descent - Legends of the Dark.pdf', mimeType: 'application/pdf', buffer: bytes });
  await page.locator('#game-form').waitFor({ state: 'visible' });
  const initial = await page.locator('#game-form').evaluate((form) => Object.fromEntries(new FormData(form)));
  await page.locator('#game-title').fill('Descent Lendas da Escuridão');
  await page.locator('#game-next').click();
  // Reutiliza a extração real já medida e registra a capa sem texto como falha
  // conhecida. O teste de OCR real está abaixo, separado desta geração simulada.
  await page.evaluate(
    async ({ hash, pages }) => {
      const { cachedIndex } = await import('/js/index-cache.js');
      await cachedIndex(`draft-profile-index:audit-owner:${hash}`, {
        schemaVersion: 1,
        gameId: 'draft:audit-owner',
        documentId: 'main',
        sourceHash: hash,
        pageCount: pages.length,
        pages: pages.map((p) => ({ ...p, extracted: true, ...(p.page === 1 ? { ocrStatus: 'low-confidence' } : {}) })),
        headings: [],
        analysisComplete: true,
        language: 'en',
      });
    },
    { hash, pages },
  );
  await page.locator('[data-research-search]').click();
  await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled, null, { timeout: 60000 });
  assert.equal(generations, 1);
  assert.equal(await page.locator('[name=minPlayers]').inputValue(), '1');
  assert.equal(await page.locator('[name=maxPlayers]').inputValue(), '4');
  assert.match(await page.locator('#game-form [name=description]').inputValue(), /cooperam em uma campanha/);
  assert.equal(await page.locator('[name=gameType]').inputValue(), 'Cooperativo');
  assert.equal(await page.locator('[name=recommendedAge]').inputValue(), '', '99 sem evidência foi rejeitado');
  assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '');
  const origins = await page.locator('[data-metadata-field]').allTextContents();
  assert(origins.some((s) => s.includes('Origem: Gemini · manual, página 2')));
  assert(origins.some((s) => s.includes('Origem: PDF · texto do manual, página 2')));
  assert.match(await page.locator('[data-profile-diagnostic]').textContent(), /3 campos retornados; 2 utilizáveis; 1 rejeitados/);
  assert.match(await page.locator('[data-profile-diagnostic]').textContent(), /Idade: valor inválido/);
  const ambiguous = page.locator('[data-research-results] button').filter({ hasText: /^Descent: Legends of the Dark · 2021$/ });
  await ambiguous.click();
  assert.match(await page.locator('[name=tags]').inputValue(), /Fantasia/);
  await page.locator('#game-form [name=description]').fill('Minha descrição revisada deve ser preservada.');
  await page.locator('[data-research-search]').click();
  await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
  assert.equal(generations, 1, 'repetir ação reutiliza o resultado por hash');
  assert.equal(await page.locator('#game-form [name=description]').inputValue(), 'Minha descrição revisada deve ser preservada.');
  assert.match(await page.locator('[data-research-status]').textContent(), /cache deste dispositivo/);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('[data-research-search]').scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const gaps = await page.locator('.field-with-origin').evaluateAll((wrappers) =>
      wrappers
        .map((w) => {
          const input = w.querySelector('input,textarea'),
            origin = w.querySelector('.metadata-origin');
          return input && origin ? origin.getBoundingClientRect().top - input.getBoundingClientRect().bottom : null;
        })
        .filter((x) => x !== null),
    );
    assert(
      gaps.every((gap) => gap >= 4),
      JSON.stringify({ width, gaps }),
    );
    await page.screenshot({ path: `${out}/cadastro-${width}.png`, fullPage: true });
    await page.locator('#game-form [name=minPlayers]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/campos-${width}.png`, fullPage: true });
    reports.push({ width, gaps });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#game-next').click();
  await page.locator('#game-back').click();
  assert.equal(await page.locator('[name=gameType]').inputValue(), 'Cooperativo');
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
  assert.equal(saved.title, 'Descent Lendas da Escuridão');
  assert.equal(saved.gameType, 'Cooperativo');
  assert.equal(saved.description, 'Minha descrição revisada deve ser preservada.');
  assert.equal(saved.sources.metadata.origins.gameType.source, 'pdf', 'tipo explícito do manual tem prioridade sobre a mesma sugestão Gemini');
  assert.equal(saved.sources.metadata.origins.description.source, 'gemini');
  assert.equal(saved.sources.metadata.origins.description.evidence.page, 2);
  assert.match(saved.sources.description.source, /Conferido/);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.game-card').length === 1);
  assert.equal(generations, 1);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await writeFile(`${out}/browser.json`, JSON.stringify({ initial, saved, origins, reports, generations, requests, external, errors }, null, 2));
  console.log('Manual real: PDF 1–4, Gemini simulado descrição/tipo PT-BR, catálogo Fantasia; rejeição de idade sem prova; cache, edição manual, etapas, registro salvo, reload e 3 tamanhos verificados. Zero chamadas externas.');
} finally {
  await browser.close();
}
