import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { browserDependencies } from './browser-dependencies.mjs';
import { libraryGames } from './library-filter-fixture.mjs';

const { chromium } = browserDependencies('playwright'),
  { PDFDocument, StandardFonts } = browserDependencies('pdf-lib');
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.addPage([595, 842]).drawText('Manual de teste da biblioteca', { x: 45, y: 740, size: 16, font });
const bytes = [...(await pdf.save())];
const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
const out = 'test-output/library-filters';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const external = [],
  errors = [],
  layouts = [];
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
  await context.route('**/config/app-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export const APP_CONFIG={allowLocalDevelopment:true,firebase:null,fileStorage:{},maxPdfBytes:52428800};' }));
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/?local=1');
  await page.waitForFunction(() => document.getElementById('connection-status').textContent.includes('Neste dispositivo'));
  await page.evaluate(
    async ({ games, bytes }) => {
      const { createLocalRepository } = await import('/js/local-repository.js');
      const repository = await createLocalRepository();
      const coverBlob = await (await fetch('/assets/icon-192.png')).blob();
      const data = { description: 'Jogo fictício para conferir filtros.', language: 'pt-BR', manual: { name: 'teste.pdf', pages: 1, sha256: 'a'.repeat(64), size: bytes.length, type: 'application/pdf' }, cover: {}, sources: {}, isPublic: true };
      for (const game of [...games, { ...games[0], id: 'hidden', title: 'Cadastro em exclusão', gameType: 'Tipo invisível', deleting: true }])
        await repository.saveGame({ ...data, ...game }, { manualBlob: new Blob([Uint8Array.from(bytes)], { type: 'application/pdf' }), coverBlob });
      repository.close();
    },
    { games: libraryGames, bytes },
  );
  await page.waitForFunction(() => document.querySelectorAll('.game-card').length === 5);
  const facet = (key) => page.locator(`[data-library-facet="${key}"]`);
  const titles = () => page.locator('.card-title').allTextContents();
  assert.doesNotMatch(await facet('gameType').textContent(), /Tipo invisível/);
  assert.match(await facet('gameType').textContent(), /Jogo de cartas · 2/);
  assert.match(await facet('category').textContent(), /Fantasia · 2/);
  assert.match(await facet('players').textContent(), /8 jogadores · 1/);
  await page.locator('#library-filters > summary').click();
  await facet('players').selectOption('4');
  await facet('duration').selectOption('30');
  assert.deepEqual(await titles(), ['Jantar de cartas']);
  assert.match(await page.locator('#game-count').textContent(), /1 de 5 jogos/);
  assert.doesNotMatch(await facet('mechanic').textContent(), /Exploração|Rolagem de dados/);
  await facet('gameType').selectOption('jogo de cartas');
  await facet('mechanic').selectOption('selecao de cartas');
  await page.locator('.card-favorite').click();
  await page.locator('[data-filter=favorites]').click();
  assert.equal(await page.locator('[data-filter=quick]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-filter=favorites]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await titles(), ['Jantar de cartas']);
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.locator('.library-heading').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.getElementById('library-filters').scrollWidth > document.getElementById('library-filters').clientWidth + 1);
    assert.equal(overflow, false);
    await page.locator('.game-card').evaluateAll(async (nodes) => {
      await Promise.all(nodes.flatMap((node) => node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
      await Promise.all(nodes.flatMap((node) => [...node.querySelectorAll('img')].filter((image) => image.src).map((image) => image.decode())));
    });
    await page.screenshot({ path: `${out}/filtros-${width}.png` });
    layouts.push({ width, overflow });
  }
  await page.getByRole('button', { name: 'Remover Duração: Até 30 min', exact: true }).click();
  assert.equal(await facet('duration').inputValue(), '');
  assert.equal(await facet('mechanic').inputValue(), 'selecao de cartas');
  await page.getByRole('button', { name: 'Remover Mecânica: Seleção de cartas', exact: true }).click();
  await page.locator('[data-filter=favorites]').click();
  assert.equal(await page.locator('.game-card').count(), 2);
  await page.locator('#search').fill('recursos');
  assert.equal(await page.locator('.game-card').count(), 0);
  assert.match(await facet('gameType').locator('option:checked').textContent(), /Jogo de cartas · 0/);
  assert.equal(await page.locator('#no-results').isVisible(), true);
  await page.locator('#clear-filters').click();
  assert.equal(await page.locator('.game-card').count(), 5);
  assert.equal(await page.locator('#library-active-filters').isVisible(), false);
  await facet('age').selectOption('8');
  assert.deepEqual(await titles(), ['Jantar de cartas']);
  await page.locator('[data-clear-library-filters]').click();
  await page.locator('#search').fill('dados');
  assert.deepEqual(await titles(), ['Dados e cartas']);
  await page.locator('#search').fill('gestao recursos');
  assert.deepEqual(await titles(), ['Bosque dos recursos']);
  await page.locator('[data-filter=all]').click();
  await page.locator('[data-filter=quick]').click();
  assert.deepEqual(await titles(), ['Jantar de cartas']);
  await page.locator('[data-filter=all]').click();
  await page.locator('#sort').selectOption('duration');
  assert.deepEqual((await titles()).slice(0, 3), ['Jantar de cartas', 'Bosque dos recursos', 'Dados e cartas']);
  await page.locator('[data-filter=favorites]').click();
  assert.deepEqual(await titles(), ['Jantar de cartas']);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#nav-library').click();
  assert.equal(await page.locator('.game-card').count(), 5);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await writeFile(
    `${out}/report.json`,
    JSON.stringify({ layouts, external, errors, fixtureGames: 5, limitations: 'Aplicação completa e armazenamento local em contexto descartável, com jogos e PDF fictícios. Sem Firebase, Drive, Gemini ou dados reais do usuário.' }, null, 2),
  );
  console.log('Biblioteca: filtros combinados, contagens dinâmicas, aliases, favoritos independentes, remoção individual, busca ampliada e três larguras aprovados. Somente dados locais fictícios.');
} finally {
  await browser.close();
}
