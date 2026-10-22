import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { browserDependencies } from './browser-dependencies.mjs';
import { realIndex } from './real-index-fixture.mjs';

const { chromium } = browserDependencies('playwright');
const pdf = 'descent_lendas_da_e_descent_lendas_da_escuridao_m_181226.pdf';
const index = await realIndex(pdf),
  bytes = await readFile('PDFs/' + pdf);
assert.equal(createHash('sha256').update(bytes).digest('hex'), index.sourceHash);
const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
const markup = (await readFile('index.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const out = 'test-output/rule-topics';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const external = [],
  errors = [],
  opened = [];
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    if (
      route
        .request()
        .url()
        .startsWith(base + '/')
    )
      return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  await context.route('**/__topic-test', (route) => route.fulfill({ contentType: 'text/html', body: markup }));
  await context.route('**/real-manual.pdf', (route) => route.fulfill({ contentType: 'application/pdf', body: bytes }));
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/__topic-test');
  await page.evaluate(
    async ({ index, pdf }) => {
      const { createGuidePanel } = await import('/js/guide-panel.js');
      const NativeWorker = window.Worker;
      window.Worker = class {
        constructor(url, options) {
          this.worker = new NativeWorker(url, options);
          this.worker.onmessage = (event) => {
            if (event.data.query === 'sem-correspondencia') window.releaseMissing = () => this.onmessage?.(event);
            else this.onmessage?.(event);
          };
          this.worker.onerror = (event) => this.onerror?.(event);
        }
        postMessage(data) {
          this.worker.postMessage(data);
        }
      };
      document.body.classList.add('access-approved');
      document.getElementById('session-loading').hidden = true;
      window.topicIndex = index;
      window.rawIndex = JSON.stringify(index);
      window.record = null;
      window.generations = 0;
      window.manualReads = 0;
      window.game = { id: index.gameId, title: 'Descent: Lendas da Escuridão', language: 'pt-BR', manual: { sha256: index.sourceHash, pages: index.pageCount, name: pdf } };
      const repository = {
        mode: 'local',
        session: { canRead: true, canEdit: true, user: { uid: 'topic-test' } },
        getTechnicalIndex: async () => index,
        getGuide: async () => null,
        getKnowledge: async () => window.record,
        getManual: async () => {
          window.manualReads++;
          return (await fetch('/real-manual.pdf')).blob();
        },
        generateKnowledge: () => {
          window.generations++;
          throw new Error('Não deve gerar IA');
        },
      };
      window.panel = createGuidePanel({
        repository,
        openManual: (game, ref) => {
          window.manualReference = ref;
        },
        scope: 'topic-test',
      });
      await window.panel.open(window.game);
    },
    { index, pdf },
  );
  assert.equal(await page.locator('#guide-back').isVisible(), false);
  const topics = await page.locator('.rule-topic').evaluateAll((nodes) => nodes.map((node) => node.firstChild.textContent));
  assert(topics.length > 0, 'assuntos específicos encontrados no manual real');
  assert.equal(topics.includes('Mecânicas'), false, 'não inventa o rótulo genérico');
  assert((await page.locator('.rule-topic:visible').count()) <= 12);
  // Todos os atalhos oferecidos devem abrir o conteúdo que lhes deu origem.
  for (let i = 0; i < topics.length; i++) {
    await page.locator('.rules-topic-group .rules-more').evaluateAll((nodes) => nodes.forEach((node) => (node.open = true)));
    await page.locator('.rule-topic').nth(i).click();
    await page.waitForFunction((title) => document.querySelector('#guide-content').dataset.query === title && document.querySelector('.rule-result'), topics[i]);
    const reference = await page
      .locator('.rule-result')
      .first()
      .evaluate((node) => ({ title: node.querySelector('h3').textContent, page: Number(node.dataset.page), documentId: node.dataset.document }));
    assert(reference.page >= 1 && reference.page <= index.pageCount);
    opened.push({ topic: topics[i], ...reference });
    await page.locator('#guide-back').click();
    assert.equal(await page.locator('#guide-dialog').evaluate((dialog) => dialog.open), true);
    assert.equal(await page.locator('#guide-search').inputValue(), '');
    assert.equal(await page.locator('.rule-topic').count(), topics.length);
  }
  const reads = await page.evaluate(() => manualReads);
  await page.locator('#guide-search').fill('sem-correspondencia');
  await page.waitForFunction(() => !!window.releaseMissing);
  await page.locator('#guide-back').click();
  await page.evaluate(() => releaseMissing());
  assert.equal(await page.locator('#guide-content').getAttribute('data-query'), '', 'resposta antiga não substitui a lista após Voltar');
  // A explicação abaixo é uma fixture: não é uma geração real do Gemini.
  await page.evaluate(async () => {
    const p = topicIndex.pages.find((p) => p.page === 8 && p.text.length > 40);
    window.record = {
      status: 'ready',
      knowledge: {
        sources: [{ id: 'manual', documentId: 'main', sourceHash: game.manual.sha256, pages: [{ page: p.page, text: p.text }] }],
        sections: [
          {
            id: 'hero-actions',
            title: 'Manobra e ações dos heróis',
            topic: 'mecanicas',
            sourceId: 'manual',
            page: p.page,
            sourceHash: game.manual.sha256,
            documentId: 'main',
            quote: p.text.slice(0, 100),
            text: 'Esta é uma explicação simulada para testar a navegação da seção, sem usar a palavra do rótulo da categoria.',
          },
        ],
      },
    };
    await panel.refreshIndexes();
  });
  const readsAfterRefresh = await page.evaluate(() => manualReads);
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.screenshot({ path: `${out}/assuntos-${width}.png` });
    await page.getByRole('button', { name: /Manobra e ações dos heróis/ }).click();
    await page.waitForFunction(() => document.querySelector('.rule-result h3')?.textContent === 'Manobra e ações dos heróis');
    assert.match(await page.locator('.rule-result small').first().textContent(), /IA/);
    assert.equal(await page.locator('.rule-result').first().getAttribute('data-page'), '8');
    await page.screenshot({ path: `${out}/explicacao-${width}.png` });
    await page.locator('#guide-back').click();
    await page.locator('#guide-search').fill('consulta impossível inexistente');
    await page.waitForFunction(() => document.querySelector('#guide-content').dataset.query === 'consulta impossível inexistente');
    assert.equal(await page.locator('.rule-result').count(), 0);
    assert.equal(await page.locator('#guide-back').isVisible(), true);
    assert.equal(await page.locator('#guide-dialog').evaluate((dialog) => dialog.scrollWidth > dialog.clientWidth + 1), false);
    await page.screenshot({ path: `${out}/vazio-${width}.png` });
    await page.locator('#guide-back').click();
  }
  assert.equal(await page.evaluate(() => generations), 0);
  assert.equal(await page.evaluate(() => manualReads), readsAfterRefresh, 'Voltar e pesquisar não releem o PDF');
  assert(readsAfterRefresh <= reads + 1, 'atualização respeita a projeção em cache');
  assert.equal(await page.evaluate(() => JSON.stringify(topicIndex)), await page.evaluate(() => rawIndex), 'índice e evidências não são alterados');
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      {
        pdf,
        topics,
        opened,
        widths: [1440, 820, 390],
        external,
        errors,
        generations: 0,
        limitations: 'PDF e índice locais reais. A seção Gemini é simulada; não prova a cobertura de uma geração real. Nenhuma API externa ou dado de produção foi acessado.',
      },
      null,
      2,
    ),
  );
  console.log(`Descent real: ${topics.length} assuntos abrem seus trechos; origem e páginas preservadas. Voltar funciona inclusive sem resultado e com resposta atrasada. Gemini simulado; zero gerações reais.`);
} finally {
  await browser.close();
}
