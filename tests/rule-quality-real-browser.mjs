import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { browserDependencies } from './browser-dependencies.mjs';
import { realIndex } from './real-index-fixture.mjs';

const { chromium } = browserDependencies('playwright');
const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
const markup = (await readFile('index.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const cases = [
  { title: 'Duelo pela Terra Média', pdf: 'Senhor dos aneis DUEL.pdf', queries: ['Componentes', 'Preparação', 'Turnos', 'Cartas', 'Custos', 'Condições de vitória'], pages: [1, 2, 3, 4, 4, 8] },
  { title: 'Resident Evil', pdf: 'resident_evil pt-BR.pdf', queries: ['Componentes', 'Como atacar um inimigo?', 'Como funciona um turno?', 'Cartas de item'], pages: [5, 8, 8, 6] },
  { title: 'Dead by Daylight', pdf: 'dead_by_daylight_sem_perda_20paginas.pdf', queries: ['Componentes', 'Preparação', 'Como atacar?', 'Como mover o sobrevivente?'], pages: [3, 6, 14, 8] },
  { title: 'Zombicide inglês com OCR salvo', pdf: 'ZCD001-EN-Rulebook.pdf', language: 'en', queries: ['Preparação', 'Como atacar?', 'Turnos'], pages: [6, 21, 68] },
];
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  report = [];
await mkdir('test-output/rule-quality', { recursive: true });
try {
  for (const item of cases) {
    const bytes = await readFile('PDFs/' + item.pdf);
    const index = await realIndex(item.pdf);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), index.sourceHash, 'índice pertence ao PDF real');
    const originalIndex = JSON.stringify(index);
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
    const outbound = [],
      errors = [];
    await context.route('**/*', (route) => {
      if (!route.request().url().startsWith(base)) {
        outbound.push(new URL(route.request().url()).hostname);
        return route.abort();
      }
      return route.continue();
    });
    await context.route('**/__rules-quality', (route) => route.fulfill({ contentType: 'text/html', body: markup }));
    await context.route('**/real-manual.pdf', (route) => route.fulfill({ contentType: 'application/pdf', body: bytes }));
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '/__rules-quality');
    await page.evaluate(
      async ({ index, item }) => {
        document.body.classList.add('access-approved');
        document.getElementById('session-loading').hidden = true;
        const { createGuidePanel } = await import('/js/guide-panel.js');
        const { createReader } = await import('/js/reader.js');
        window.indexOriginal = JSON.stringify(index);
        // O idioma confirmado do documento prevalece sobre um idioma antigo no índice.
        window.testIndex = index;
        window.game = { id: index.gameId, title: item.title, language: item.language || index.language, manual: { sha256: index.sourceHash, pages: index.pageCount, name: item.pdf, size: 100, type: 'application/pdf' } };
        window.generationCalls = 0;
        window.manualReads = 0;
        window.record = null;
        const repository = {
          mode: 'local',
          session: { canRead: true, canEdit: true, user: { uid: 'isolated' } },
          getTechnicalIndex: async () => window.testIndex,
          getGuide: async () => null,
          getKnowledge: async () => window.record,
          getManual: async () => {
            window.manualReads++;
            return (await fetch('/real-manual.pdf')).blob();
          },
          generateKnowledge: async () => {
            window.generationCalls++;
            throw new Error('Consulta não pode gerar IA');
          },
        };
        window.reader = createReader({
          repository,
          getProgress: () => null,
          saveProgress() {},
          onError: (e) => {
            throw e;
          },
        });
        window.panel = createGuidePanel({
          repository,
          openManual: (game, options) => {
            window.openedReference = options;
            return window.reader.open(game, options);
          },
        });
        await window.panel.open(window.game);
      },
      { index, item },
    );
    const results = [];
    for (const [i, query] of item.queries.entries()) {
      await page.locator('#guide-search').fill(query);
      await page.waitForFunction((q) => document.querySelector('#guide-content').dataset.query === q && document.querySelector('.rule-result'), query);
      const result = await page
        .locator('.rule-result')
        .first()
        .evaluate((card) => ({
          title: card.querySelector('h3').textContent,
          page: Number(card.dataset.page),
          type: card.dataset.match,
          preview: card.querySelector('.rule-preview')?.innerText || '',
          source: card.querySelector('small').textContent,
          visible: document.querySelectorAll('.rule-result').length,
        }));
      assert(result.visible <= 3, 'poucos resultados iniciais');
      if (item.pages) assert.equal(result.page, item.pages[i], JSON.stringify({ query, result }));
      assert(result.page >= 1 && result.page <= index.pageCount);
      if (!item.language) assert(result.preview.length > 20 && result.preview.length <= 960);
      if (query === 'Componentes') {
        assert.match(result.title, /componentes/i);
        assert.doesNotMatch(result.title, /objetivo|visão geral/i);
      }
      if (item.title === 'Duelo pela Terra Média' && query === 'Turnos') {
        const card = page.locator('.rule-result').first();
        assert.equal(
          await card
            .locator('.rule-preview h4')
            .filter({ hasText: /^A\. Pegar uma Carta de Capítulo$/ })
            .count(),
          1,
        );
        assert.equal(await card.locator('.rule-preview p').filter({ hasText: /^A\.$/ }).count(), 0);
        const previewText = await card.locator('.rule-preview').textContent();
        assert.doesNotMatch(previewText, /turnos ,|Lugar \./);
        assert.match(previewText, /nenhuma outra carta/);
        assert.doesNotMatch(previewText, /disponível, Carta|nenhuma disponível/);
        assert.equal((await card.locator('.rule-preview').innerText()).includes('\nCarta disponível'), false);
        assert.equal(
          await card
            .locator('summary')
            .filter({ hasText: /^Texto lateral do PDF$/ })
            .count(),
          1,
        );
        const full = card.locator('details').filter({ has: page.locator('summary', { hasText: 'Ler trecho completo' }) });
        await full.locator('summary').click();
        assert.equal(
          await full
            .locator('h4')
            .filter({ hasText: /^Jogar a carta na sua frente$/ })
            .count(),
          1,
        );
        assert.equal(
          await full
            .locator('h4')
            .filter({ hasText: /^Descarte a carta$/ })
            .count(),
          1,
        );
        assert.match(await full.textContent(), /coloque-a na sua área de jogo/);
        for (const width of [1440, 768, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          assert(await card.evaluate((n) => n.scrollWidth <= n.clientWidth + 1));
          await page.screenshot({ path: `test-output/rule-reading-audit/turnos-${width}.png` });
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
      if (item.title === 'Dead by Daylight' && query === 'Componentes') assert.match(result.preview, /7 Tabuleiros|44 Peças/);
      if (item.title === 'Resident Evil' && query === 'Como atacar um inimigo?') assert.match(result.preview, /arma|Escolha um inimigo/i);
      if (item.title === 'Dead by Daylight' && query === 'Como mover o sobrevivente?') {
        assert.match(result.preview, /Revele sua Carta de Movimento/);
        assert.doesNotMatch(result.preview, /Cada rodada contém|Portão de Saída/);
      }
      if (item.language) assert.match(await page.locator('.rule-result').first().textContent(), /Tradução pendente/);
      // O botão usa o leitor real e o arquivo original, não apenas um callback fictício.
      await page
        .locator('.rule-result')
        .first()
        .getByRole('button', { name: /Ver no manual/ })
        .click();
      await page.waitForFunction(() => document.querySelector('#reader-status').hidden && !document.querySelector('#page-number').disabled, null, { timeout: 45000 });
      assert.equal(Number(await page.locator('#page-number').inputValue()), result.page);
      assert.equal(await page.evaluate(() => window.openedReference.sourceHash), index.sourceHash);
      if (item.title === 'Duelo pela Terra Média' && ['Componentes', 'Condições de vitória'].includes(query)) await page.screenshot({ path: `test-output/rule-quality/pdf-${i}.png` });
      await page.locator('#reader-close').click();
      await page.evaluate(() => window.panel.open(window.game));
      results.push({ query, ...result, openedCorrectPage: true });
    }
    if (item.title === 'Duelo pela Terra Média') {
      await page.locator('#guide-search').fill('Tabuleiro Central');
      await page.waitForFunction(() => document.querySelector('#guide-content').dataset.query === 'Tabuleiro Central');
      assert.match(await page.locator('#guide-content').textContent(), /Não encontramos uma resposta direta/);
      assert.equal(await page.locator('.rule-result').first().getAttribute('data-match'), 'related');
      // Conhecimento armazenado simulado, com evidência real do PDF, sem chamar Gemini.
      await page.evaluate(async () => {
        const { splitPassages } = await import('/js/rule-passages.js');
        const page = window.testIndex.pages[0],
          hash = window.game.manual.sha256;
        const part = splitPassages(
          page.text,
          window.testIndex.headings.filter((h) => h.page === 1),
          1,
        ).find((p) => p.title === 'COMPONENTES');
        window.record = {
          status: 'ready',
          knowledge: {
            sources: [{ id: 'manual', documentId: 'main', sourceHash: hash, name: 'Manual real', scope: 'edition-confirmed', pages: [{ page: 1, text: page.text }] }],
            sections: [
              { id: 'correct', title: 'Componentes', topic: 'componentes', text: part.text, quote: part.originalText, page: 1, sourceHash: hash, documentId: 'main', sourceId: 'manual', review: 'manual' },
              { id: 'generic', title: 'Objetivo', topic: 'objetivo', text: 'Confira os componentes antes de iniciar a partida.', quote: part.originalText, page: 1, sourceHash: hash, documentId: 'main', sourceId: 'manual', review: 'unreviewed' },
            ],
          },
        };
        await window.panel.refreshIndexes();
      });
      await page.locator('#guide-search').fill('Componentes');
      await page.waitForFunction(() => document.querySelector('#guide-content').dataset.query === 'Componentes' && document.querySelector('.rule-result small')?.textContent === 'Explicação corrigida');
      assert.equal(await page.locator('.rule-result').count(), 2, 'explicação corrigida e outro assunto relacionado, sem repetir o PDF');
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        assert(await page.evaluate(() => document.querySelector('#guide-dialog').getBoundingClientRect().width <= innerWidth));
        await page.screenshot({ path: `test-output/rule-quality/rules-${width}.png` });
      }
    }
    if (item.language === 'en') {
      // Tradução já disponível, simulada e vinculada literalmente ao OCR real.
      await page.evaluate(async () => {
        const p = window.testIndex.pages[20];
        p.translation = { sourceText: p.text, text: 'ATACAR\nGaste uma ação para realizar um ataque. Confira a arma e as condições no manual original.', targetLanguage: 'pt-BR', sourceLanguage: 'en', method: 'simulated-local-translation' };
        await window.panel.refreshIndexes();
      });
      await page.locator('#guide-search').fill('atacar');
      await page.waitForFunction(() => document.querySelector('#guide-content').dataset.query === 'atacar' && document.querySelector('.rule-preview')?.textContent.includes('Gaste uma ação'));
      const translated = await page.locator('.rule-result').first().textContent();
      assert.match(translated, /Texto original/);
      assert.equal(await page.locator('.rule-result').first().getAttribute('data-page'), '21');
      await page.screenshot({ path: 'test-output/rule-quality/translated-ocr-real.png' });
      await page.evaluate(() => {
        delete window.testIndex.pages[20].translation;
      });
    }
    assert.equal(await page.evaluate(() => window.generationCalls), 0);
    assert((await page.evaluate(() => window.manualReads)) <= item.queries.length + 1, 'organizar o índice não repete leitura do PDF a cada pergunta');
    assert.equal(JSON.stringify(index), originalIndex);
    assert.equal(await page.evaluate(() => JSON.stringify(window.testIndex) === window.indexOriginal), true);
    assert.deepEqual(errors, []);
    assert(!outbound.some((host) => /googleapis|firebaseio|workers\.dev/.test(host)), 'nenhuma chamada a serviços reais');
    report.push({ title: item.title, pdf: item.pdf, hashVerified: true, indexUnchanged: true, ocrPages: index.pages.filter((p) => p.method === 'ocr-local').length, results, generationCalls: 0 });
    console.log(JSON.stringify({ title: item.title, results: results.map(({ query, title, page, type }) => ({ query, title, page, type })), generationCalls: 0 }));
    await context.close();
  }
  await writeFile('test-output/rule-quality/report.json', JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
