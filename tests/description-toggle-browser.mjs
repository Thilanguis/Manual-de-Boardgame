import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { browserDependencies } from './browser-dependencies.mjs';

const { chromium } = browserDependencies('playwright');
const styles = await Promise.all(['styles/app.css', 'styles/interface.css'].map((file) => readFile(file, 'utf8')));
const app = await readFile('js/app.js', 'utf8');
// Executa os controles reais, sem iniciar Firebase ou carregar dados de produção.
const controls = app.slice(app.indexOf('function updateDescriptionToggle()'), app.indexOf('function updateManualStatus('));
assert.ok(controls.includes("classList.toggle('expanded')"));
const description = ('Estamos voltando para onde tudo começou. Explore a Mansão Spencer, reúna recursos e enfrente os perigos em uma campanha de mundo aberto. ').repeat(10) + 'Fim do resumo completo.';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => route.abort());
  const page = await context.newPage();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent('<main><div class="detail-content" style="width: min(580px, 90vw)"><p id="detail-description"></p><button id="detail-description-toggle" aria-expanded="false">Ver mais</button></div></main>');
    for (const content of styles) await page.addStyleTag({ content });
    await page.evaluate(({ controls, description }) => {
      document.body.classList.add('access-approved');
      document.getElementById('detail-description').textContent = description;
      new Function('$', controls)((id) => document.getElementById(id));
    }, { controls, description });
    const text = page.locator('#detail-description');
    const toggle = page.locator('#detail-description-toggle');
    const collapsed = (await text.boundingBox()).height;
    assert.ok(await toggle.isVisible(), `${width}: Ver mais disponível`);
    await toggle.click();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('detail-description')).display === 'block', null, { timeout: 2000 });
    const expanded = await text.boundingBox();
    assert.ok(expanded.height > collapsed + 20, `${width}: resumo realmente expandido`);
    assert.equal(await text.textContent(), description);
    assert.equal(await toggle.textContent(), 'Ver menos');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await toggle.click();
    assert.ok(Math.abs((await text.boundingBox()).height - collapsed) < 2);
    assert.equal(await toggle.textContent(), 'Ver mais');
    await text.evaluate((element) => { element.textContent = 'Resumo curto.'; });
    await page.waitForFunction(() => document.getElementById('detail-description-toggle').hidden);
    console.log(`${width}px: expandir/recolher, texto integral e resumo curto corretos.`);
  }
} finally {
  await browser.close();
}
