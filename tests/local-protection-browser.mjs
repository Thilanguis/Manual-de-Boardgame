import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { browserDependencies as require } from './browser-dependencies.mjs';
import { writeFile } from 'node:fs/promises';
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { attemptedExternal: [], sdkLoads: [], cases: [] };
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (!['127.0.0.1', 'localhost'].includes(u.hostname)) {
      report.attemptedExternal.push(u.origin + u.pathname);
      return r.abort();
    }
    if (u.pathname.startsWith('/__dev/sdk/')) report.sdkLoads.push(u.pathname);
    return r.continue();
  });
  await context.route('**/js/app.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  const p = await context.newPage();
  for (let i = 0; i < 3; i++) {
    await p.goto(process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186');

    assert.equal(await p.locator('.game-card').count(), 0);
    const config = await p.evaluate(async () => {
      const { APP_CONFIG } = await import('/config/app-config.js');
      return { project: APP_CONFIG.firebase.projectId, emulators: APP_CONFIG.emulators, development: APP_CONFIG.development };
    });
    assert.equal(config.project, 'manual-de-boardgame');
    assert.equal(config.development, undefined);
    report.cases.push(config);
  }
  const testBlocked = await p.evaluate(async () => {
    const { APP_CONFIG } = await import('/config/app-config.js');
    const { assertIsolatedConfiguration } = await import('/js/development.js');
    const meta = document.createElement('meta');
    meta.name = 'acervo-environment';
    meta.content = 'isolated';
    document.head.append(meta);
    try {
      assertIsolatedConfiguration(APP_CONFIG, location.hostname);
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(testBlocked, true);
  await context.unroute('**/js/app.js');
  await context.route(new URL('/', process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186').href, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><meta name="acervo-environment" content="isolated">') });
  });
  await p.goto(process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186');
  await p.locator('#login-error').filter({ hasText: 'bloqueada' }).waitFor();
  assert.deepEqual(report.attemptedExternal, []);
  assert.deepEqual(report.sdkLoads, []);
  console.log('Chrome: configuração manual real confirmada em três recargas sem executar Firebase; modo isolado recusa configuração real; zero SDK e conexões externas.');
} finally {
  await browser.close();
  await writeFile('test-output/firestore-fixes/local-selection-restored.json', JSON.stringify(report, null, 2));
}
