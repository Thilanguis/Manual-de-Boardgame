import '../scripts/test-guard.mjs';
import { enableLocalFixture } from './local-fixture.mjs';
// Catálogo/motor simulados; cadastro, revisão, inputs e registro IndexedDB reais.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts } = require('pdf-lib');
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.setTitle('Survivor Test');
pdf.addPage().drawText('Survivor Test\nPlayers take actions on their turn with cards and pieces.', { x: 30, y: 740, font, size: 15 });
const bytes = Buffer.from(await pdf.save());
const original = 'Move the survivors through the hallways and use their actions to escape the mansion.';
const portuguese = 'Mova os sobreviventes pelos corredores e use suas ações para escapar da mansão.';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 1000 } });
    await context.addInitScript(
      ({ original, portuguese, native }) => {
        window.fixtureOriginal = original;
        Object.defineProperty(window, 'Translator', { configurable: true, value: native ? { availability: async () => 'downloadable', create: async () => ({ targetLanguage: 'pt', destroy() {}, translate: async () => portuguese }) } : undefined });
      },
      { original, portuguese, native: width === 1440 },
    );
    await context.route('**/js/local-repository.js', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replace(
          "mode: 'local',",
          `mode:'fixture',async research(source){if(source==='sources')return{protocol:2,sources:[{id:'wikidata',enabled:true}]};return{source,candidates:[{source:'wikidata',id:'QTEST',identifiers:{wikidata:'QTEST'},kind:'base',edition:'',language:'en',license:'CC0',url:'https://www.wikidata.org',names:[{value:'Survivor Test',language:'en'}],fields:{title:'Survivor Test',description:window.fixtureOriginal,minPlayers:2,maxPlayers:4,durationMinutes:60,tags:['Strategy'],gameType:'Cooperative'}}]};},`,
        ),
      });
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await enableLocalFixture(page.context());
    await page.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
    await page.waitForFunction(() => document.getElementById('account-label').textContent === 'Local');
    await page.locator('#empty-action').click();
    await page.locator('#pdf-file').setInputFiles({ name: 'Survivor Test.pdf', mimeType: 'application/pdf', buffer: bytes });
    const card = page.locator('[data-research-source=wikidata]');
    await card.waitFor();
    assert.equal(await card.locator(':scope > p').filter({ hasText: original }).count(), 0, 'o resumo estrangeiro não é apresentado como português');
    if (width === 1440) {
      await card.getByRole('button', { name: 'Traduzir para português' }).click();
      await page.waitForFunction(() => document.querySelector('[data-research-status]').textContent.startsWith('Tradução pronta'));
      assert.match(await card.innerText(), /Mova os sobreviventes/);
      await card.getByRole('button', { name: 'Revisar sugestões', exact: true }).click();
    } else {
      await card.getByRole('button', { name: 'Revisar sugestões', exact: true }).click();
      await page.getByText('Escrever tradução em português', { exact: true }).click();
      await page.locator('[data-manual-translation=description]').fill(portuguese);
      await page.getByRole('button', { name: 'Adicionar traduções às sugestões' }).click();
    }
    await page.locator('[data-research-all]').check();
    await page.locator('[data-research-review] input[type=checkbox]').last().check();
    await page.locator('[data-research-review] > button').click();
    assert.equal(await page.locator('[data-game-step="2"]').isVisible(), true);
    assert.equal(await page.locator('#game-form [name=description]').inputValue(), portuguese);
    assert.equal(await page.locator('[name=tags]').inputValue(), 'Estratégia');
    await page.locator('[name=language]').selectOption('en');
    await page.locator('#game-next').click();
    await page.locator('[name=confirmed]').check();
    await page.locator('#save-game').click();
    await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
    const saved = await page.evaluate(async () => {
      const { createLocalRepository } = await import('./js/local-repository.js');
      const repo = await createLocalRepository();
      const games = await new Promise((resolve) => {
        const stop = repo.subscribeGames((value) => {
          stop();
          resolve(value);
        });
      });
      repo.close();
      return games[0];
    });
    assert.equal(saved.description, portuguese);
    assert.equal(saved.language, 'en');
    assert.equal(saved.sources.description.language, 'pt-BR');
    assert.equal(saved.sources.description.originalLanguage, 'en');
    assert.equal(saved.sources.description.originalValue, original);
    assert.equal(saved.sources.description.translationMethod, width === 1440 ? 'browser-local' : 'manual');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Catálogo: tradução local simulada e tradução manual sem API → revisão → etapa 2 → registro PT salvo, original/fonte preservados e idioma real do PDF mantido.');
} finally {
  await browser.close();
}
