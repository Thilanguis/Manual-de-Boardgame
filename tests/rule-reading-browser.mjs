import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { browserDependencies } from './browser-dependencies.mjs';
const { chromium } = browserDependencies('playwright');
const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
const markup = (await readFile('index.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  await page.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
  await page.route('**/__reading', (route) => route.fulfill({ contentType: 'text/html', body: markup }));
  await page.goto(base + '/__reading');
  await page.evaluate(async () => {
    document.body.classList.add('access-approved');
    document.getElementById('session-loading').hidden = true;
    const { createGuidePanel } = await import('/js/guide-panel.js');
    const docs = [
      ['main', 'en', 'Manual inglês', 'a'],
      ['12345678-1234-1234-1234-123456789abc', 'fr', 'FAQ francês', 'b'],
    ].map(([id, language, name, h]) => ({ id, language, name, edition: '1', documentType: id === 'main' ? 'principal' : 'faq', manual: { sha256: h.repeat(64), pages: 1, name: name + '.pdf' } }));
    const text =
      'COMBATE\n\nPara atacar, confira sua arma.\n\n• Escolha um alvo.\n• Confira a distância.\n\n1. Declare o ataque.\n2. Resolva os dados.\n\nExceção: sem arma, não ataque.\n\nExemplo: Ana utiliza sua arma.\n\n| Ação | Custo |\n| Atacar | 1 |';
    const originals = ['ATTACK RULES\nChoose a target and check the weapon before resolving an attack.', 'COMBAT\nChoisissez une cible et vérifiez votre arme avant de résoudre une attaque.'];
    window.readingGame = { id: 'reading-fixture', title: 'Regras de teste', edition: '1', manual: docs[0].manual, documents: Object.fromEntries(docs.map((d) => [d.id, d])) };
    window.asked = 0;
    const repository = {
      session: { canRead: true, canAskRules: false, user: { uid: 'reader' } },
      getKnowledge: async () => null,
      getGuide: async () => null,
      getTechnicalIndex: async (game, d) => {
        const original = originals[docs.findIndex((doc) => doc.id === d.id)];
        return {
          schemaVersion: 1,
          gameId: game.id,
          sourceHash: d.manual.sha256,
          documentId: d.id,
          pageCount: 1,
          language: d.language,
          headings: [],
          pages: [
            {
              page: 1,
              text: original,
              searchLayout: { version: 3, text: original },
              translation: { targetLanguage: 'pt-BR', sourceText: original, text: text + (d.id === 'main' ? '\n\nTrecho do manual inglês.' : '\n\nComplemento do FAQ francês.') },
            },
          ],
        };
      },
      askRules: async () => {
        window.asked++;
        throw new Error('Leitor não pode gerar IA');
      },
    };
    window.panel = createGuidePanel({
      repository,
      openManual: (game, reference) => {
        window.opened = reference;
      },
    });
    await panel.open(readingGame);
  });
  await page.locator('#guide-search').fill('combate');
  await page.waitForFunction(() => document.querySelector('#guide-content').dataset.query === 'combate' && document.querySelectorAll('.rule-result').length === 2);
  assert.match(await page.locator('#guide-content').textContent(), /Manual inglês/);
  assert.match(await page.locator('#guide-content').textContent(), /FAQ francês/);
  const first = page.locator('.rule-result').first();
  const expansion = first.locator('details').filter({ has: page.locator('summary', { hasText: 'Ler trecho completo' }) });
  if (await expansion.count()) await expansion.locator('summary').click();
  assert.equal((await first.locator('ol').count()) > 0, true);
  assert.equal((await first.locator('ul').count()) > 0, true);
  assert.equal((await first.locator('.rule-notice').count()) > 0, true);
  assert.equal((await first.locator('.rule-example').count()) > 0, true);
  assert.equal((await first.locator('.rule-table-fallback').count()) > 0, true);
  assert.equal(await page.evaluate(() => asked), 0);
  assert.equal(await page.locator('.rule-ask').count(), 0);
  await mkdir('test-output/rule-assistant', { recursive: true });
  await page.screenshot({ path: 'test-output/rule-assistant/structured-reading.png' });
  const second = page.locator('.rule-result').nth(1);
  const doc = await second.getAttribute('data-document');
  await second.getByRole('button', { name: /Ver no manual/ }).click();
  assert.equal((await page.evaluate(() => opened)).documentId, doc);
  console.log('Leitura estruturada: listas reais, sequência, exceção, exemplo, tabela com fallback, traduções EN/FR simuladas, vários documentos e leitor sem IA.');
} finally {
  await browser.close();
}
