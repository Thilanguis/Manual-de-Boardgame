import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { browserDependencies } from './browser-dependencies.mjs';
import { realIndex } from './real-index-fixture.mjs';
const { chromium } = browserDependencies('playwright');
const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
const markup = (await readFile('index.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const pdf = 'Senhor dos aneis DUEL.pdf',
  bytes = await readFile('PDFs/' + pdf),
  index = await realIndex(pdf);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('test-output/rule-assistant', { recursive: true });
const report = [];
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
  await context.route('**/__assistant', (route) => route.fulfill({ contentType: 'text/html', body: markup }));
  await context.route('**/qa.pdf', (route) => route.fulfill({ contentType: 'application/pdf', body: bytes }));
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/__assistant');
  await page.evaluate(
    async ({ index, pdf }) => {
      document.body.classList.add('access-approved');
      document.getElementById('session-loading').hidden = true;
      const { createGuidePanel } = await import('/js/guide-panel.js');
      const { createReader } = await import('/js/reader.js');
      window.game = { id: index.gameId, title: 'Duelo pela Terra Média', language: 'pt-BR', edition: '1', manual: { sha256: index.sourceHash, pages: index.pageCount, name: pdf, size: 100 } };
      window.calls = [];
      window.generations = 0;
      window.answers = new Map();
      window.behavior = 'ready';
      window.repo = {
        session: { canRead: true, canAskRules: true, canEdit: true, user: { uid: 'administrator' } },
        getTechnicalIndex: async () => index,
        getGuide: async () => null,
        getKnowledge: async () => null,
        getManual: async () => (await fetch('/qa.pdf')).blob(),
        async askRules(game, input, { signal }) {
          window.calls.push(structuredClone(input));
          if (window.behavior === 'wait')
            await new Promise((resolve, reject) => {
              window.release = resolve;
              signal.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')), { once: true });
            });
          if (window.behavior === 'quota')
            throw Object.assign(new Error('O orçamento diário das perguntas foi atingido. A consulta dos PDFs continua disponível.'), { status: 429, usage: { used: 10, limit: 10, applicationUsed: 20, applicationLimit: 30 } });
          if (window.behavior === 'failure') throw new Error('Gemini indisponível (HTTP 503). Nenhuma repetição automática foi feita.');
          const key = game.manual.sha256 + input.context.topic + input.question;
          const cached = window.answers.has(key);
          if (!cached) window.generations++;
          const answer = {
            id: 'simulated',
            insufficient: false,
            external: 'not-needed',
            blocks: [
              {
                kind: 'explanation',
                text: 'Confira os componentes e separe as peças indicadas no manual.',
                citations: [{ source: 'manual', name: pdf, documentId: input.context.documentId, sourceHash: input.context.sourceHash, page: input.context.page, quote: index.pages[input.context.page - 1].text.slice(0, 100) }],
              },
              {
                kind: 'exception',
                text: 'Exceção: esta frase apenas verifica o estilo do aviso simulado.',
                citations: [{ source: 'manual', name: pdf, documentId: input.context.documentId, sourceHash: input.context.sourceHash, page: input.context.page, quote: 'Citação simulada para validar a interface.' }],
              },
            ],
          };
          window.answers.set(key, answer);
          return { status: 'ready', answer, cached, usage: { used: window.generations, limit: 10, applicationUsed: window.generations, applicationLimit: 30, providerRemaining: null } };
        },
      };
      window.reader = createReader({
        repository: repo,
        getProgress: () => null,
        saveProgress() {},
        onError: (e) => {
          throw e;
        },
      });
      window.panel = createGuidePanel({
        repository: repo,
        openManual: (game, ref) => {
          window.reference = ref;
          return reader.open(game, ref);
        },
      });
      await panel.open(game);
    },
    { index, pdf },
  );
  assert.equal(await page.evaluate(() => calls.length), 0);
  await page.locator('#guide-search').fill('Componentes');
  await page.waitForFunction(() => document.querySelector('#guide-content').dataset.query === 'Componentes' && document.querySelector('.rule-ask'));
  assert.equal(await page.evaluate(() => calls.length), 0, 'pesquisa tradicional não chama IA');
  await page.locator('.rule-ask').first().click();
  assert.equal(await page.evaluate(() => calls.length), 0, 'abrir assistente também não chama IA');
  await page.locator('.rule-assistant textarea').fill('Quais componentes preciso separar?');
  await page.locator('.rule-assistant button[type=submit]').click();
  await page.locator('.rule-assistant-answer').waitFor();
  await page.evaluate(async () => {
    const { renderRuleReading } = await import('/js/rule-reading.js');
    const node = document.createElement('div');
    document.body.append(node);
    renderRuleReading(node, '<script>window.unsafe=true</script> <img src=x onerror="window.unsafe=true">');
    if (node.querySelector('script,img')) throw new Error('HTML inseguro');
    node.remove();
  });
  assert.match(await page.locator('.rule-assistant-usage').textContent(), /1\/10/);
  assert.equal(await page.evaluate(() => window.unsafe), undefined);
  assert.equal(await page.locator('.rule-assistant script').count(), 0);
  assert.match((await page.evaluate(() => calls[0])).context.topic, /componentes/i);
  assert.equal(await page.locator('#guide-dialog').evaluate((n) => n.open), true);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('.rule-assistant').scrollIntoViewIfNeeded();
    const layout = await page.locator('.rule-assistant').evaluate((n) => ({ width: n.getBoundingClientRect().width, scroll: n.scrollWidth, client: n.clientWidth, inner: innerWidth }));
    assert(layout.width <= layout.inner && layout.scroll <= layout.client + 1, JSON.stringify(layout));
    await page.screenshot({ path: `test-output/rule-assistant/assistant-${width}.png` });
    report.push({ width, ...layout });
  }
  // Mesmo assunto/pergunta: serviço simulado comprova que a interface trata o cache.
  await page.locator('.rule-assistant textarea').fill('Quais componentes preciso separar?');
  await page.locator('.rule-assistant button[type=submit]').click();
  await page.waitForFunction(() => document.querySelectorAll('.rule-assistant-answer').length === 2);
  assert.equal(await page.evaluate(() => generations), 1);
  assert.match(await page.locator('.rule-assistant-answer').last().textContent(), /reutilizada/);
  await page.locator('.rule-assistant textarea').fill('E a preparação?');
  await page.locator('.rule-assistant button[type=submit]').click();
  await page.waitForFunction(() => document.querySelectorAll('.rule-assistant-answer').length === 3);
  assert.equal(await page.evaluate(() => calls[0].conversationId === calls[2].conversationId), true);
  await page.evaluate(() => (behavior = 'quota'));
  await page.locator('.rule-assistant textarea').fill('Outra pergunta');
  await page.locator('.rule-assistant button[type=submit]').click();
  await page.getByText(/O orçamento diário das perguntas foi atingido/).waitFor();
  assert.equal((await page.locator('.rule-result').count()) > 0, true);
  await page.evaluate(() => (behavior = 'failure'));
  await page.locator('.rule-assistant button[type=submit]').click();
  await page.getByText(/Gemini indisponível/).waitFor();
  await page.evaluate(() => (behavior = 'wait'));
  await page.locator('.rule-assistant button[type=submit]').click();
  await page
    .locator('.rule-assistant button[type=submit]')
    .isDisabled()
    .then((value) => assert(value));
  await page.getByRole('button', { name: 'Cancelar pergunta', exact: true }).click();
  assert.equal(await page.locator('.rule-assistant-answer').count(), 3);
  // Citação abre leitor real na página e hash corretos.
  await page.locator('.rule-citation').first().locator('summary').click();
  await page
    .locator('.rule-citation')
    .first()
    .getByRole('button', { name: /Ver no manual/ })
    .click();
  await page.waitForFunction(() => document.querySelector('#reader-status').hidden && !document.querySelector('#page-number').disabled);
  assert.equal(Number(await page.locator('#page-number').inputValue()), await page.evaluate(() => reference.page));
  assert.equal(await page.evaluate(() => reference.sourceHash), index.sourceHash);
  await page.locator('#reader-close').click();
  await page.evaluate(() => panel.open(game));
  await page.locator('#guide-search').fill('Componentes');
  await page.locator('.rule-ask').first().waitFor();
  await page.locator('.rule-ask').first().click();
  await page.evaluate(() => (behavior = 'wait'));
  await page.locator('.rule-assistant textarea').fill('Pergunta pendente');
  await page.locator('.rule-assistant button[type=submit]').click();
  await page.evaluate(() => {
    game = { ...game, edition: '2' };
    panel.invalidate(game);
    window.release?.();
  });
  await page.waitForFunction(() => document.querySelector('.rule-assistant').hidden);
  assert.equal(await page.locator('.rule-assistant-answer').count(), 0);
  // Subadministrador sem edição ainda tem acesso; leitor comum só pesquisa PDFs.
  await page.evaluate(() => {
    repo.session = { ...repo.session, canEdit: false, canAskRules: true };
    panel.updateSession(repo.session);
  });
  await page.locator('.rule-ask').first().waitFor();
  await page.evaluate(() => {
    repo.session.canAskRules = false;
    panel.updateSession(repo.session);
  });
  await page.waitForFunction(() => !document.querySelector('.rule-ask'));
  await page.locator('#guide-search').fill('Preparação');
  await page.waitForFunction(() => document.querySelector('#guide-content').dataset.query === 'Preparação' && document.querySelector('.rule-result'));
  assert.equal(await page.locator('.rule-ask').count(), 0);
  assert.deepEqual(errors, []);
  await page.evaluate(() => panel.close());
  await writeFile(
    'test-output/rule-assistant/browser-report.json',
    JSON.stringify(
      { simulatedGemini: true, realPdf: pdf, scenarios: ['no automatic calls', 'context', 'follow-up', 'cache', 'quota', '503', 'cancel', 'real citation page', 'stale identity', 'subadmin without edit', 'reader', 'HTML safe'], viewports: report },
      null,
      2,
    ),
  );
  console.log('Assistente contextual: fluxos simulados, permissões na interface, referências reais e três tamanhos de tela aprovados.');
  await context.close();
} finally {
  await browser.close();
}
