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
  // O markup remove o bootstrap e não registra service worker. O bloqueador do
  // Playwright injeta script em srcdoc e lança SecurityError em iframe opaco;
  // não concedemos allow-same-origin ao widget só para acomodar esse script.
  const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 1440, height: 1000 } });
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
          if (window.behavior === 'quota') throw Object.assign(new Error('O provedor Gemini limitou as chamadas. Tente mais tarde; nenhuma repetição automática foi feita.'), { status: 429, reason: 'provider-rate-limit' });
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
          if (window.behavior === 'web') {
            answer.external = 'web-searched';
            answer.searchSuggestions = '<div>Resultados do Google Search</div><script>parent.googleWidgetUnsafe=true</script>';
            answer.blocks.push({
              kind: 'explanation',
              text: 'Complemento encontrado na internet para o jogo de tabuleiro.',
              citations: [{ id: 'web-1', source: 'web', name: 'Editora · esclarecimento', url: 'https://official.example.test/boardgame', quoteKind: 'search-summary', quote: 'Resumo de pesquisa com fonte, sem transcrição literal.' }],
            });
          }
          window.answers.set(key, answer);
          return { status: 'ready', answer, cached };
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
  assert.equal(await page.locator('.rule-assistant-usage').count(), 0);
  assert.doesNotMatch(await page.locator('.rule-assistant').textContent(), /quatro perguntas|Perguntas hoje|orçamento diário/i);
  assert.equal(await page.evaluate(() => window.unsafe), undefined);
  assert.equal(await page.locator('.rule-assistant script').count(), 0);
  assert.match((await page.evaluate(() => calls[0])).context.topic, /componentes/i);
  assert.match(await page.locator('.rule-assistant h3').textContent(), /Perguntar sobre:/, 'botão de trecho mantém assunto específico');
  assert.match(await page.locator('.rule-assistant').textContent(), /Interpretação da IA/);
  assert.equal(await page.locator('#guide-content').isVisible(), false, 'trechos dos PDFs não ficam misturados à conversa');
  assert.equal(await page.locator('#guide-query-form').isVisible(), false, 'existe apenas um campo de pergunta na conversa');
  assert.equal(await page.locator('.rule-answer-sources').evaluate((n) => n.open), false, 'fontes começam recolhidas');
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
  await page.getByText(/O provedor Gemini limitou as chamadas/).waitFor();
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
  await page.locator('.rule-conversation-history > summary').click();
  const citedAnswer = page.locator('.rule-assistant-answer').last();
  await citedAnswer.locator('.rule-answer-sources > summary').click();
  await citedAnswer.locator('.rule-citation').first().locator('summary').click();
  await citedAnswer
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
  // Leitor aprovado pode perguntar sem ganhar permissão para editar o jogo.
  await page.evaluate(async () => {
    const { accessFor } = await import('/js/permissions.js');
    repo.session = { ...repo.session, ...accessFor({ uid: 'approved-reader', role: 'user', status: 'approved' }, 'approved-reader'), user: { uid: 'approved-reader' } };
    panel.updateSession(repo.session);
    await panel.open(game);
  });
  await page.locator('#guide-search').fill('Componentes');
  await page.waitForFunction(() => document.querySelector('#guide-content').dataset.query === 'Componentes');
  await page.locator('.rule-ask').first().waitFor();
  const question =
    'Quando o killer movimenta o sobrevivente no colo, ele escolhe a quantidade até 4 movimentos e o sobrevivente joga o dado. se o sobrevivente n escapar conforme o killer vai levando ele pelo caminho escolhido até enganchar ele vai revelando tb conforme andando?';
  await page.evaluate(() => {
    behavior = 'ready';
  });
  const beforeTop = await page.evaluate(() => calls.length);
  await page.locator('#guide-search').fill(question);
  await page.waitForFunction((query) => document.querySelector('#guide-content').dataset.query === query, question);
  assert.equal(await page.evaluate(() => calls.length), beforeTop, 'digitar pergunta não gera IA');
  await page.locator('#guide-ask').click();
  await page.waitForFunction((count) => calls.length === count + 1 && document.querySelector('.rule-assistant-answer'), beforeTop);
  assert.equal(await page.evaluate(() => calls.at(-1).question), question);
  assert.equal(await page.locator('#guide-query-form').isVisible(), false);
  assert.equal(await page.locator('.rule-latest .rule-question').textContent(), question);
  assert.equal(await page.evaluate(() => calls.at(-1).context.topic), 'Regras do jogo');
  assert.equal(await page.locator('.rule-assistant h3').textContent(), 'Pergunta sobre o jogo');
  assert.equal(await page.evaluate(() => repo.session.canEdit), false);
  assert.match(await page.locator('.rule-assistant').textContent(), /documentos compatíveis do jogo/);
  assert(await page.evaluate(() => calls.at(-1).context.documentId && calls.at(-1).context.sourceHash && calls.at(-1).context.page > 0));
  await page.evaluate(() => (behavior = 'web'));
  await page.locator('.rule-assistant textarea').fill('Existe um esclarecimento da editora na internet?');
  await page.locator('.rule-assistant button[type=submit]').click();
  await page.getByText('Internet: consultada nesta pergunta.', { exact: true }).waitFor();
  assert.equal(await page.locator('.rule-conversation-history').evaluate((n) => n.open), false, 'respostas anteriores ficam recolhidas');
  assert.match(await page.locator('.rule-latest .rule-answer-basis').textContent(), /PDFs e internet/);
  await page.locator('.rule-latest .rule-answer-sources > summary').click();
  const webCitation = page.locator('.rule-citation').filter({ hasText: 'fonte da internet' });
  assert.equal(await webCitation.count(), 1);
  await webCitation.locator('summary').click();
  assert.match(await webCitation.textContent(), /não é transcrição literal/);
  assert.equal(await webCitation.getByRole('link').getAttribute('href'), 'https://official.example.test/boardgame');
  const widget = page.getByTitle('Sugestões do Google Search');
  assert.doesNotMatch(await widget.getAttribute('sandbox'), /allow-scripts|allow-same-origin/);
  assert.equal(await page.evaluate(() => window.googleWidgetUnsafe), undefined, 'HTML de sugestões não pode executar scripts ou acessar a sessão');
  await page.evaluate(() => (behavior = 'failure'));
  const failedQuestion = 'Tá, mas se eles interagirem, o que acontece?';
  await page.locator('.rule-assistant textarea').fill(failedQuestion);
  await page.locator('.rule-assistant button[type=submit]').click();
  await page.locator('.rule-assistant-status').filter({ hasText: 'Não consegui responder a esta pergunta.' }).waitFor();
  assert.equal(await page.locator('.rule-latest .rule-question').textContent(), failedQuestion);
  assert.equal(await page.locator('.rule-assistant-answer:visible').count(), 0, 'falha não aparece como continuação de uma resposta antiga');
  const historySize = await page.locator('.rule-conversation-history .rule-turn').count();
  await page.evaluate(() => (behavior = 'ready'));
  await page.locator('.rule-assistant button[type=submit]').click();
  await page.locator('.rule-latest .rule-assistant-answer').waitFor();
  assert.equal(await page.locator('.rule-conversation-history .rule-turn').count(), historySize, 'repetir explicitamente a pergunta substitui o erro em vez de duplicar a tentativa');
  assert.equal(await page.locator('.rule-assistant-status').isVisible(), false);
  // Pergunta digitada na busca e acionada em um resultado é enviada uma só vez.
  await page.locator('#guide-back').click();
  const directQuestion = 'Como pagar o custo de cartas e peças?';
  await page.locator('#guide-search').fill(directQuestion);
  await page.waitForFunction((q) => document.querySelector('#guide-content').dataset.query === q && document.querySelector('.rule-ask'), directQuestion);
  const beforeContextAsk = await page.evaluate(() => calls.length);
  await page.locator('.rule-ask').first().click();
  await page.locator('.rule-latest .rule-assistant-answer').waitFor();
  assert.equal(await page.evaluate(() => calls.length), beforeContextAsk + 1);
  assert.equal(await page.evaluate(() => calls.at(-1).question), directQuestion);
  await page.evaluate(async () => {
    const { accessFor } = await import('/js/permissions.js');
    repo.session = { ...repo.session, ...accessFor({ uid: 'approved-reader', role: 'user', status: 'blocked' }, 'approved-reader') };
    panel.updateSession(repo.session);
  });
  await page.waitForFunction(() => !document.querySelector('#guide-dialog').open && document.querySelector('.rule-assistant').hidden);
  assert.equal(await page.locator('#guide-ask').isVisible(), false);
  assert.deepEqual(errors, []);
  await page.evaluate(() => panel.close());
  await writeFile(
    'test-output/rule-assistant/browser-report.json',
    JSON.stringify(
      {
        simulatedGemini: true,
        realPdf: pdf,
        scenarios: ['no automatic calls', 'context', 'follow-up', 'cache', 'provider quota', 'no local counters', '503', 'cancel', 'real citation page', 'stale identity', 'approved reader without edit', 'blocked account', 'HTML safe'],
        viewports: report,
      },
      null,
      2,
    ),
  );
  console.log('Assistente contextual: fluxos simulados, permissões na interface, referências reais e três tamanhos de tela aprovados.');
  await context.close();
} finally {
  await browser.close();
}
