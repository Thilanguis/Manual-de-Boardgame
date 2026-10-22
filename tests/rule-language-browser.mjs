import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { browserDependencies } from './browser-dependencies.mjs';
import { realIndex } from './real-index-fixture.mjs';

const { chromium } = browserDependencies('playwright');
const pdf = 'sushi_go_party_folheto_de_regras_traduzido_po_63713.pdf';
const index = await realIndex(pdf),
  bytes = await readFile('PDFs/' + pdf);
const duelPdf = 'Senhor dos aneis DUEL.pdf',
  duelIndex = await realIndex(duelPdf),
  duelBytes = await readFile('PDFs/' + duelPdf);
assert.equal(createHash('sha256').update(duelBytes).digest('hex'), duelIndex.sourceHash);
assert.equal(createHash('sha256').update(bytes).digest('hex'), index.sourceHash);
assert.equal(index.language, 'other', 'índice real reproduz o idioma antigo não identificado');
const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
const markup = (await readFile('index.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const out = 'test-output/rule-language';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const external = [],
  errors = [],
  snapshots = [];
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
  await context.route('**/__language-test', (route) => route.fulfill({ contentType: 'text/html', body: markup }));
  await context.route('**/duel-real.pdf', (route) => route.fulfill({ contentType: 'application/pdf', body: duelBytes }));
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/__language-test');
  await page.evaluate(
    async ({ index, pdf }) => {
      document.body.classList.add('access-approved');
      document.getElementById('session-loading').hidden = true;
      const { createGuidePanel } = await import('/js/guide-panel.js');
      window.sourceIndex = index;
      window.originalIndex = JSON.stringify(index);
      window.game = { id: index.gameId, title: 'Sushi Go Party!', language: 'other', manual: { sha256: index.sourceHash, pages: index.pageCount, name: pdf } };
      window.generations = 0;
      const repository = {
        mode: 'local',
        session: { canRead: true, canEdit: true, canAskRules: true, user: { uid: 'language-test' } },
        getGuide: async () => null,
        getKnowledge: async () => null,
        getTechnicalIndex: async () => sourceIndex,
        getManual: async () => (await fetch('/duel-real.pdf')).blob(),
        generateKnowledge: () => {
          generations++;
          throw new Error('Não gerar IA');
        },
        askRules: () => {
          generations++;
          throw new Error('Não consultar IA');
        },
      };
      window.panel = createGuidePanel({
        repository,
        openManual: (game, ref) => {
          window.reference = ref;
        },
      });
      await panel.open(game);
    },
    { index, pdf },
  );
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.getByRole('button', { name: /^CONTEÚDO/ }).click();
    await page.waitForFunction(() => document.querySelector('#guide-content').dataset.query === 'CONTEÚDO' && document.querySelector('.rule-result'));
    assert.equal(await page.locator('.rule-result').count(), 1, 'um cartão por assunto e página');
    const card = await page.locator('.rule-result').textContent();
    assert.doesNotMatch(card, /Tradução pendente|idioma.*não.*identificado/i);
    assert.match(card, /181 Cartas/);
    assert.match(card, /8 Peões/);
    assert.match(card, /WASABI|Wasabi/);
    assert.equal(await page.locator('.rule-result').getAttribute('data-page'), '2');
    assert.equal(await page.locator('#guide-dialog').evaluate((dialog) => dialog.scrollWidth > dialog.clientWidth + 1), false);
    await page.screenshot({ path: `${out}/conteudo-${width}.png` });
    snapshots.push({ width, cards: 1, page: 2, portugueseVisible: true });
    await page.locator('#guide-back').click();
  }
  // A busca livre usa a mesma decisão de idioma, sem obrigar o uso do atalho.
  await page.locator('#guide-search').fill('chopsticks');
  await page.waitForFunction(() => document.querySelector('#guide-content').dataset.query === 'chopsticks' && document.querySelector('.rule-result'));
  assert.doesNotMatch(await page.locator('#guide-content').textContent(), /Tradução pendente/);
  assert.match(await page.locator('.rule-preview').first().textContent(), /cartas|turno/);
  assert.equal(await page.evaluate(() => JSON.stringify(sourceIndex)), await page.evaluate(() => originalIndex));
  assert.equal(await page.evaluate(() => game.language), 'other', 'nenhuma alteração do cadastro');
  await page.evaluate(
    async ({ index, pdf }) => {
      window.sourceIndex = index;
      window.originalIndex = JSON.stringify(index);
      window.game = { id: index.gameId, title: 'Duelo pela Terra Média', language: 'pt-BR', manual: { sha256: index.sourceHash, pages: index.pageCount, name: pdf } };
      await panel.open(game);
    },
    { index: duelIndex, pdf: duelPdf },
  );
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.locator('.rules-topic-group .rules-more').evaluateAll((nodes) => nodes.forEach((node) => (node.open = true)));
    await page.getByRole('button', { name: /^CUSTOS DE CARTAS E PEÇAS/ }).click();
    await page.waitForFunction(() => document.querySelector('#guide-content').dataset.query === 'CUSTOS DE CARTAS E PEÇAS' && document.querySelector('.rule-result'));
    assert.equal(await page.locator('.rule-result').count(), 1);
    assert.equal(await page.locator('.rule-result').getAttribute('data-page'), '4');
    const full = page.locator('.rule-result details').filter({ has: page.locator('summary', { hasText: 'Ler trecho completo' }) });
    await full.locator('summary').click();
    assert.equal(await page.locator('.rule-preview').isVisible(), false, 'trecho completo substitui a prévia, sem repetir o mesmo texto');
    for (const heading of ['Moedas', 'Perícias', 'Encadeamento'])
      assert.equal(
        await full
          .locator('h4')
          .filter({ hasText: new RegExp('^' + heading + '$') })
          .count(),
        1,
      );
    assert.match(await full.textContent(), /1 Moeda/);
    assert.match(await full.textContent(), /gratuitamente/);
    await page.screenshot({ path: `${out}/custos-${width}.png` });
    snapshots.push({ width, title: 'Custos de cartas e peças', cards: 1, page: 4, subheadings: 3 });
    await page.locator('#guide-back').click();
  }
  assert.equal(await page.evaluate(() => JSON.stringify(sourceIndex)), await page.evaluate(() => originalIndex));
  assert.equal(await page.evaluate(() => generations), 0);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await writeFile(
    `${out}/report.json`,
    JSON.stringify({ pdf, duelPdf, snapshots, generations: 0, external, errors, limitations: 'PDFs e índices salvos reais. Sem Gemini, tradução real ou serviços de produção. Não altera o idioma cadastrado nem reescreve erros do OCR.' }, null, 2),
  );
  console.log('Sushi Go Party: Conteúdo em português em um cartão na p. 2. Duelo: Custos em um cartão na p. 4, com Moedas, Perícias e Encadeamento preservados. Três larguras, sem Gemini ou alterações nos índices/cadastro.');
} finally {
  await browser.close();
}
