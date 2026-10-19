import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('tests/runtime/package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (r) => (['localhost', '127.0.0.1'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort()));
  await context.route('**/js/app.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  const page = await context.newPage();
  await page.goto(process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186');
  const result = await page.evaluate(async () => {
    const { createPreparationQueue } = await import('/js/preparation-queue.js');
    const cache = await import('/js/private-cache.js');
    cache.requirePrivateCache();
    await cache.unlockPrivateCache('prepared', crypto.getRandomValues(new Uint8Array(32)));
    const game = { id: 'saved', title: 'Jogo', language: 'pt-BR', manual: { sha256: 'a'.repeat(64), pages: 1, name: 'Manual.pdf' } };
    let generations = 0,
      reads = 0,
      analyses = 0;
    const repo = {
      session: { canRead: true, user: { uid: 'prepared' }, storageStatus: { manualKnowledgeProtocol: 1, manualAiEnabled: true } },
      canPrepare: () => true,
      latestGame: async (g) => g,
      getTechnicalIndex: async (g) => {
        reads++;
        return {
          schemaVersion: 1,
          gameId: g.id,
          documentId: 'main',
          sourceHash: g.manual.sha256,
          language: 'pt-BR',
          pageCount: 1,
          analysisComplete: true,
          headings: [],
          pages: [{ page: 1, text: 'Escolha uma carta e passe as demais para os outros jogadores. A maior pontuação vence.' }],
        };
      },
      generateKnowledge: async (g, o) => {
        if (!o.reuseOnly) throw Error('Não pode gerar');
        generations++;
        return { status: 'ready' };
      },
    };
    const make = () =>
      createPreparationQueue(repo, {
        scope: 'ready',
        analyze() {
          analyses++;
          throw Error('Não pode reanalisar');
        },
      });
    async function ready(queue) {
      const until = Date.now() + 3000;
      while (!queue.entries().every((j) => j.state === 'ready')) {
        if (Date.now() > until) throw Error('Preparação não terminou');
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    let queue = make();
    await queue.update([game], { knowledgeReady: [game] });
    await ready(queue);
    const before = { generations, reads, analyses };
    queue.destroy();
    queue = make();
    await queue.update([], { loading: true });
    await queue.update([game]);
    await new Promise((r) => setTimeout(r, 80));
    const afterReload = { generations, reads, analyses };
    const renamed = { ...game, title: 'Título corrigido' };
    await queue.update([renamed]);
    const afterRename = generations;
    const replaced = { ...renamed, manual: { ...game.manual, sha256: 'b'.repeat(64) } };
    await queue.update([replaced], { knowledgeReady: [game] });
    await ready(queue);
    const afterReplacement = generations;
    queue.destroy();
    return { before, afterReload, afterRename, afterReplacement, analyses };
  });
  assert.deepEqual(result, { before: { generations: 0, reads: 1, analyses: 0 }, afterReload: { generations: 0, reads: 1, analyses: 0 }, afterRename: 1, afterReplacement: 2, analyses: 0 });
  console.log('Fila preservada: conhecimento já vinculado não solicita adoção novamente; reload não lê índice nem reanalisa; título/hash novos invalidam somente o contexto necessário.');
} finally {
  await browser.close();
}
