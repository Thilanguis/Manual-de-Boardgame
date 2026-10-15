// Fontes e PDF sintéticos; não escreve no Firebase/Drive nem usa credenciais reais.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.ACERVO_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright'),
  { PDFDocument, StandardFonts } = require('pdf-lib');
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica),
  p = pdf.addPage([595, 842]);
pdf.setTitle('Catan édition Québec');
for (const [i, line] of ['Catan édition Québec', 'Joueurs: 2 à 4', 'Durée: 45 minutes', 'Âge: 10 ans', 'Édition: Québec 2024', 'Préparation du jeu: placez les cartes, pièces, plateau et points pour la victoire.'].entries())
  p.drawText(line, { font, size: 18, x: 35, y: 780 - i * 40 });
const bytes = Buffer.from(await pdf.save());
await mkdir('test-output', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  context = await browser.newContext({ serviceWorkers: 'block' }),
  page = await context.newPage(),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`${process.env.ACERVO_TEST_URL || 'http://localhost:4174'}/?local=1`);
  await page.waitForFunction(() => document.getElementById('connection-status').textContent.includes('Neste dispositivo'));
  await page.locator('#empty-action').click();
  await page.locator('#pdf-file').setInputFiles({ name: 'Catan-QC.pdf', mimeType: 'application/pdf', buffer: bytes });
  await page.locator('#game-form').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[name=language]').inputValue(), 'fr');
  assert.equal(await page.locator('[name=edition]').inputValue(), 'Québec 2024');
  await page.waitForFunction(() => document.querySelector('[data-research-search]').disabled === false);
  // O painel real usa serviços descartáveis para simular respostas independentes.
  await page.evaluate(async () => {
    const { createResearchPanel } = await import('./js/research-panel.js');
    const base = {
      source: 'wikidata',
      id: 'Q17271',
      url: 'https://www.wikidata.org/wiki/Q17271',
      fields: { title: 'Colonizadores de Catan', minPlayers: 3, maxPlayers: 4, durationMinutes: 75, description: 'jogo de tabuleiro' },
      names: [
        { value: 'Catan édition Québec', language: 'fr' },
        { value: 'Catan', language: 'en' },
      ],
      identifiers: { bgg: '13' },
      kind: 'unknown',
      edition: '',
      language: 'pt-br',
      descriptionLanguage: 'pt',
      license: 'CC0',
      conflicts: [],
    };
    const sources = [
      { id: 'ludopedia', name: 'Ludopedia', enabled: true, url: 'https://ludopedia.com.br', reason: 'simulada' },
      { id: 'wikidata', name: 'Wikidata', enabled: true, url: 'https://www.wikidata.org', reason: 'simulada' },
      { id: 'bgg', name: 'BoardGameGeek', enabled: false, url: 'https://boardgamegeek.com', reason: 'aguarda autorização' },
    ];
    window.researchCalls = [];
    window.delayLudo = 700;
    const repository = {
      mode: 'firebase',
      async research(source, input, { signal } = {}) {
        if (source === 'sources') return { sources, protocol: 2, apiVersion: '1.5.0' };
        window.researchCalls.push({ source, ...input });
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, source === 'ludopedia' ? window.delayLudo : 50);
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new DOMException('cancelado', 'AbortError'));
            },
            { once: true },
          );
        });
        return { source, candidates: source === 'wikidata' ? [base] : [{ ...base, source: 'ludopedia', id: '99', kind: 'expansion', fields: { title: 'Catan Expansão', minPlayers: 2, maxPlayers: 4 } }] };
      },
    };
    const getCurrent = () => {
      const v = Object.fromEntries(new FormData(document.getElementById('game-form')).entries());
      for (const k of ['minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes']) v[k] = v[k] ? Number(v[k]) : null;
      return v;
    };
    window.testPanel = createResearchPanel({
      root: document.getElementById('research-panel'),
      getRepository: () => repository,
      getCurrent,
      canUse: () => true,
      readPreference: () => '',
      writePreference: () => {},
      onApplied: () => document.querySelector('[data-step-target="2"]').click(),
      apply(values, c) {
        window.appliedSource = c.source;
        for (const [k, v] of Object.entries(values)) document.getElementById('game-form').elements.namedItem(k).value = v;
      },
    });
    window.testPanel.reset();
    void window.testPanel.run();
  });
  await page.locator('.research-card').first().waitFor();
  assert.equal(await page.locator('.research-card').count(), 1);
  assert.equal(await page.locator('#save-game').isEnabled(), true);
  assert.match(await page.locator('[data-research-status]').textContent(), /Ludopedia: consultando/);
  await page.locator('.research-card button').first().click();
  assert.equal(await page.locator('[data-research-field=minPlayers]').isChecked(), false);
  assert.equal(await page.locator('[data-research-field=minDurationMinutes]').isChecked(), false);
  assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '45');
  assert.match(await page.locator('[data-research-review]').textContent(), /edição.*Québec 2024/);
  await page.locator('[data-research-field=description]').check();
  await page.locator('[data-research-review] input[type=checkbox]').last().check();
  await page.locator('[data-research-review] button').click();
  assert.equal(await page.locator('#game-form [name=description]').inputValue(), 'jogo de tabuleiro');
  assert.equal(await page.locator('[name=minPlayers]').inputValue(), '2');
  assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '45');
  assert.equal(await page.locator('[data-game-step="2"]').isVisible(), true);
  await page.locator('#game-back').click();
  await page.waitForFunction(() => document.querySelectorAll('.research-card').length === 2);
  await page.locator('[data-research-kind]').selectOption('base');
  await page.locator('[data-research-search]').click();
  await page.waitForFunction(() => document.querySelectorAll('.research-card').length === 2);
  assert.equal(await page.locator('.research-card').filter({ hasText: 'Catan Expansão' }).locator('button').isDisabled(), true);
  await page.evaluate(() => (window.delayLudo = 6000));
  await page.locator('[data-research-expand]').click();
  await page.locator('[data-research-cancel]').click();
  assert.match(await page.locator('[data-research-status]').textContent(), /cancelada/);
  assert.equal(await page.locator('#save-game').isEnabled(), true);
  await page.evaluate(() => (window.delayLudo = 150));
  await page.locator('[data-research-language]').selectOption('en');
  await page.locator('[data-research-expand]').click();
  await page.waitForFunction(() => window.researchCalls.some((c) => c.expanded && c.preferredLanguage === 'en'));
  for (const width of [390, 820]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  await page.screenshot({ path: 'test-output/research-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PDF francês, PT-BR padrão, resultados progressivos, confirmação de campos, expansão, cancelamento e celular/tablet passaram.');
} finally {
  await context.close();
  await browser.close();
}
