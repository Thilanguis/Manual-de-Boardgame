// Exercita app.js e o salvamento reais, com PDF sintético e somente a API externa simulada.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts } = require('pdf-lib');
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica),
  sheet = pdf.addPage();
pdf.setTitle('Catan');
sheet.drawText('Catan\nJogadores: 3 a 4\nComponentes: cartas e pecas.', { font, size: 18, x: 30, y: 740 });
const bytes = Buffer.from(await pdf.save());
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 1000 } });
    // Mantém o repositório IndexedDB real; a fixture fornece apenas a pesquisa externa.
    await context.route('**/js/local-repository.js', async (route) => {
      const response = await route.fetch();
      const source = (await response.text()).replace(
        "mode: 'local',",
        `mode: 'fixture',
        async research(source) {
          if (source === 'sources') return { protocol: 2, apiVersion: 'fixture', sources: [{ id: 'wikidata', name: 'Wikidata', enabled: true, url: 'https://www.wikidata.org', reason: 'teste' }] };
          return { source, candidates: [window.candidateFixture] };
        },`,
      );
      await route.fulfill({ response, body: source });
    });
    await context.addInitScript(() => {
      window.candidateFixture = {
        source: 'wikidata',
        id: 'Q17271',
        url: 'https://www.wikidata.org/wiki/Q17271',
        fields: { title: 'Catan', description: 'Resumo sintético confirmado para testar o cadastro.', durationMinutes: 75, recommendedAge: 10, tags: ['Estratégia'], mechanics: ['Negociação'] },
        names: [{ value: 'Catan', language: 'pt' }],
        identifiers: { wikidata: 'Q17271' },
        kind: 'unknown',
        edition: '',
        language: 'pt',
        license: 'CC0',
        conflicts: [],
      };
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
    await page.waitForFunction(() => document.getElementById('account-label').textContent === 'Local');
    await page.locator('#empty-action').click();
    await page.locator('#pdf-file').setInputFiles({ name: 'Catan.pdf', mimeType: 'application/pdf', buffer: bytes });
    await page
      .locator('.research-card')
      .waitFor({ timeout: 12000 })
      .catch(async (error) => {
        console.log(
          await page.evaluate(() => ({
            research: document.querySelector('[data-research-status]').textContent,
            status: document.getElementById('upload-status').textContent,
            formHidden: document.getElementById('game-form').hidden,
            open: document.getElementById('upload-dialog').open,
            title: document.getElementById('game-title').value,
          })),
          errors,
        );
        throw error;
      });
    // Avançar sem confirmar não transfere dados silenciosamente e explica a pendência.
    await page.locator('#game-next').click();
    assert.equal(await page.locator('#research-pending').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.equal(await page.locator('#game-form [name=description]').inputValue(), '');
    await page.locator('#review-pending-suggestions').click();
    await page.locator('.research-card button').click();
    await page.locator('[data-research-review] input[type=checkbox]').last().check();
    await page.locator('[data-research-review] button').click();
    assert.equal(await page.locator('[data-game-step="2"]').isVisible(), true);
    assert.equal(await page.locator('#game-form [name=description]').inputValue(), 'Resumo sintético confirmado para testar o cadastro.');
    assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '75');
    assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '75');
    assert.equal(await page.locator('[name=tags]').inputValue(), 'Estratégia');
    assert.equal(await page.locator('#research-pending').isVisible(), false);
    assert.match(await page.locator('#research-applied').textContent(), /resumo.*duração/);
    if (width === 390) await page.screenshot({ path: 'test-output/research-transfer-mobile.png', fullPage: true });
    // Nova pesquisa com faixa conflitante preserva o valor confirmado até escolha explícita.
    await page.evaluate(() => {
      window.candidateFixture.fields = { title: 'Catan', minDurationMinutes: 60, maxDurationMinutes: 120 };
    });
    await page.locator('#game-back').click();
    await page.locator('[data-research-search]').click();
    await page.locator('.research-card button').click();
    const confirm = page.locator('[data-research-review] input[type=checkbox]').last();
    await confirm.check();
    assert.equal(await page.locator('[data-research-review] button').isDisabled(), true);
    assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '75');
    await page.locator('[data-research-field=minDurationMinutes]').check();
    assert.equal(await page.locator('[data-research-field=maxDurationMinutes]').isChecked(), true);
    await page.locator('[data-research-review] button').click();
    assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '60');
    assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '120');
    assert.equal(await page.locator('#game-form [name=description]').inputValue(), 'Resumo sintético confirmado para testar o cadastro.');
    await page.locator('#game-next').click();
    assert.match(await page.locator('#game-summary').textContent(), /60–120 min/);
    await page.locator('[name=confirmed]').check();
    await page.locator('#save-game').click();
    await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
    await page.reload();
    await page.locator('.card-main').click();
    await page.locator('#edit-game').click();
    await page.locator('#game-next').click();
    assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '60');
    assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '120');
    assert.equal(await page.locator('#game-form [name=description]').inputValue(), 'Resumo sintético confirmado para testar o cadastro.');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Desktop/celular: pesquisa → confirmação → etapa 2 → publicação → recarga preservam resumo, duração fixa/faixa, categorias e conflitos.');
} finally {
  await browser.close();
}
