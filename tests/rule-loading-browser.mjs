import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { browserDependencies } from './browser-dependencies.mjs';
const { chromium } = browserDependencies('playwright');
const root = resolve('.');
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep) || !/^\/(?:index.html|js\/|styles\/|assets\/|vendor\/)/.test(pathname === '/' ? '/index.html' : pathname)) throw new Error();
    let body = await readFile(file);
    if (file.endsWith('index.html')) body = body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
  await page.goto(base);
  await page.evaluate(async () => {
    document.body.classList.add('access-approved');
    const { createGuidePanel } = await import('/js/guide-panel.js');
    const { createDocumentRepository } = await import('/js/document-repository.js');
    const { packIndex } = await import('/js/pdf-index.js');
    let game,
      guide,
      savedDraft = null,
      savedPublished = null;
    const generatedKnowledge = {
      sections: [
        {
          id: 'generated-action',
          topic: 'acoes',
          title: 'Como atacar',
          text: 'Gaste uma ação para atacar e consulte a carta.',
          sourceId: 'manual-1',
          quote: 'Para atacar, gaste uma ação.',
          review: 'unreviewed',
          page: 2,
          documentId: 'main',
          sourceHash: 'a'.repeat(64),
        },
      ],
      sources: [{ id: 'manual-1', documentId: 'main', sourceHash: 'a'.repeat(64), name: 'Manual de teste', scope: 'edition-confirmed', language: 'pt-BR', license: 'Fixture', url: '', pages: [{ page: 2, text: 'Para atacar, gaste uma ação.' }] }],
    };
    const repository = {
      mode: 'firebase',
      session: { canRead: true, canEdit: true, user: { uid: 'fixture' }, storageStatus: { fileProtocol: 2 } },
      getManual() {},
      canPrepare: () => false,
      getGuide: async (target, draft = false) => (target.id === 'knowledge' ? (draft ? savedDraft : savedPublished) : guide),
      saveGuide: async (target, draft) => (savedDraft = { ...structuredClone(draft), revision: (savedDraft?.revision || 0) + 1 }),
      publishGuide: async (target, draft) => (savedPublished = { ...structuredClone(draft), revision: (savedPublished?.revision || 0) + 1 }),
      getGuideAsset: async () =>
        packIndex({
          schemaVersion: 1,
          gameId: game.id,
          sourceHash: game.manual.sha256,
          pageCount: 1,
          headings: [{ title: 'Ataque', page: 1 }],
          pages: [{ page: 1, text: 'Ataque: para atacar, gaste uma ação e consulte os dados indicados no manual de teste.' }],
        }),
      getKnowledge: async (target) => (target.id === 'knowledge' ? { status: 'ready', knowledge: generatedKnowledge } : { status: 'pending_configuration', knowledge: null }),
    };
    Object.assign(
      repository,
      createDocumentRepository(repository, {
        db: {},
        sdk: {
          doc: (...path) => path,
          getDocFromServer: async () => {
            throw Object.assign(new Error('Denied'), { code: 'permission-denied' });
          },
        },
      }),
    );
    window.panel = createGuidePanel({ repository, openManual: () => {}, onNotice: () => {}, scope: 'isolated-browser' });
    window.openFixture = async (kind, mode = 'quick') => {
      game = { id: kind, title: kind === 'legacy' ? 'Resident Evil — fixture' : 'Takenoko — fixture', language: 'pt-BR', manual: { sha256: 'a'.repeat(64), pages: kind === 'knowledge' ? 2 : 1, name: 'manual.pdf' } };
      guide =
        kind === 'legacy'
          ? { sourceHash: game.manual.sha256, indexFileId: 'legacy-index', sections: [], assets: {} }
          : kind === 'published'
            ? { sourceHash: game.manual.sha256, sections: [{ id: 'overview', title: 'Objetivo', text: 'Cultive o jardim conforme o guia revisado de teste.', reviewed: true }], assets: {} }
            : null;
      await window.panel.open(game, mode);
    };
  });
  await page.evaluate(() => window.openFixture('legacy'));
  await page.locator('#guide-search').fill('atacar');
  await page.locator('.rule-result').first().waitFor();
  assert.match(await page.locator('#guide-content').textContent(), /gaste uma ação/);
  assert.ok(
    await page
      .locator('#guide-content')
      .getByRole('button', { name: /Ver no manual/ })
      .isVisible(),
  );
  await page.evaluate(() => window.openFixture('denied'));
  await page.locator('#guide-search').fill('atacar');
  await page.waitForFunction(() => document.getElementById('guide-content').textContent.includes('não pôde ser carregado'));
  assert.doesNotMatch(await page.locator('#guide-status').textContent(), /Sua conta|revogado/);
  assert.doesNotMatch(await page.locator('#guide-content').textContent(), /Não encontramos uma informação/);
  await page.evaluate(() => window.openFixture('empty', 'learn'));
  assert.match(await page.locator('#guide-content').textContent(), /conteúdo não pôde ser carregado/);
  assert.equal(await page.getByRole('button', { name: 'Nova seção', exact: true }).count(), 0);
  await page.evaluate(() => window.openFixture('published', 'learn'));
  assert.match(await page.locator('#guide-content').textContent(), /Cultive o jardim/);
  await page.evaluate(() => window.openFixture('knowledge'));
  await page.locator('#guide-search').fill('atacar');
  await page.locator('.rule-result').first().waitFor();
  assert.match(await page.locator('#guide-content').textContent(), /Gaste uma ação/);
  assert.ok(await page.getByRole('button', { name: 'Ver no manual · p. 2' }).isVisible());
  assert.equal(await page.getByRole('button', { name: 'Publicar guia', exact: true }).count(), 0);
  assert.match(await page.locator('#guide-content').textContent(), /Explicação por IA/);
  const automatic = await page.evaluate(async () => {
    const { createPreparationQueue } = await import('/js/preparation-queue.js');
    const game = { id: 'auto-knowledge', language: 'pt-BR', manual: { sha256: 'b'.repeat(64), pages: 1, name: 'manual.pdf' } };
    let generated = 0,
      reads = 0;
    const repository = {
      mode: 'firebase',
      session: { canRead: true, canEdit: true, user: { uid: 'fixture-generation' }, storageStatus: { manualKnowledgeProtocol: 1, manualAiEnabled: false } },
      canPrepare: () => true,
      latestGame: async () => game,
      getTechnicalIndex: async () => {
        reads++;
        return {
          schemaVersion: 1,
          gameId: game.id,
          documentId: 'main',
          sourceHash: game.manual.sha256,
          pageCount: 1,
          analysisComplete: true,
          language: 'pt-BR',
          headings: [],
          pages: [{ page: 1, text: 'Para atacar, o sobrevivente gasta uma ação e consulta a carta do cenário correspondente.' }],
        };
      },
      generateKnowledge: async () => {
        generated++;
        return { status: 'ready' };
      },
    };
    const scope = 'automatic-generation-fixture';
    let queue = createPreparationQueue(repository, { scope });
    await queue.update([game]);
    const deadline = Date.now() + 3000;
    while (queue.entries()[0]?.state !== 'ready') {
      if (Date.now() > deadline) throw new Error('Fila não terminou.');
      await new Promise((r) => setTimeout(r, 10));
    }
    if (generated !== 0) throw new Error('Geração sem consentimento.');
    repository.session.storageStatus.manualAiEnabled = true;
    await queue.update([game]);
    if (generated !== 1) throw new Error('Conhecimento não iniciou após preparo/consentimento.');
    await queue.update([game]);
    queue.destroy();
    queue = createPreparationQueue(repository, { scope });
    await queue.update([game]);
    queue.destroy();
    return { generated, reads };
  });
  assert.equal(automatic.generated, 1, 'reutiliza a geração inclusive depois de recriar a fila');
  assert.equal(automatic.reads, 1, 'não repete leitura de índice já preparado');
  assert.deepEqual(errors, []);
  console.log('Navegador: consulta única, índice legado, referência ao PDF, fontes independentes, IA sem aprovação, guia antigo legível, deduplicação após recarga e editor removido.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
