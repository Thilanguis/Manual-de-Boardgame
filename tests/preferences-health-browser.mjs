import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { browserDependencies } from './browser-dependencies.mjs';
const { chromium } = browserDependencies('playwright');
const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
const markup = (await readFile('index.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('test-output/health', { recursive: true });
try {
  for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await context.route('**/__health', route => route.fulfill({ contentType: 'text/html', body: markup }));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/__health');
    await page.evaluate(async () => {
      const { createHealthPanel } = await import('/js/health-panel.js');
      document.getElementById('session-loading').hidden = true;
      document.getElementById('admin-dialog').showModal();
      document.querySelectorAll('[data-admin-section]').forEach(section => section.hidden = section.dataset.adminSection !== 'settings');
      document.getElementById('admin-health-disclosure').open = true;
      window.calls = 0;
      window.mode = 'configured';
      window.repository = {
        async diagnoseHealth() {
          calls++;
          if (mode === 'pending') return new Promise(resolve => window.finishCheck = resolve);
          if (mode === 'error') throw new Error('Não foi possível verificar a sessão na API.');
          return { checkedAt: Date.now(), firebase: { state: 'operational', verified: true, message: 'Perfil autorizado lido no Firestore.' }, drive: { state: 'operational', configured: true, verified: mode === 'ready', message: mode === 'ready' ? 'Leitura autenticada da pasta autorizada concluída. Os arquivos individuais não foram verificados.' : 'Configuração presente; operação ainda não verificada.' }, gemini: { state: 'configured', verified: false, message: 'Nenhuma chamada ao Gemini foi executada.' } };
        },
      };
      window.panel = createHealthPanel({ root: document.getElementById('admin-health'), repository });
      window.owner = { canRead: true, isOwner: true, user: { uid: 'account-a' } };
      panel.updateSession(owner);
    });
    assert.equal(await page.evaluate(() => calls), 0, 'criar o painel não consulta os serviços');
    await page.getByRole('button', { name: 'Verificar agora' }).click();
    await page.locator('#admin-health [data-health-state=unknown]').waitFor();
    assert.equal(await page.locator('#admin-health [data-health-state=operational]').count(), 1, 'configuração de Drive não vira operacional');
    assert.match(await page.locator('#admin-health').textContent(), /Configurado · não testado/);
    await page.evaluate(() => mode = 'ready');
    await page.getByRole('button', { name: 'Verificar agora' }).click();
    await page.waitForFunction(() => document.querySelectorAll('#admin-health [data-health-state=operational]').length === 2);
    assert.equal(await page.locator('#admin-dialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
    await page.screenshot({ path: `test-output/health/panel-${width}.png` });
    await page.evaluate(() => mode = 'pending');
    await page.getByRole('button', { name: 'Verificar agora' }).click();
    assert(await page.getByRole('button', { name: 'Verificar agora' }).isDisabled());
    const beforeClose = await page.evaluate(() => calls);
    await page.evaluate(() => {
      panel.updateSession({ canRead: true, isOwner: false, user: { uid: 'account-b' } });
      finishCheck({ checkedAt: Date.now(), drive: { state: 'operational', verified: true, message: 'PRIVATE-DIAGNOSTIC' } });
    });
    assert(await page.locator('#admin-health').isHidden());
    assert(!(await page.locator('#admin-health').textContent()).includes('PRIVATE-DIAGNOSTIC'));
    await page.evaluate(() => panel.check());
    assert.equal(await page.evaluate(() => calls), beforeClose);
    await page.evaluate(() => { panel.updateSession(owner); mode = 'error'; });
    await page.getByRole('button', { name: 'Verificar agora' }).click();
    await page.getByText('Não foi possível verificar a sessão na API.').waitFor();
    assert.equal(await page.locator('#admin-health [data-health-state=operational]').count(), 0, 'falha não conserva verde antigo');
    if (width === 1440) {
      const result = await page.evaluate(async () => {
        const { unlockPrivateCache, privateValue, privateCacheUnlocked, purgePrivateCaches } = await import('/js/private-cache.js');
        const prefix = 'acervo:firebase:demo-acervo:';
        localStorage.setItem(prefix + 'account-a:favorites', JSON.stringify(['game-a']));
        localStorage.setItem(prefix + 'account-b:favorites', JSON.stringify(['game-b']));
        localStorage.setItem(prefix + 'account-a:reading', JSON.stringify({ 'game-a:manual-a': { page: 7, total: 24, lastRead: 123, text: 'PRIVATE-CONTENT' } }));
        localStorage.setItem(prefix + 'account-a:reading-dismissed', JSON.stringify({ 'game-a': true }));
        localStorage.setItem('acervo-upload:demo:account-a:ticket', 'PRIVATE-CONTENT');
        localStorage.setItem(prefix + 'account-a:index', 'PRIVATE-CONTENT');
        await unlockPrivateCache('account-a', crypto.getRandomValues(new Uint8Array(32)));
        await privateValue('index:sample', { text: 'PRIVATE-CONTENT' });
        const count = async name => new Promise(resolve => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const database = request.result;
            if (!database.objectStoreNames.length) { database.close(); resolve(0); return; }
            const tx = database.transaction([...database.objectStoreNames]), counts = [...database.objectStoreNames].map(store => tx.objectStore(store).count());
            tx.oncomplete = () => { database.close(); resolve(counts.reduce((sum, request) => sum + request.result, 0)); };
          };
        });
        for (const name of ['acervo-rule-index-cache-v1', 'acervo-translations-v1', 'acervo-research-v1']) await new Promise(resolve => {
          const request = indexedDB.open(name);
          request.onupgradeneeded = () => request.result.createObjectStore('entries');
          request.onsuccess = () => {
            const database = request.result, tx = database.transaction('entries', 'readwrite');
            tx.objectStore('entries').put('PRIVATE-CONTENT', 'sample');
            tx.oncomplete = () => { database.close(); resolve(); };
          };
        });
        await purgePrivateCaches();
        return { unlocked: privateCacheUnlocked(), inaccessible: await privateValue('index:sample'), favoritesA: JSON.parse(localStorage.getItem(prefix + 'account-a:favorites')), favoritesB: JSON.parse(localStorage.getItem(prefix + 'account-b:favorites')), reading: JSON.parse(localStorage.getItem(prefix + 'account-a:reading')), dismissed: JSON.parse(localStorage.getItem(prefix + 'account-a:reading-dismissed')), privateTextLeft: Object.keys(localStorage).some(key => localStorage.getItem(key).includes('PRIVATE-CONTENT')), entries: await Promise.all(['acervo-private-v1','acervo-rule-index-cache-v1','acervo-translations-v1','acervo-research-v1'].map(count)) };
      });
      assert.deepEqual(result, { unlocked: false, inaccessible: null, favoritesA: ['game-a'], favoritesB: ['game-b'], reading: { 'game-a:manual-a': { page: 7, total: 24, lastRead: 123 } }, dismissed: { 'game-a': true }, privateTextLeft: false, entries: [0,0,0,0] });
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Saúde ${width}px: operação versus configuração, erro, revogação, deduplicação e privacidade aprovados.`);
  }
} finally { await browser.close(); }
