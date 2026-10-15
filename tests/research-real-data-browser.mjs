// Resposta de pesquisa simulada com os metadados públicos reais; PDF local real; só salva em perfil local descartável.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
if (!process.env.ACERVO_GAME_SNAPSHOT || !process.env.ACERVO_REAL_PDF) throw new Error('Informe ACERVO_GAME_SNAPSHOT e ACERVO_REAL_PDF. Não utiliza credenciais.');
const raw = JSON.parse((await readFile(process.env.ACERVO_GAME_SNAPSHOT, 'utf8')).replace(/^\uFEFF/, ''));
const unpack = (v) =>
  v?.mapValue
    ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, v]) => [k, unpack(v)]))
    : v?.arrayValue
      ? (v.arrayValue.values || []).map(unpack)
      : v && Object.hasOwn(v, 'nullValue')
        ? null
        : v && Object.hasOwn(v, 'integerValue')
          ? Number(v.integerValue)
          : (v?.stringValue ?? v?.booleanValue ?? v?.doubleValue);
const game = raw.documents.map((doc) => unpack({ mapValue: { fields: doc.fields } })).find((game) => game.title.includes('Texas'));
assert(game, 'Snapshot deve conter o jogo Texas');
const keys = ['title', 'description', 'minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes', 'recommendedAge', 'tags', 'mechanics', 'gameType'];
const fields = Object.fromEntries(keys.filter((key) => game[key] != null && game[key] !== '' && (!Array.isArray(game[key]) || game[key].length)).map((key) => [key, game[key]]));
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json')),
  { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 1000 } });
    await context.addInitScript((fields) => {
      window.realCandidate = {
        source: 'wikidata',
        id: 'real-manual-fixture',
        url: '',
        fields,
        names: [{ value: fields.title, language: 'unknown' }],
        kind: 'unknown',
        edition: '',
        language: 'pt-BR',
        license: 'Manual enviado · resposta simulada de teste',
        conflicts: [],
      };
    }, fields);
    await context.route('**/js/local-repository.js', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replace(
          "mode: 'local',",
          `mode:'fixture',async research(source){return source==='sources'?{protocol:2,apiVersion:'fixture',sources:[{id:'wikidata',name:'Resposta simulada',enabled:true,url:'https://www.wikidata.org',reason:'teste isolado'}]}:{source,candidates:[window.realCandidate]};},`,
        ),
      });
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
    await page.waitForFunction(() => document.getElementById('account-label').textContent === 'Local');
    await page.locator('#empty-action').click();
    await page.locator('#pdf-file').setInputFiles(process.env.ACERVO_REAL_PDF);
    await page.locator('.research-card[data-research-source=wikidata]').getByRole('button', { name: 'Revisar sugestões', exact: true }).click();
    for (const box of await page.locator('[data-research-review] input[type=checkbox]').all()) await box.check();
    await page.locator('[data-research-review] button').click();
    assert.equal(await page.locator('[data-game-step="2"]').isVisible(), true);
    for (const [key, value] of Object.entries(fields).filter(([key]) => key !== 'title')) assert.equal(await page.locator(`#game-form [name=${key}]`).inputValue(), Array.isArray(value) ? value.join(', ') : String(value), key);
    await page.locator('#game-next').click();
    await page.locator('[name=confirmed]').check();
    await page.locator('#save-game').click();
    await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
    const saved = await page.evaluate(async () => {
      const { createLocalRepository } = await import('./js/local-repository.js');
      const repo = await createLocalRepository();
      const result = await new Promise((resolve) => {
        const unsub = repo.subscribeGames((games) => {
          unsub();
          resolve(games[0]);
        });
      });
      repo.close();
      return result;
    });
    for (const [key, value] of Object.entries(fields)) assert.deepEqual(saved[key], value, `Registro salvo: ${key}`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Texas: PDF real, metadados reais em resposta simulada, todas as caixas marcadas, etapa 2 visível, inputs e registro salvo conferidos em desktop/celular.');
} finally {
  await browser.close();
}
