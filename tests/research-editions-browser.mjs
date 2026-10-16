import '../scripts/test-guard.mjs';
import { enableLocalFixture } from './local-fixture.mjs';
// PDFs sintéticos distintos, aplicativo e IndexedDB reais; apenas o catálogo é simulado.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts } = require('pdf-lib');
const title = 'O Senhor dos Anéis: Sina da Sociedade';
const manuals = [];
for (const revision of ['A', 'B']) {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle(title);
  pdf.addPage().drawText(`${title}\nDocumento de teste ${revision}, sem regras ou dados de partida.`, { x: 30, y: 740, font, size: 15 });
  manuals.push(Buffer.from(await pdf.save()));
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 1000 } });
    await context.addInitScript(() => {
      window.researchCalls = 0;
    });
    await context.route('**/js/local-repository.js', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replace(
          "mode: 'local',",
          `mode: 'fixture', async research(source) {
        if (source === 'sources') return {protocol:2,sources:[{id:'wikidata',enabled:true}]};
        window.researchCalls++;
        return {source, fetchedAt:Date.now(), candidates:[{source:'wikidata',id:'Q137295527',identifiers:{wikidata:'Q137295527'},
          names:[{value:'O Senhor dos Anéis: Sina da Sociedade',language:'pt-BR'}], kind:'base',edition:'',language:'pt-BR',license:'CC0',
          url:'https://www.wikidata.org/wiki/Q137295527', conflicts:[], fields:{title:'O Senhor dos Anéis: Sina da Sociedade',
          description:'Descrição sintética da edição A para testar a revisão de metadados.',minPlayers:1,maxPlayers:5,durationMinutes:90,recommendedAge:14,tags:['Aventura']}}]};
      },`,
        ),
      });
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await enableLocalFixture(page.context());
    await page.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
    await page.waitForFunction(() => document.getElementById('account-label').textContent === 'Local');
    async function upload(bytes) {
      await page.locator('[data-add]').first().click();
      await page.locator('#pdf-file').setInputFiles({ name: `${title}.pdf`, mimeType: 'application/pdf', buffer: bytes });
      await page.locator('.research-card').waitFor();
      await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
    }
    async function save() {
      await page.locator('#game-next').click();
      await page.locator('[name=confirmed]').check();
      await page.locator('#save-game').click();
      await page.locator('#upload-dialog').waitFor({ state: 'hidden' });
    }
    await upload(manuals[0]);
    await page.locator('.research-card').getByRole('button', { name: 'Revisar sugestões', exact: true }).click();
    await page.locator('[data-research-all]').check();
    await page.locator('[data-research-review] input[type=checkbox]').last().check();
    await page.locator('[data-research-review] button').click();
    assert.equal(await page.locator('[name=maxPlayers]').inputValue(), '5');
    await save();
    const calls = await page.evaluate(() => window.researchCalls);
    await upload(manuals[1]);
    assert.equal(await page.evaluate(() => window.researchCalls), calls, 'a identidade geral é reaproveitada sem repetir a consulta');
    await page.locator('.research-card').getByRole('button', { name: 'Usar sugestões', exact: true }).click();
    assert.equal(await page.locator('[data-game-step="1"]').isVisible(), true, 'o atalho exige reconferência neste outro PDF');
    assert.equal(await page.locator('[data-game-step="2"]').isVisible(), false);
    assert.match(await page.locator('[data-research-review]').innerText(), /edição deste PDF ainda não foi conferida/);
    for (const field of ['description', 'minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes', 'recommendedAge', 'tags']) {
      assert.equal(await page.locator(`[data-research-field=${field}]`).isChecked(), false, `${field} não herda aprovação`);
      assert.equal(await page.locator(`#game-form [name=${field}]`).inputValue(), '', `${field} não foi aplicado`);
    }
    // Revisão parcial: aceitar só a identidade não deve aprovar o restante para este hash.
    await page.locator('[data-research-field=title]').check();
    await page.locator('[data-research-review] input[type=checkbox]').last().check();
    await page.locator('[data-research-review] button').click();
    assert.equal(await page.locator('[data-game-step="2"]').isVisible(), true);
    assert.equal(await page.locator('[name=maxPlayers]').inputValue(), '');
    assert.equal(await page.locator('#game-form [name=description]').inputValue(), '');
    await save();
    const check = await page.evaluate(async () => {
      const { createLocalRepository } = await import('./js/local-repository.js');
      const repo = await createLocalRepository();
      const games = await new Promise((resolve) => {
        const stop = repo.subscribeGames((value) => {
          stop();
          resolve(value);
        });
      });
      const db = await new Promise((resolve) => {
        const r = indexedDB.open('acervo-research-v1', 1);
        r.onsuccess = () => resolve(r.result);
      });
      const snapshots = await new Promise((resolve) => {
        const tx = db.transaction('snapshots'),
          r = tx.objectStore('snapshots').getAll();
        tx.oncomplete = () => resolve(r.result);
      });
      db.close();
      repo.close();
      return { games, snapshots };
    });
    assert.equal(check.games.length, 2);
    const gameA = check.games.find((game) => game.maxPlayers === 5),
      gameB = check.games.find((game) => game.id !== gameA.id);
    assert.notEqual(gameA.manual.sha256, gameB.manual.sha256);
    assert.equal(gameB.maxPlayers, null);
    assert.equal(gameB.description, '');
    assert.equal(check.snapshots.length, 2, 'históricos distintos não se sobrescrevem');
    const cacheA = check.snapshots.find((r) => r.data.manualHash === gameA.manual.sha256).data;
    const cacheB = check.snapshots.find((r) => r.data.manualHash === gameB.manual.sha256).data;
    assert.equal(cacheA.candidates[0].fields.maxPlayers, 5);
    assert.deepEqual(cacheB.candidates[0].fields, { title });
    assert(cacheB.decisions.every((d) => d.manualHash === gameB.manual.sha256));
    // Preferir o histórico exato, mesmo existindo um PDF homônimo com consulta mais recente.
    const isolated = await page.evaluate(
      async ({ cacheA, cacheB }) => {
        const { createResearchStore } = await import('./js/research-store.js');
        const repo = { session: { canEdit: true, user: { uid: 'edition-test' } } };
        const store = createResearchStore(repo);
        await store.saveResearch(cacheA);
        await store.saveResearch({ ...cacheB, fetchedAt: cacheA.fetchedAt + 1000 });
        const input = { query: cacheA.query, preferredLanguage: cacheA.preferredLanguage, kind: cacheA.kind, edition: cacheA.edition, manualHash: cacheA.manualHash };
        const exact = await store.findResearch(input);
        // Firestore simulado: a projeção para B não pode substituir o documento original A no cache.
        const cloudRepo = { session: { canEdit: true, user: { uid: 'cloud-edition-test' } } };
        const sdk = {
          doc: () => ({}),
          getDocFromServer: async () => ({ exists: () => true, data: () => ({ content: JSON.stringify(cacheA) }) }),
          collection: () => ({}),
          where: () => ({}),
          limit: () => ({}),
          query: () => ({}),
          getDocsFromServer: async () => ({ docs: [] }),
        };
        const cloud = createResearchStore(cloudRepo, { project: 'fixture', db: {}, auth: { currentUser: cloudRepo.session.user }, sdk });
        const projected = await cloud.findResearch({ ...input, gameId: 'game-B', manualHash: cacheB.manualHash });
        const original = await cloud.findResearch(input);
        return { exact, projected, original };
      },
      { cacheA, cacheB },
    );
    assert.equal(isolated.exact.manualHash, gameA.manual.sha256);
    assert.equal(isolated.exact.candidates[0].fields.maxPlayers, 5);
    assert.equal(isolated.projected.needsEditionReview, true);
    assert.deepEqual(isolated.projected.decisions, []);
    assert.equal(isolated.original.candidates[0].fields.maxPlayers, 5);
    assert.deepEqual(isolated.original.decisions, cacheA.decisions);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Edições/hashes distintos: revisão obrigatória, aplicação parcial, registro salvo, cache separado, preferência pelo hash exato e Firestore simulado passaram em desktop/celular.');
} finally {
  await browser.close();
}
