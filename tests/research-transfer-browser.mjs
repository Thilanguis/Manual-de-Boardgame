import '../scripts/test-guard.mjs';
import { openGameManagement } from './game-ui-fixture.mjs';
import { enableLocalFixture } from './local-fixture.mjs';
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
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 1000 } });
    // Mantém o repositório IndexedDB real; a fixture fornece apenas a pesquisa externa.
    await context.route('**/js/local-repository.js', async (route) => {
      const response = await route.fetch();
      const source = (await response.text()).replace(
        "mode: 'local',",
        `mode: 'fixture',
        async getKnowledge(game) {
          window.savedKnowledgeReads = (window.savedKnowledgeReads || 0) + 1;
          const hash = game.manual.sha256;
          return { status: 'ready', knowledge: {
            sources: [{ id: 'manual-fixture', documentId: 'main', sourceHash: hash, pages: [{ page: 1, text: 'Troque recursos para desenvolver a ilha.' }], facts: { gameType: 'Competitivo', recommendedAge: 12 } }],
            fields: { description: { sourceId: 'manual-fixture', value: 'Descrição didática preparada a partir do manual para testar a reutilização.' }, gameType: { sourceId: 'manual-fixture', value: 'Competitivo' }, recommendedAge: { sourceId: 'manual-fixture', value: 12 } },
            sections: [{ topic: 'visao-geral', sourceId: 'manual-fixture', documentId: 'main', sourceHash: hash, page: 1, quote: 'Troque recursos para desenvolver a ilha.', text: 'Descrição didática preparada a partir do manual para testar a reutilização.' }]
          } };
        },
        async research(source) {
          if (source === 'sources') return { protocol: 2, apiVersion: 'fixture', sources: ['wikidata', 'wikipedia'].map(id => ({ id, name: id, enabled: true, url: 'https://example.org', reason: 'teste' })) };
          const { description, tags, mechanics, recommendedAge, ...other } = window.candidateFixture.fields;
          return { source, candidates: [{ ...window.candidateFixture, source,
            kind: source === 'wikipedia' ? 'base' : 'unknown',
            license: source === 'wikipedia' ? 'CC BY-SA 4.0' : 'CC0',
            fields: source === 'wikidata' ? other : { description, tags, mechanics, recommendedAge }
          }] };
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
    await enableLocalFixture(page.context());
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
    await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
    assert.equal(await page.locator('.research-card').count(), 1, 'duas fontes da mesma obra produzem uma única sugestão');
    assert.match(await page.locator('.research-card').textContent(), /Informações reunidas/);
    await page.locator('.research-card button').click();
    assert.equal(await page.locator('[data-game-step="2"]').isVisible(), true);
    assert.equal(await page.locator('#game-form [name=description]').inputValue(), 'Resumo sintético confirmado para testar o cadastro.');
    assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '75');
    assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '75');
    assert.equal(await page.locator('[name=tags]').inputValue(), 'Estratégia');
    assert.equal(await page.locator('[data-research-field], [data-research-all]').count(), 0, 'a conferência ocorre nos inputs, sem checklist paralelo');
    await page.locator('#game-form [name=description]').fill('Resumo corrigido por mim.');
    await page.locator('[name=recommendedAge]').fill('');
    // Respostas seguintes não desfazem edição ou apagamento intencional.
    await page.locator('#game-back').click();
    await page.evaluate(() => { window.candidateFixture.fields.description = 'Outro resumo disponível nas fontes públicas.'; });
    await page.locator('[data-research-search]').click();
    await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
    await page.locator('.research-card button').click();
    assert.equal(await page.locator('#game-form [name=description]').inputValue(), 'Resumo corrigido por mim.');
    assert.equal(await page.locator('[name=recommendedAge]').inputValue(), '');
    await page.locator('[name=minDurationMinutes]').fill('60');
    await page.locator('[name=maxDurationMinutes]').fill('120');
    await page.locator('#game-next').click();
    assert.match(await page.locator('#game-summary').textContent(), /60–120 min/);
    await page.locator('[name=confirmed]').check();
    await page.locator('#save-game').click();
    await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
    await page.reload();
    await page.locator('.card-main').click();
    await openGameManagement(page, 'manage-information');
    assert.match(await page.locator('#game-knowledge-admin').textContent(), /Resumo corrigido por mim/);
    await page.locator('#edit-game').click();
    await page.waitForFunction(() => document.querySelector('[name=gameType]').value === 'Competitivo');
    await page.locator('#game-next').click();
    assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '60');
    assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '120');
    assert.equal(await page.locator('#game-form [name=description]').inputValue(), 'Resumo corrigido por mim.');
    assert.equal(await page.locator('[name=recommendedAge]').inputValue(), '', 'apagamento confirmado prevalece sobre Gemini salvo');
    assert.equal(await page.evaluate(() => window.savedKnowledgeReads > 0), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: 'test-output/metadata-' + width + '.png', fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Desktop/celular: ficha única PDF/fontes/Gemini, edição e apagamentos preservados, salvamento/recarga, desktop/tablet/celular.');
} finally {
  await browser.close();
}
