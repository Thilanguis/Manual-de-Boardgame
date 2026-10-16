import '../scripts/test-guard.mjs';
import { enableLocalFixture } from './local-fixture.mjs';
// Tradutor real do Chrome; somente frases sintéticas, sem enviar documentos.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block', locale: 'pt-BR' }),
    page = await context.newPage();
  await enableLocalFixture(page.context());
  await page.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
  await page.evaluate(async () => {
    const { createTextTranslator } = await import('./js/translation.js');
    const button = document.createElement('button');
    button.id = 'native-translation-test';
    button.textContent = 'Teste local';
    document.body.append(button);
    button.onclick = async () => {
      window.nativeTranslation = { state: 'preparing' };
      try {
        const service = createTextTranslator({ scope: 'synthetic-native-test' });
        const language = window.nativeSource;
        await service.prepare(language, { allowDownload: true, onProgress: (progress) => (window.nativeTranslation = { state: 'preparing', progress }) });
        const result = await service.translate(language === 'en' ? 'Move the survivor to the hallway. Each turn allows two actions.' : 'Déplacez le survivant dans le couloir. Chaque tour permet deux actions.', { sourceLanguage: language });
        window.nativeTranslation = { state: 'done', result };
        service.destroy();
      } catch (error) {
        window.nativeTranslation = { state: 'unavailable', error: error.message };
      }
    };
  });
  for (const language of ['en', 'fr']) {
    await page.evaluate((source) => (window.nativeSource = source), language);
    await page.locator('#native-translation-test').click();
    await page.waitForFunction(() => ['done', 'unavailable'].includes(window.nativeTranslation?.state), null, { timeout: 180000 }).catch(() => {});
    console.log(JSON.stringify({ language, ...(await page.evaluate(() => window.nativeTranslation)) }));
  }
} finally {
  await browser.close();
}
