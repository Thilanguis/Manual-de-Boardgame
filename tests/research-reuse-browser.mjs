import '../scripts/test-guard.mjs';
import { openGameManagement } from './game-ui-fixture.mjs';
import { enableLocalFixture } from './local-fixture.mjs';
// Aplicativo e IndexedDB reais, conectores simulados. PDF real opcional; não altera produção.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts } = require('pdf-lib');
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.setTitle('O Senhor dos Anéis: Sina da Sociedade');
pdf.addPage().drawText('O Senhor dos Anéis: Sina da Sociedade\nManual sintético de teste, sem dados de partida.', { x: 30, y: 740, font, size: 16 });
const bytes = process.env.ACERVO_SINA_PDF ? await readFile(process.env.ACERVO_SINA_PDF) : Buffer.from(await pdf.save());
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 1000 } });
    await context.addInitScript(() => {
      window.researchCalls = 0;
      const names = [
        { value: 'O Senhor dos Anéis: Sina da Sociedade', language: 'pt-BR' },
        { value: 'The Lord of the Rings: Fate of the Fellowship', language: 'en' },
        { value: 'Le Seigneur des Anneaux: Le Destin de la Communauté', language: 'fr' },
      ];
      const common = { id: 'Q137295527', identifiers: { wikidata: 'Q137295527', bgg: '436217' }, names, kind: 'base', edition: '', conflicts: [] };
      window.multiCandidates = {
        wikidata: {
          ...common,
          source: 'wikidata',
          url: 'https://www.wikidata.org/wiki/Q137295527',
          language: 'en',
          license: 'CC0',
          fields: { title: names[1].value, minPlayers: 1, maxPlayers: 5, minDurationMinutes: 60, maxDurationMinutes: 150, recommendedAge: 14 },
        },
        wikipedia: {
          ...common,
          source: 'wikipedia',
          url: 'https://fr.wikipedia.org/w/index.php?curid=1',
          language: 'fr',
          descriptionLanguage: 'pt',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
          authorsUrl: 'https://fr.wikipedia.org/w/index.php?curid=1&action=history',
          fields: { title: names[2].value, description: 'Trabalhe com a Sociedade para proteger Frodo e enfrentar as ameaças da Terra-média.', tags: ['Adventure', 'Strategy'], gameType: 'Cooperative' },
        },
      };
    });
    await context.route('**/js/local-repository.js', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replace(
          "mode: 'local',",
          `mode: 'fixture', async research(source, input){if(source==='sources') return {protocol:2,apiVersion:'fixture',sources:['wikidata','wikipedia'].map(id=>({id,name:id,enabled:true}))}; window.researchCalls++; return {source,fetchedAt:Date.now(),candidates:[window.multiCandidates[source]]};},`,
        ),
      });
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await enableLocalFixture(page.context());
    await page.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
    await page.waitForFunction(() => document.getElementById('account-label').textContent === 'Local');
    await page.locator('#empty-action').click();
    await page.locator('#pdf-file').setInputFiles({ name: 'O Senhor dos Anéis Sina da Sociedade.pdf', mimeType: 'application/pdf', buffer: bytes });
    await page.locator('.research-card').waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
    assert.equal(await page.locator('.research-card').count(), 1);
    assert.match(await page.locator('.research-card').innerText(), /2 fontes/);
    await page.locator('.research-card').screenshot({ path: `test-output/research-multilingual-${width}.png` });
    assert.match(await page.locator('.research-card').innerText(), /60–150/);
    const calls = await page.evaluate(() => window.researchCalls);
    await page.locator('[data-research-search]').click();
    await page.waitForFunction(() => document.querySelector('[data-research-status]').textContent.startsWith('Informações recuperadas'));
    assert.equal(await page.evaluate(() => window.researchCalls), calls, 'Pesquisa reutilizada sem chamadas externas');
    if (width === 1440)
      for (const alias of ['The Lord of the Rings: Fate of the Fellowship', 'Le Seigneur des Anneaux: Le Destin de la Communauté']) {
        await page.locator('#game-title').fill(alias);
        await page.locator('[data-research-search]').click();
        await page.waitForFunction(() => document.querySelector('[data-research-status]').textContent.startsWith('Informações recuperadas'));
        assert.equal(await page.evaluate(() => window.researchCalls), calls, 'Alias oficial reutiliza a mesma obra sem rede');
      }

    await page.locator('.research-card').getByRole('button', { name: 'Revisar sugestões' }).click();
    await page.locator('[data-research-all]').check();
    await page.locator('[data-research-review] input[type=checkbox]').last().check();
    await page.locator('[data-research-review] button').click();
    await page.locator('[data-game-step="2"]').waitFor({ state: 'visible' });
    const expected = { minPlayers: '1', maxPlayers: '5', minDurationMinutes: '60', maxDurationMinutes: '150', recommendedAge: '14', gameType: 'Cooperativo', tags: 'Aventura, Estratégia' };
    for (const [field, value] of Object.entries(expected)) assert.equal(await page.locator(`#game-form [name=${field}]`).inputValue(), value);
    await page.locator('#game-back').click();
    await page.locator('#game-next').click();
    await page.locator('#game-next').click();
    await page.locator('[name=confirmed]').check();
    await page.locator('#save-game').click();
    await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
    await page.reload();
    await page.locator('.card-main').click();
    await openGameManagement(page, 'manage-information');
    await page.locator('#edit-game').click();
    await page.locator('[data-research-search]').click();
    await page.waitForFunction(() => document.querySelector('[data-research-status]').textContent.startsWith('Informações recuperadas'));
    assert.equal(await page.evaluate(() => window.researchCalls), 0, 'Reabrir usa o IndexedDB já salvo');
    const saved = await page.evaluate(async () => {
      const { createLocalRepository } = await import('./js/local-repository.js'),
        repo = await createLocalRepository();
      const game = await new Promise((resolve) => {
        const stop = repo.subscribeGames((games) => {
          stop();
          resolve(games[0]);
        });
      });
      repo.close();
      return game;
    });
    assert.equal(saved.sources.duration.source, 'Wikidata · confirmado');
    assert.equal(saved.sources.description.source, 'Wikipédia · trecho confirmado');
    assert.equal(saved.sources.description.language, 'pt');
    assert.equal(saved.sources.description.licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/');
    assert.equal(saved.sources.tags.language, 'pt-BR');
    assert.equal(saved.sources.tags.originalLanguage, 'fr');
    assert.equal(saved.sources.catalog.matches.length, 2);
    if (width === 1440) {
      await page.evaluate(() => Object.assign(window.multiCandidates.wikipedia.fields, { minDurationMinutes: 45, maxDurationMinutes: 60 }));
      await page.locator('.research-options').evaluate((element) => (element.open = true));
      await page.locator('[data-research-refresh]').check();
      await page.locator('[data-research-search]').click();
      await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
      await page.locator('.research-card').getByRole('button', { name: 'Revisar sugestões' }).click();
      await page.locator('[data-research-alternative=minDurationMinutes]').selectOption('1');
      assert.equal(await page.locator('[data-research-alternative=maxDurationMinutes]').inputValue(), '1');
      await page.locator('[data-research-all]').check();
      await page.locator('[data-research-review] input[type=checkbox]').last().check();
      await page.locator('[data-research-review] button').click();
      assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '45');
      assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '60');
    }
    assert.equal(await page.evaluate(() => document.getElementById('upload-dialog').scrollWidth <= document.getElementById('upload-dialog').clientWidth + 1), true);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Sina PT/EN/FR: consolidação por campo, vocabulário PT, etapas 1/2/3, origem salva e duas reutilizações sem rede passaram em desktop/tablet/celular.');
} finally {
  await browser.close();
}
