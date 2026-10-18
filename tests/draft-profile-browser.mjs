import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument } = require('pdf-lib');
const pdf = await PDFDocument.create();
pdf.addPage().drawText('Jogo de teste para 2 a 4 jogadores. Duracao: 30 a 60 minutos. Idade: 10 anos.', { x: 20, y: 700, size: 12 });
const bytes = Buffer.from(await pdf.save());
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let requests = 0;
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (r) => (['localhost', '127.0.0.1'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort()));
  await context.route('**/js/app.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.route('**/__draft_fixture', async (r) => {
    requests++;
    await new Promise((done) => setTimeout(done, 30));
    await r.fulfill({ json: { status: 'ready', knowledge: null } });
  });
  const page = await context.newPage();
  await page.goto(process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186');
  async function setup() {
    await page.evaluate(
      async (bytes) => {
        const cache = await import('/js/private-cache.js');
        cache.requirePrivateCache();
        await cache.unlockPrivateCache('draft-user', new Uint8Array(32).fill(7));
        const { createDraftProfile } = await import('/js/draft-profile.js');
        const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join('');
        globalThis.current = { title: 'Jogo de teste', edition: '', language: 'pt-BR', manual: { sha256: hash, pages: 1, name: 'Manual.pdf' } };
        globalThis.records = 0;
        const repository = (globalThis.repository = {
          session: { canWrite: true, cacheReady: true, user: { uid: 'draft-user' }, storageStatus: { profileMetadataProtocol: 1, knowledgeConfigured: true, manualAiEnabled: true } },
          draftKnowledge: async (input, options) => (await fetch('/__draft_fixture', { method: 'POST', body: JSON.stringify(input), signal: options.signal })).json(),
        });
        globalThis.client = createDraftProfile({
          getRepository: () => repository,
          getCurrent: () => current,
          getDocuments: () => [{ id: 'main', manual: current.manual, language: 'pt-BR', name: 'Manual', blob }],
          onRecord: () => records++,
          onIndex: () => (globalThis.indexes = (globalThis.indexes || 0) + 1),
        });
      },
      [...bytes],
    );
  }
  await setup();
  await page.evaluate(() => client.prepare({ cachedOnly: true }));
  assert.equal(requests, 0, 'abrir a tela sem cache não gera nem consulta IA');
  await page.evaluate(() => Promise.all([client.prepare(), client.prepare(), client.prepare()]));
  assert.equal(requests, 1);
  await page.evaluate(async () => {
    current.title = 'Título corrigido manualmente';
    await client.prepare();
    await client.prepare();
  });
  assert.equal(requests, 1);
  await page.reload();
  await setup();
  await page.evaluate(() => client.prepare());
  assert.equal(requests, 1, 'reload reutiliza resultado privado por UID/hash');
  assert.equal(await page.evaluate(() => records), 1);
  await page.evaluate(async () => {
    current.id = 'saved-game';
    await client.prepare();
  });
  assert.equal(requests, 1, 'edição usa conhecimento salvo, não outra geração de rascunho');
  await page.evaluate(async () => {
    delete current.id;
    repository.session.user.uid = 'another-draft-user';
    await (await import('/js/private-cache.js')).unlockPrivateCache('another-draft-user', new Uint8Array(32).fill(7));
    repository.session.storageStatus.manualAiEnabled = false;
    globalThis.indexes = 0;
    await client.prepare();
  });
  assert.equal(requests, 1, 'IA indisponível não impede análise local nem chama o provedor');
  assert.equal(await page.evaluate(() => indexes), 1);
  console.log('Rascunho: três consumidores, edição de título e reload fazem uma chamada; cache privado por versão reutilizado; jogo salvo não gera novamente.');
} finally {
  await browser.close();
}
