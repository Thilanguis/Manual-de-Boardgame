// Verificação externa somente de leitura. Não entra na publicação do aplicativo.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { APP_CONFIG } from '../config/app-config.js';
const require = createRequire(process.env.ACERVO_TEST_MODULES ? resolve(process.env.ACERVO_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const project = 'manual-de-boardgame',
  base = process.env.ACERVO_TEST_URL || 'https://thilanguis.github.io/Manual-de-Boardgame/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(base);
  assert.equal(response.status(), 200);
  await page.waitForFunction(() => document.getElementById('connection-status').textContent.includes('leitura pública'), { timeout: 30000 });
  assert.equal(await page.locator('#library-error').isVisible(), false);
  const authConfigStatus = await page.evaluate(async (key) => (await fetch(`https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(key)}`)).status, APP_CONFIG.firebase.apiKey);
  assert.equal(authConfigStatus, 200, 'Referenciador real do navegador autorizado na chave Firebase');
  await page.locator('#account-button').click();
  await page.locator('#google-login-button').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#login-form').isVisible(), true);
  await page.locator('#login-form [data-auth-view=register]').click();
  assert.equal(await page.locator('#register-form').isVisible(), true);
  assert.equal(await page.locator('#register-form').getAttribute('method'), 'dialog');
  await page.locator('#register-form [data-auth-view=login]').click();
  await page.locator('#login-form [data-auth-view=recovery]').click();
  assert.equal(await page.locator('#recovery-form').isVisible(), true);
  await page.locator('#recovery-form [data-auth-view=login]').click();
  await page.screenshot({ path: 'test-output/cloud-login.png', fullPage: false });
  await page.locator('[data-close=login-dialog]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-output/cloud-mobile.png', fullPage: true });
  await page.evaluate(async () => navigator.serviceWorker.ready);
  assert.deepEqual(errors, []);
  const documents = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  for (const [path, status] of [
    ['settings/library', 200],
    ['games', 200],
    ['users', 403],
    ['users/7TitBObtb8a0W8GisSstSM1RHiX2', 403],
    ['admins/7TitBObtb8a0W8GisSstSM1RHiX2', 403],
  ]) {
    const result = await fetch(`${documents}/${path}`);
    assert.equal(result.status, status, `Leitura anônima de ${path}`);
  }
  const query = await fetch(`${documents}:runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'games' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [{ fieldFilter: { field: { fieldPath: 'isPublic' }, op: 'EQUAL', value: { booleanValue: true } } }, { fieldFilter: { field: { fieldPath: 'deleting' }, op: 'EQUAL', value: { booleanValue: false } } }],
          },
        },
      },
    }),
  });
  assert.equal(query.status, 200, 'Consulta anônima limitada aos jogos publicados');
  console.log('Pages HTTPS, Firebase, PWA e formulários publicados verificados: catálogo público legível; perfis de usuários, proprietário e admins legados negados para acesso anônimo.');
} finally {
  await browser.close();
}
