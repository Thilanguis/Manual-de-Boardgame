import '../scripts/test-guard.mjs';
import { openGameManagement } from './game-ui-fixture.mjs';
import { enableLocalFixture } from './local-fixture.mjs';
// Formulário, revisão e IndexedDB reais; formatos de resposta de API/OCR simulados, sem dados de produção.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts } = require('pdf-lib');
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.setTitle('Ilha dos minutos');
pdf.addPage().drawText('Ilha dos minutos\nManual de teste: cartas e tabuleiro para preparar a partida.', { x: 30, y: 750, font, size: 18 });
const bytes = Buffer.from(await pdf.save());
const cases = [
  { name: 'fixa-limites-vazios', fields: { durationMinutes: 75, minDurationMinutes: null, maxDurationMinutes: null }, expected: [75, 75] },
  { name: 'fixa-um-limite-vazio', fields: { durationMinutes: 75, minDurationMinutes: 75, maxDurationMinutes: null }, expected: [75, 75] },
  { name: 'fixa-com-unidade', fields: { durationMinutes: '45 min' }, expected: [45, 45] },
  { name: 'intervalo-em-horas', fields: { durationMinutes: '1–2 horas' }, expected: [60, 120] },
  { name: 'ocr-legado', fields: { durationMinutes: 90, minDurationMinutes: null, maxDurationMinutes: null }, expected: [90, 90], ocr: true },
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 390])
    for (const item of cases) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 1000 } });
      await context.addInitScript((item) => {
        window.durationCase = item;
      }, item);
      await context.route('**/js/local-repository.js', async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body: (await response.text()).replace(
            "mode: 'local',",
            `mode:'fixture',async research(source){return source==='sources'?{protocol:2,apiVersion:'fixture',sources:[{id:'wikidata',name:'Fonte de teste',enabled:true,url:'https://www.wikidata.org',reason:'fixture'}]}:{source,candidates:window.durationCase.ocr?[]:[{source:'wikidata',id:'time-fixture',url:'https://www.wikidata.org/wiki/Q17271',fields:{title:'Ilha dos minutos',...window.durationCase.fields},names:[{value:'Ilha dos minutos',language:'pt-BR'}],kind:'unknown',language:'pt-BR',license:'CC0',conflicts:[]}]};},`,
          ),
        });
      });
      await context.route('**/js/pdf-ocr.js', (route) =>
        route.fulfill({
          contentType: 'text/javascript',
          body: `export async function recognizePdfImages(){return {metadata:{...window.durationCase.fields,language:'pt-BR',sources:{duration:{source:'PDF de teste',page:1,excerpt:'90 minutos'}}},pages:[{page:1}]};}`,
        }),
      );
      const page = await context.newPage(),
        errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await enableLocalFixture(page.context());
      await page.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
      await page.waitForFunction(() => document.getElementById('account-label').textContent === 'Local');
      await page.locator('#empty-action').click();
      await page.locator('#pdf-file').setInputFiles({ name: 'Ilha.pdf', mimeType: 'application/pdf', buffer: bytes });
      await page.locator('#game-form').waitFor({ state: 'visible' });
      if (item.ocr) {
        await page.locator('.research-options summary').click();
        await page.locator('[data-research-ocr]').click();
      }
      if (item.name.startsWith('fixa-')) {
        const accept = (dialog) => dialog.accept();
        page.on('dialog', accept);
        await page.locator('[data-research-use-all]').click();
        assert.equal(await page.locator('[data-research-review]').isVisible(), false);
        page.off('dialog', accept);
      } else {
        await page.locator('.research-card').getByRole('button', { name: 'Revisar sugestões', exact: true }).click();
        assert.equal(await page.locator('[data-research-field=minDurationMinutes]').count(), 1, item.name);
        assert.equal(await page.locator('[data-research-field=maxDurationMinutes]').count(), 1, item.name);
        await page.locator('[data-research-all]').check();
        for (const box of await page.locator('[data-research-field]').all()) assert.equal(await box.isChecked(), true);
        await page.locator('[data-research-all]').uncheck();
        for (const box of await page.locator('[data-research-field]').all()) assert.equal(await box.isChecked(), false);
        await page.locator('[data-research-all]').check();
        // Selecionar todos não confirma a revisão no lugar do administrador.
        assert.equal(await page.locator('[data-research-review] button').isDisabled(), true);
        await page.locator('[data-research-review] input[type=checkbox]').last().check();
        await page.locator('[data-research-review] button').click();
      }
      assert.equal(await page.locator('[data-game-step="2"]').isVisible(), true, item.name + ': ' + (await page.locator('[data-research-status]').textContent()));
      for (const [key, value] of [
        ['minDurationMinutes', item.expected[0]],
        ['maxDurationMinutes', item.expected[1]],
      ])
        assert.equal(await page.locator(`[name=${key}]`).inputValue(), String(value), `${width}/${item.name}/${key}`);
      await page.locator('#game-back').click();
      await page.locator('#game-next').click();
      assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), String(item.expected[1]));
      await page.locator('#game-next').click();
      await page.locator('[name=confirmed]').check();
      await page.locator('#save-game').click();
      await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
      const saved = await page.evaluate(async () => {
        const { createLocalRepository } = await import('./js/local-repository.js');
        const repo = await createLocalRepository();
        const game = await new Promise((resolve) => {
          const unsub = repo.subscribeGames((games) => {
            unsub();
            resolve(games[0]);
          });
        });
        repo.close();
        return game;
      });
      assert.deepEqual([saved.minDurationMinutes, saved.maxDurationMinutes], item.expected);
      assert.equal(saved.durationMinutes, item.expected[0] === item.expected[1] ? item.expected[0] : null);
      assert(saved.sources.duration.confirmedAt);
      await page.reload();
      await page.locator('.card-main').click();
      await openGameManagement(page, 'manage-information');
      await page.locator('#edit-game').click();
      await page.locator('#game-next').click();
      assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), String(item.expected[0]));
      assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), String(item.expected[1]));
      if (item.name === 'fixa-limites-vazios') {
        await page.locator('#game-form [name=description]').fill('Descrição editada por mim.');
        await page.evaluate(() => {
          window.durationCase.fields = { durationMinutes: 90 };
        });
        await page.locator('#game-back').click();
        await page.locator('.research-options').evaluate((element) => (element.open = true));
        await page.locator('[data-research-refresh]').check();
        await page.locator('[data-research-search]').click();
        page.once('dialog', (dialog) => dialog.dismiss());
        await page.locator('[data-research-use-all]').click();
        await page.waitForFunction(() => document.querySelector('[data-research-status]').textContent === 'Nenhum campo foi alterado.');
        assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '75');
        page.once('dialog', (dialog) => dialog.accept());
        await page.locator('[data-research-use-all]').click();
        await page.locator('[data-game-step="2"]').waitFor({ state: 'visible' });
        assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '90');
        assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '90');
        assert.equal(await page.locator('#game-form [name=description]').inputValue(), 'Descrição editada por mim.');
        await page.locator('#game-next').click();
        await page.locator('[name=confirmed]').check();
        await page.locator('#save-game').click();
        await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
        await page.reload();
        await page.locator('.card-main').click();
        await openGameManagement(page, 'manage-information');
        await page.locator('#edit-game').click();
        await page.locator('#game-next').click();
        assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '90');
        assert.equal(await page.locator('#game-form [name=description]').inputValue(), 'Descrição editada por mim.');
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  console.log(`${cases.length * 2} fluxos desktop/celular: usar sugestões/selecionar todos/cancelar substituição na edição → duração fixa/intervalo/horas/OCR legado → revisão → dois inputs → ida/volta → registro salvo → reabertura passaram.`);
} finally {
  await browser.close();
}
