// app.js real, PDFs/IndexedDB reais em perfil descartável; somente conectores externos simulados.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const title = 'O Senhor dos Anéis: Sina da Sociedade';
const description = 'Trabalhe com a Sociedade para proteger Frodo e enfrentar as ameaças da Terra-média.';
// Fatos de teste conferidos na página oficial Z-Man. Não constitui um conector de produção.
const fields = {
  title: 'The Lord of the Rings: Fate of the Fellowship',
  description,
  minPlayers: 1,
  maxPlayers: 5,
  minDurationMinutes: 60,
  maxDurationMinutes: 150,
  recommendedAge: 14,
  tags: ['Aventura', 'Estratégia'],
  mechanics: ['Cooperação'],
  gameType: 'Cooperativo',
};
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica),
  sheet = pdf.addPage();
pdf.setTitle(title);
sheet.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(0.09, 0.09, 0.11) });
sheet.drawText('O Senhor dos Anéis\nSina da Sociedade\n\nManual sintético de teste do cadastro.\nSem regras ou dados de partida neste arquivo.', { font, size: 22, x: 35, y: 720, color: rgb(0.95, 0.9, 0.8), lineHeight: 38 });
const bytes = Buffer.from(await pdf.save());
const actualPdf = process.env.ACERVO_SINA_PDF ? await readFile(process.env.ACERVO_SINA_PDF) : null;
await mkdir('test-output', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 1000 } });
    await context.route('**/js/local-repository.js', async (route) => {
      const response = await route.fetch();
      const source = (await response.text()).replace(
        "mode: 'local',",
        `mode: 'fixture',
        async research(source) {
          if (source === 'sources') return { protocol: 2, apiVersion: 'fixture', sources: [{ id: 'wikidata', name: 'Wikidata', enabled: true, url: 'https://www.wikidata.org', reason: 'fixture' }, { id: 'bgg', name: 'BoardGameGeek', enabled: false, url: 'https://boardgamegeek.com', reason: 'exige autorização' }] };
          return { source, candidates: [window.uxCandidate] };
        },`,
      );
      await route.fulfill({ response, body: source });
    });
    await context.addInitScript(
      ({ fields, title }) => {
        window.uxCandidate = {
          source: 'wikidata',
          id: 'Q137295527',
          url: 'https://www.wikidata.org/wiki/Q137295527',
          fields,
          names: [
            { value: title, language: 'pt-BR' },
            { value: fields.title, language: 'en' },
            { value: 'Le Seigneur des Anneaux: Le Destin de la Communauté', language: 'fr' },
          ],
          identifiers: { bgg: '436217' },
          kind: 'base',
          edition: '',
          language: 'en',
          fieldLanguages: { description: 'pt-BR' },
          descriptionLanguage: 'pt-BR',
          license: 'CC0',
          conflicts: [],
        };
      },
      { fields, title },
    );
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
    await page.waitForFunction(() => document.getElementById('account-label').textContent === 'Local');
    await page.locator('#empty-action').click();
    await page.locator('#pdf-file').setInputFiles({ name: 'Sina-PT-BR.pdf', mimeType: 'application/pdf', buffer: width === 1440 && actualPdf ? actualPdf : bytes });
    const card = page.locator('.research-card[data-research-source=wikidata]');
    await card.waitFor();
    assert.equal(await card.locator('h4').textContent(), title);
    assert.match(await card.locator('.research-facts').textContent(), /1–5 jogadores.*60–150 min.*14\+ anos/);
    assert.equal(await page.locator('[data-research-status]').textContent(), '1 jogo encontrado.');
    assert(!(await page.locator('#research-panel').innerText()).includes('exige autorização'));
    assert.equal(await card.locator('details').getAttribute('open'), null);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-output/research-result-${width}.png`, fullPage: false, animations: 'disabled' });
    await card.getByRole('button', { name: 'Revisar sugestões', exact: true }).click();
    await page.locator('[data-research-field=title]').check();
    // Antes da confirmação os campos continuam vazios.
    assert.equal(await page.locator('#game-form [name=description]').inputValue(), '');
    if (width === 1440) {
      await page.locator('#game-next').click();
      await page.locator('#game-form [name=description]').fill('Texto que editei durante a revisão.');
      await page.locator('#game-back').click();
      await page.locator('[data-research-review] input[type=checkbox]').last().check();
      await page.locator('[data-research-review] button').click();
      assert.match(await page.locator('[data-research-review] [role=alert]:visible').textContent(), /alterou os dados/);
      assert.equal(await page.locator('#game-form [name=description]').inputValue(), 'Texto que editei durante a revisão.');
      assert.equal(await page.locator('[data-research-field=description]').isChecked(), false);
      await page.locator('[data-research-field=description]').check();
    }
    await page.locator('[data-research-review] input[type=checkbox]').last().check();
    await page.locator('[data-research-review] button').click();
    const expected = { description, minPlayers: '1', maxPlayers: '5', minDurationMinutes: '60', maxDurationMinutes: '150', recommendedAge: '14', tags: 'Aventura, Estratégia', mechanics: 'Cooperação', gameType: 'Cooperativo' };
    for (const [key, value] of Object.entries(expected)) assert.equal(await page.locator(`#game-form [name=${key}]`).inputValue(), value, `${width}: ${key}`);
    await page.locator('#game-back').click();
    await page.locator('#game-next').click();
    for (const [key, value] of Object.entries(expected)) assert.equal(await page.locator(`#game-form [name=${key}]`).inputValue(), value);
    await page.locator('#game-next').click();
    await page.locator('[name=confirmed]').check();
    await page.locator('#save-game').click();
    await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
    const saved = await page.evaluate(async () => {
      const { createLocalRepository } = await import('./js/local-repository.js'),
        repo = await createLocalRepository();
      const games = await new Promise((resolve) => {
        const unsub = repo.subscribeGames((games) => {
          unsub();
          resolve(games);
        });
      });
      repo.close();
      return games[0];
    });
    for (const [key, value] of Object.entries(fields).filter(([key]) => key !== 'title')) assert.deepEqual(saved[key], value, `Registro salvo: ${key}`);
    assert.equal(saved.sources.description.url, 'https://www.wikidata.org/wiki/Q137295527');
    assert.equal(saved.sources.description.license, 'CC0');
    assert(saved.sources.description.confirmedAt);
    if (width === 1440 && actualPdf) assert.equal(saved.manual.pages, 24, 'Fluxo executado com o PDF brasileiro real de 24 páginas');
    await page.reload();
    await page.locator('.game-card').waitFor();
    assert.equal(await page.locator('.hero').isVisible(), false, 'Salvar não escolhe um destaque automaticamente');
    await page.locator('.card-main').click();
    await page.locator('[data-close=detail-dialog]').click();
    assert.match(await page.locator('#hero-description').textContent(), /Sociedade/);
    assert(!(await page.locator('main').innerText()).match(/Firebase|Cloudflare|Spark|Drive central/));
    assert.equal(await page.locator('.connection-bar').isVisible(), false);
    if (await page.locator('#notice-close').isVisible()) await page.locator('#notice-close').click();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: `test-output/home-one-${width}.png`, fullPage: true, animations: 'disabled' });
    // Conteúdo genérico antigo é preservado no registro e omitido da sinopse pública.
    await page.evaluate(
      async ({ saved, bytes }) => {
        const { createLocalRepository } = await import('./js/local-repository.js'),
          repo = await createLocalRepository();
        const coverBlob = await (await fetch(await repo.getCoverURL(saved))).blob();
        await repo.saveGame({ ...saved, description: '2025 board game' });
        for (let i = 1; i <= 10; i++) await repo.saveGame({ ...saved, id: `game-${i}`, title: `Jogo de teste ${i}`, description: '', createdAt: Date.now() + i }, { manualBlob: new Blob([Uint8Array.from(bytes)]), coverBlob });
        repo.close();
      },
      { saved, bytes: [...bytes] },
    );
    await page.waitForFunction(() => document.querySelectorAll('.game-card').length === 11);
    assert.equal(await page.locator('#hero-description').textContent(), '');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: `test-output/home-many-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.locator('.library-options summary').click();
    await page.locator('#setup-button').click();
    assert.equal(await page.locator('#setup-technical').isVisible(), false);
    await page.locator('[data-close=setup-dialog]').click();
    assert.equal(await page.locator('.site-footer > span').first().textContent(), 'Para quem gosta de reunir pessoas em volta da mesa.');
    // Caso somente título: nem o cartão nem a aplicação prometem metadados inexistentes.
    await page.evaluate(() => {
      window.uxCandidate.fields = { title: 'The Lord of the Rings: Fate of the Fellowship', description: '2025 board game' };
    });
    await page.locator('[data-add]').first().click();
    // Outro PDF evita a proteção legítima de duplicidade.
    await page.locator('#pdf-file').setInputFiles({ name: 'Sina-variante-PT-BR.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([bytes, Buffer.from('\n%fixture-variant')]) });
    await card.waitFor();
    assert.match(await card.innerText(), /Só o título.*Sem outros dados/);
    assert.equal(await card.locator('.research-facts').count(), 0);
    assert(!(await card.innerText()).includes('2025 board game'));
    await card.getByRole('button', { name: 'Revisar sugestões' }).click();
    assert.equal(await page.locator('[data-research-field]').count(), 1);
    await page.locator('[data-research-field=title]').check();
    await page.locator('[data-research-review] input[type=checkbox]').last().check();
    await page.locator('[data-research-review] button').click();
    for (const key of ['description', 'minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes', 'recommendedAge', 'tags', 'mechanics', 'gameType'])
      assert.equal(await page.locator(`#game-form [name=${key}]`).inputValue(), '', `Título apenas: ${key}`);
    await page.locator('#game-next').click();
    await page.locator('[name=confirmed]').check();
    await page.locator('#save-game').click();
    await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
    const titleOnly = await page.evaluate(async () => {
      const { createLocalRepository } = await import('./js/local-repository.js'),
        repo = await createLocalRepository();
      const games = await new Promise((resolve) => {
        const unsub = repo.subscribeGames((games) => {
          unsub();
          resolve(games);
        });
      });
      repo.close();
      return games.find((game) => game.manual.name === 'Sina-variante-PT-BR.pdf');
    });
    assert.equal(titleOnly.description, '');
    assert.equal(titleOnly.minPlayers, null);
    assert.equal(titleOnly.maxPlayers, null);
    assert.equal(titleOnly.minDurationMinutes, null);
    assert.equal(titleOnly.maxDurationMinutes, null);
    assert.deepEqual(titleOnly.tags, []);
    assert.equal(titleOnly.recommendedAge, null);
    assert.deepEqual(titleOnly.mechanics, []);
    assert.equal(titleOnly.gameType, '');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`Sina da Sociedade: revisão manual, todos os inputs, ida/volta, registro salvo, título apenas e home com 1/11 jogos passaram em desktop/tablet/celular.${actualPdf ? ' PDF brasileiro real de 24 páginas testado em desktop.' : ''}`);
} finally {
  await browser.close();
}
