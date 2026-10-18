import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' }),
    errors = [];
  await context.route('**/*', (r) => (['localhost', '127.0.0.1'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort()));
  await context.route('**/__consensus-fixture', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><link rel="stylesheet" href="/styles/app.css"><link rel="stylesheet" href="/styles/interface.css"><body class="access-approved"><form style="max-width:800px;margin:auto;padding:16px"><section data-game-step="2"><h3>Conferir informações</h3><label>Idade<input name="recommendedAge" type="number"></label><label>Mínimo<input name="minPlayers" type="number"></label><label>Máximo<input name="maxPlayers" type="number"></label></section></form></body>',
    }),
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', () => errors.push('Modal inesperado'));
  await page.goto(`${process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186'}/__consensus-fixture`);
  await page.evaluate(async () => {
    const { createMetadataForm } = await import('/js/metadata-form.js'),
      { consolidateMetadata } = await import('/js/metadata-consolidation.js');
    const form = document.querySelector('form');
    let sources = {};
    globalThis.game = { title: 'Jogo', edition: '3', manual: { sha256: 'a'.repeat(64) }, sources };
    const get = () => ({ ...game, sources, ...Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, v ? Number(v) : null])) });
    globalThis.modelForm = createMetadataForm({
      form,
      getCurrent: get,
      apply: (values, model, { automatic }) => {
        for (const [k, v] of Object.entries(values)) {
          form.elements[k].value = v;
          if (!automatic) sources[k] = { confirmedAt: Date.now() };
        }
      },
    });
    globalThis.show = (values, duplicate = false) =>
      modelForm.update(
        consolidateMetadata(
          get(),
          values.map((value, i) => ({
            source: `catalog${i}`,
            id: String(i),
            sourceFamily: duplicate && i < 3 ? 'same-origin' : `source${i}`,
            identifiers: { bgg: '1' },
            names: [{ value: 'Jogo', language: 'pt-BR' }],
            language: 'pt-BR',
            edition: '3',
            fields: { recommendedAge: value },
          })),
        ),
      );
    show([13, 14, 14, 14]);
  });
  assert.equal(await page.locator('[name=recommendedAge]').inputValue(), '14');
  assert.match(await page.locator('[data-metadata-review]').textContent(), /1 informação preenchida automaticamente/);
  assert.equal(await page.evaluate(() => modelForm.unresolved().length), 0);
  await page.evaluate(() => show([14, 14, 14, 13], true));
  assert.equal(await page.locator('[data-metadata-review]').count(), 1);
  assert.match(await page.locator('[data-metadata-review]').textContent(), /1 divergência precisa/);
  assert.equal(await page.locator('[data-metadata-review] details').count(), 1);
  await page.locator('[data-metadata-review] button').first().click();
  assert.equal(await page.evaluate(() => modelForm.unresolved().length), 0);
  await page.locator('[name=recommendedAge]').fill('12');
  await page.evaluate(() => show([14, 14, 14, 13]));
  assert.equal(await page.locator('[name=recommendedAge]').inputValue(), '12');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  assert.deepEqual(errors, []);
  console.log('Consenso 3x1 preenche; cópias geram uma revisão consolidada; escolha e correção manual preservadas; zero modais e três larguras.');
} finally {
  await browser.close();
}
