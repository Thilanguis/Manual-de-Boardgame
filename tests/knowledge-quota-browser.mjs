import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const reason of ['minute', 'day', 'provider']) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const knowledge = {
      fields: {},
      sources: [{ id: 'source', facts: { description: 'Conteúdo já revisado e salvo.' } }],
      sections: [{ id: 'saved', sourceId: 'source', quote: 'Conteúdo já revisado e salvo.', title: 'Regra revisada', text: 'Conteúdo já revisado e salvo.', review: 'accepted' }],
      unconfirmed: [],
    };
    const message =
      reason === 'provider' ? 'A cota gratuita da IA foi atingida. Tente novamente mais tarde.' : reason === 'day' ? 'O limite diário do Acervo foi atingido (5 gerações).' : 'Há várias gerações recentes. Aguarde um minuto antes de tentar novamente.';
    const quota = { status: 'quota', reason: reason === 'provider' ? 'provider-rate-limit' : 'app-rate-limit', retryAt: reason === 'provider' ? 0 : Date.now() + 60000, message, knowledge };
    let generations = 0;
    await context.route('**/__quota-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="knowledge"></div>' }));
    await context.route('**/health', (route) => route.fulfill({ json: { knowledgeProtocol: 1 } }));
    await context.route('**/v1/games/fixture/knowledge', (route) => {
      if (route.request().method() === 'POST') {
        generations++;
        return route.fulfill({ status: 429, json: quota });
      }
      return route.fulfill({ json: { status: 'ready', knowledge } });
    });
    const page = await context.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(`${process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186'}/__quota-fixture`);
    await page.evaluate(async () => {
      const { createKnowledgePanel } = await import('/js/knowledge-panel.js');
      const { createDriveStorage } = await import('/js/drive-storage.js');
      const storage = createDriveStorage(
        { apiBase: location.origin },
        async () => 'fixture',
        () => 'owner',
      );
      const panel = createKnowledgePanel({
        root: document.querySelector('#knowledge'),
        repository: { session: { canEdit: true, canRead: true }, getKnowledge: (game) => storage.knowledge(game), generateKnowledge: (game) => storage.knowledge(game, { force: true }) },
        onNotice: (text) => {
          window.notice = text;
        },
      });
      panel.open({ id: 'fixture' });
    });
    await page.getByRole('button', { name: 'Atualizar conhecimento com IA' }).click();
    await page.waitForFunction((text) => document.querySelector('.knowledge-status').textContent === text, message);
    assert.equal(generations, 1);
    assert.equal(await page.getByRole('button', { name: 'Atualizar conhecimento com IA' }).isDisabled(), reason !== 'provider');
    assert.equal(await page.locator('textarea').inputValue(), 'Conteúdo já revisado e salvo.');
    if (reason !== 'provider') assert.match(await page.locator('#knowledge').textContent(), /Nova tentativa disponível em/);
    assert.doesNotMatch(await page.locator('#knowledge').textContent(), /Drive não respondeu/);
    await context.close();
  }
  console.log('Chrome: limites por minuto/dia/provedor mostram mensagem persistente, preservam texto salvo e não repetem a geração.');
} finally {
  await browser.close();
}
