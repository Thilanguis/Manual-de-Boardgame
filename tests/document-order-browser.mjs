import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { browserDependencies } from './browser-dependencies.mjs';
const { chromium } = browserDependencies('playwright');
const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
const cover = await readFile('PDFs/dead by daylight sem perda 20paginas — capa.jpg');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [width, height, touch] of [
    [1440, 1100, false],
    [768, 1024, true],
    [390, 844, true],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, serviceWorkers: 'block' });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('**/*', (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
    await context.route('**/js/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await context.route('**/__fixture-cover', (route) => route.fulfill({ contentType: 'image/jpeg', body: cover }));
    await page.goto(base);
    await page.evaluate(async () => {
      document.body.classList.add('access-approved');
      document.getElementById('session-loading').hidden = true;
      const { createDocumentPanel } = await import('./js/document-panel.js');
      const main = { id: 'main', name: 'Manual principal', documentType: 'principal', language: 'pt-BR', edition: '', manual: { pages: 20, sha256: 'main' } };
      const extra = { id: 'extra', name: 'Guia de personagens', documentType: 'complemento', language: 'pt-BR', edition: '', manual: { pages: 53, sha256: 'extra' } };
      window.fixtureGame = { id: 'game', title: 'Dead by Daylight', manual: main.manual, primaryDocumentId: 'main', documents: { main, extra } };
      window.saves = [];
      window.notices = [];
      window.reads = 0;
      window.failSave = false;
      window.repository = {
        session: { canRead: true, isOwner: true, canEdit: false },
        async reorderDocuments(game, ids) {
          if (failSave) throw new Error('Falha simulada ao salvar.');
          saves.push([...ids]);
          fixtureGame = { ...game, documentOrder: [...ids] };
          return fixtureGame;
        },
      };
      window.panel = createDocumentPanel({
        root: document.getElementById('manage-documents'),
        readRoot: document.getElementById('detail-documents'),
        repository,
        queue: { entries: () => [] },
        onSaved: () => {},
        onNotice: (text) => notices.push(text),
        openManual: () => {
          reads++;
        },
      });
      document.getElementById('detail-title').textContent = 'Dead by Daylight';
      document.getElementById('detail-description').textContent = 'Um jogo de sobrevivência em que os jogadores enfrentam o Assassino e tentam escapar juntos.';
      document.getElementById('detail-cover').src = '/__fixture-cover';
      document.getElementById('detail-admin').hidden = false;
      panel.open(fixtureGame);
      document.getElementById('detail-dialog').showModal();
    });
    const ids = () => page.locator('#detail-documents .document-reading-row').evaluateAll((rows) => rows.map((row) => row.dataset.readDocumentId));
    const handle = (id) => page.locator(`.document-drag-handle[data-document-id="${id}"]`);
    await page.locator('#detail-admin').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.document-order-controls').count(), 0);
    assert.deepEqual(await ids(), ['main', 'extra']);
    const padding = await page.locator('#detail-admin').evaluate((node) => ({ left: parseFloat(getComputedStyle(node).paddingLeft), right: parseFloat(getComputedStyle(node).paddingRight) }));
    assert(padding.left >= 16 && padding.right >= 16, 'Gerenciar jogo tem espaço dos dois lados');
    assert(await page.locator('#detail-dialog').evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
    await page.screenshot({ path: `test-output/document-order-${width}.png` });
    if (width === 1440) {
      const section = await page.locator('#detail-documents-disclosure').boundingBox(),
        admin = await page.locator('#detail-admin').boundingBox();
      await page.screenshot({ path: 'test-output/document-order-detail.png', clip: { x: section.x - 12, y: section.y - 8, width: section.width + 24, height: admin.y + admin.height - section.y + 20 } });
    }
    // Teclado: cancela e confirma sem botões visíveis de subir/descer.
    await handle('main').focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    assert.deepEqual(await ids(), ['main', 'extra']);
    assert.equal(await page.evaluate(() => saves.length), 0);
    await page.keyboard.press('Space');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => saves.length === 1);
    assert.deepEqual(await ids(), ['extra', 'main']);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.documentId), 'main');
    // Mouse: arrasta de baixo para cima, sem depender do drag nativo de HTML.
    await handle('main').scrollIntoViewIfNeeded();
    let start = await handle('main').boundingBox(),
      target = await handle('extra').boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2 - 18, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(() => saves.length === 2);
    assert.deepEqual(await ids(), ['main', 'extra']);
    start = await handle('main').boundingBox();
    target = await handle('extra').boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2 + 18, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(await page.locator('#detail-dialog').evaluate((node) => node.open), true);
    assert.equal(await page.evaluate(() => saves.length), 2);
    assert.deepEqual(await ids(), ['main', 'extra']);
    if (touch) {
      // CDP produz eventos reais de toque e também testa cancelamento do gesto.
      const cdp = await context.newCDPSession(page);
      const dragTouch = async (cancel) => {
        await handle('main').scrollIntoViewIfNeeded();
        const start = await handle('main').boundingBox(),
          target = await handle('extra').boundingBox();
        const x = start.x + start.width / 2,
          y = start.y + start.height / 2;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let step = 1; step <= 10; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + ((target.y + target.height / 2 + 18 - y) * step) / 10 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
      };
      await dragTouch(true);
      assert.deepEqual(await ids(), ['main', 'extra']);
      assert.equal(await page.evaluate(() => saves.length), 2);
      await dragTouch(false);
      await page.waitForFunction(() => saves.length === 3);
      assert.deepEqual(await ids(), ['extra', 'main']);
    }
    // Falha não deixa a tela mostrando uma ordem que não foi gravada.
    const before = await ids(),
      saved = await page.evaluate(() => saves.length);
    await page.evaluate(() => {
      failSave = true;
    });
    await handle(before[0]).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => notices.includes('Falha simulada ao salvar.'));
    assert.deepEqual(await ids(), before);
    assert.equal(await page.evaluate(() => saves.length), saved);
    if (width === 390) {
      await page.evaluate(() => {
        failSave = false;
        const original = fixtureGame.documents.extra;
        for (let number = 2; number <= 8; number++) fixtureGame.documents['extra' + number] = { ...original, id: 'extra' + number, name: `Documento ${number}: referências e orientações complementares para os personagens` };
        panel.open(fixtureGame);
      });
      const first = (await ids())[0];
      await handle(first).scrollIntoViewIfNeeded();
      const start = await handle(first).boundingBox();
      const scrollBefore = await page.locator('#detail-dialog .detail-layout').evaluate((node) => node.scrollTop);
      const countBefore = await page.evaluate(() => saves.length);
      const cdp = await context.newCDPSession(page);
      const x = start.x + start.width / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start.y + start.height / 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: height - 45 }] });
      await page.evaluate(() => panel.refresh());
      await page.waitForFunction((before) => document.querySelector('#detail-dialog .detail-layout').scrollTop > before + 70, scrollBefore);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction((before) => saves.length === before + 1, countBefore);
      assert((await ids()).indexOf(first) > 1, 'arraste acompanha a rolagem e atravessa linhas de alturas diferentes');
    }
    // As consultas pendentes e os snapshots reais também chegam durante o gesto.
    // O fixture simples de ordenação não reproduzia essas atualizações assíncronas.
    await page.evaluate(() => {
      repository.session.canEdit = true;
      failSave = false;
      const original = fixtureGame.documents.extra;
      fixtureGame = { ...fixtureGame, documents: { main: fixtureGame.documents.main, extra: original, third: { ...original, id: 'third', name: 'Guia de dúvidas clássicas' } }, documentOrder: ['main', 'extra', 'third'] };
      repository.pendingDocumentLinks = () => new Promise(resolve => { window.finishPendingLinks = resolve; });
      panel.open(fixtureGame);
    });
    await handle('extra').scrollIntoViewIfNeeded();
    const delayedStart = await handle('extra').boundingBox(),
      delayedTarget = await handle('main').boundingBox(),
      savesBeforeRefresh = await page.evaluate(() => saves.length);
    await page.mouse.move(delayedStart.x + delayedStart.width / 2, delayedStart.y + delayedStart.height / 2);
    await page.mouse.down();
    await page.mouse.move(delayedTarget.x + delayedTarget.width / 2, delayedTarget.y + delayedTarget.height / 2 - 18, { steps: 10 });
    await page.evaluate(async () => {
      finishPendingLinks([]);
      await new Promise(requestAnimationFrame);
    });
    assert.equal(await page.locator('.document-reading-row.is-dragging').count(), 1, 'consulta pendente não cancela o arraste');
    await page.evaluate(() => panel.open({ ...fixtureGame }));
    assert.equal(await page.locator('.document-reading-row.is-dragging').count(), 1, 'snapshot do mesmo cadastro não cancela o arraste');
    await page.mouse.up();
    await page.waitForFunction(count => saves.length === count + 1, savesBeforeRefresh);
    assert.deepEqual(await ids(), ['extra', 'main', 'third']);
    await page.evaluate(() => {
      repository.session.canEdit = false;
      delete repository.pendingDocumentLinks;
      panel.open(fixtureGame);
    });
    assert.deepEqual(await ids(), ['extra', 'main', 'third'], 'a ordem persiste após reabrir o cadastro');
    // Uma mudança real feita em outra sessão deve cancelar, sem sobrescrevê-la.
    await handle('main').scrollIntoViewIfNeeded();
    const conflictStart = await handle('main').boundingBox(),
      conflictTarget = await handle('extra').boundingBox(),
      savesBeforeConflict = await page.evaluate(() => saves.length);
    await page.mouse.move(conflictStart.x + conflictStart.width / 2, conflictStart.y + conflictStart.height / 2);
    await page.mouse.down();
    await page.mouse.move(conflictTarget.x + conflictTarget.width / 2, conflictTarget.y + conflictTarget.height / 2 - 18, { steps: 8 });
    await page.evaluate(() => {
      fixtureGame = { ...fixtureGame, documentOrder: ['third', 'main', 'extra'] };
      panel.open(fixtureGame);
    });
    await page.mouse.up();
    assert.deepEqual(await ids(), ['third', 'main', 'extra']);
    assert.equal(await page.evaluate(() => saves.length), savesBeforeConflict);
    assert(await page.evaluate(() => notices.some(text => text.includes('A lista de PDFs mudou em outra sessão'))));
    await page.evaluate(() => {
      repository.session.isOwner = false;
      panel.open(fixtureGame);
    });
    assert.equal(await page.locator('.document-drag-handle').count(), 0);
    assert.deepEqual(await ids(), await page.evaluate(() => fixtureGame.documentOrder));
    await page.locator('#detail-documents .button').first().click();
    assert.equal(await page.evaluate(() => reads), 1);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Ordenação ${width}px: alça, mouse, teclado${touch ? ', toque e cancelamento' : ''}, falha, permissões e espaçamento aprovados.`);
  }
} finally {
  await browser.close();
}
