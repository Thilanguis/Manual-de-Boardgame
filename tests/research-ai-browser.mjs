import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/__research-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><form>
    <section id="research"><select data-research-language><option value="pt-BR">Português</option></select><select data-research-kind><option value="unknown">Não informado</option></select>
    <p data-research-status></p><div data-research-results></div><div data-research-review hidden></div><div data-research-sources></div>
    <button type="button" data-research-search>Pesquisar</button><button type="button" data-research-expand>Ampliar</button><button type="button" data-research-cancel>Cancelar</button></section>
    <section data-game-step="2" hidden><label>Resumo<textarea name="description"></textarea></label><label>Mínimo<input name="minPlayers"></label><label>Máximo<input name="maxPlayers"></label><label>Duração mínima<input name="minDurationMinutes"></label><label>Duração máxima<input name="maxDurationMinutes"></label></section></form>`,
    }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186'}/__research-fixture`);
  await page.evaluate(async () => {
    const { createResearchPanel } = await import('/js/research-panel.js');
    const { createMetadataForm } = await import('/js/metadata-form.js');
    const hash = 'a'.repeat(64),
      description = 'Proteja Frodo e ajude a Sociedade a enfrentar as ameaças.';
    window.currentGame = { id: 'fixture', title: 'Sina da Sociedade', language: 'pt-BR', manual: { sha256: hash, pages: 2 }, sources: { pdfOriginalMetadata: { manualHash: hash, language: 'pt-BR', fields: { minPlayers: 1, maxPlayers: 5, minDurationMinutes: 60, maxDurationMinutes: 120 } } } };
    window.knowledgeCalls = window.generationCalls = 0;
    const repository = {
      mode: 'fixture',
      async research(source, input) {
        if (window.failSource && source !== 'sources') throw new Error('Fonte indisponível no teste');
        return source === 'sources'
          ? { protocol: 2, sources: [{ id: 'wikidata', enabled: true, name: 'Wikidata', url: 'https://example.test', reason: 'teste' }] }
          : {
              candidates: [
                {
                  source: 'wikidata',
                  id: 'Q137295527',
                  identifiers: { wikidata: 'Q137295527' },
                  needsDetail: input?.action !== 'detail',
                  fields: input?.action === 'detail' ? { minDurationMinutes: 60, maxDurationMinutes: 150, maxPlayers: 5 } : { title: 'Sina da Sociedade' },
                  names: [{ value: 'Sina da Sociedade', language: 'pt-BR' }],
                  kind: 'base',
                  edition: '',
                  language: 'pt-BR',
                  license: 'CC0',
                },
              ],
            };
      },
      async getKnowledge() {
        window.knowledgeCalls++;
        return {
          knowledge: {
            sources: [{ id: 'manual-1', sourceHash: hash, pages: [{ page: 2, text: 'O objetivo é proteger Frodo.' }] }],
            fields: { description: { value: description, sourceId: 'manual-1' } },
            sections: [{ topic: 'visao-geral', text: description, sourceId: 'manual-1', sourceHash: hash, page: 2, quote: 'O objetivo é proteger Frodo.', review: 'unreviewed' }],
          },
        };
      },
      generateKnowledge() {
        window.generationCalls++;
        throw new Error('Pesquisar não pode gerar novamente');
      },
    };
    const form = document.querySelector('form');
    const current = () => ({ ...window.currentGame, ...Object.fromEntries([...form.querySelectorAll('[name]')].map((input) => [input.name, input.name === 'description' ? input.value : input.value ? Number(input.value) : null])) });
    const apply = (values) => {
      for (const [key, value] of Object.entries(values)) {
        const input = form.elements.namedItem(key);
        if (input) input.value = value;
      }
    };
    window.metadata = createMetadataForm({ form, getCurrent: current, apply });
    window.panel = createResearchPanel({
      root: document.querySelector('#research'),
      getRepository: () => repository,
      getCurrent: current,
      onConsolidated: (model) => window.metadata.update(model),
      canUse: () => true,
      readPreference: () => ({}),
      writePreference() {},
      apply(values) {
        for (const [key, value] of Object.entries(values)) {
          const input = document.querySelector(`[name="${key}"]`);
          if (input) input.value = value;
        }
      },
      onApplied() {
        document.querySelector('[data-game-step="2"]').hidden = false;
      },
    });
    window.panel.reset();
    await window.panel.run();
  });
  assert.equal(await page.locator('.research-card').count(), 1, 'PDF e IA do mesmo hash formam uma sugestão');
  await page.getByRole('button', { name: 'Conferir informações', exact: true }).click();
  assert.equal(await page.locator('[data-game-step="2"]').isVisible(), true);
  assert.equal(await page.locator('[name="description"]').inputValue(), 'Proteja Frodo e ajude a Sociedade a enfrentar as ameaças.');
  assert.equal(await page.locator('[name="minPlayers"]').inputValue(), '1');
  assert.equal(await page.locator('[name="maxPlayers"]').inputValue(), '5');
  assert.equal(await page.evaluate(() => window.generationCalls), 0);
  assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '60');
  assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '120', 'o manual tem prioridade sobre o catálogo');
  const conflict = page.locator('[data-metadata-field=maxDurationMinutes]');
  assert.equal(await conflict.locator('summary').textContent(), 'Valores diferentes · conferir');
  await conflict.evaluate((el) => { el.open = true; });
  page.once('dialog', (dialog) => dialog.accept());
  await conflict.getByRole('button', { name: /Usar Duração máxima/ }).click();
  assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '60');
  assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '150', 'troca explícita aplica a faixa da mesma fonte');
  assert.equal(await page.locator('[data-metadata-field=maxPlayers] summary').textContent(), 'Fontes concordam');
  await page.locator('[name=description]').fill('Minha correção do resumo.');
  await page.evaluate(async () => {
    window.failSource = true;
    await window.panel.run();
  });
  assert.equal(await page.locator('[name=description]').inputValue(), 'Minha correção do resumo.');
  assert.equal(await page.locator('.research-card').count(), 1, 'falha externa não bloqueia PDF/IA');
  assert.equal(await page.evaluate(() => window.generationCalls), 0);
  await page.evaluate(async () => {
    window.currentGame.manual.sha256 = 'b'.repeat(64);
    window.metadata.reset();
    window.panel.reset();
    await window.panel.run();
  });
  assert.equal(await page.locator('.research-card').count(), 0, 'outro PDF não herda sugestões da IA');
  assert.deepEqual(errors, []);
  console.log('Chrome: Sina PDF + fonte pública + Gemini salvo numa ficha; duração, concordância, edição manual e falha independente; outro hash rejeitado; zero gerações.');
} finally {
  await browser.close();
}
