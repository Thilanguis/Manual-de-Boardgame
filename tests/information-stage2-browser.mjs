import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(resolve('tests/runtime/package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const out = 'test-output/information-stage2';
await mkdir(out, { recursive: true });
const external = [],
  errors = [],
  viewports = [];
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    external.push(url.origin);
    return route.abort();
  });
  // Formulário HTML/CSS e controladores reais. Somente repositório, PDF já
  // preparado e respostas dos provedores são simulados; sem Firebase/Drive/IA.
  await context.route('**/js/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => {
    errors.push('Modal inesperado: ' + dialog.message());
    void dialog.dismiss();
  });
  await page.goto(process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186');
  await page.evaluate(async () => {
    const { createMetadataForm } = await import('/js/metadata-form.js');
    const { createResearchPanel } = await import('/js/research-panel.js');
    const { createGameSteps } = await import('/js/game-steps.js');
    const { inspectProfile, profileDefinitions } = await import('/js/profile-facts.js');
    const form = document.querySelector('#game-form'),
      dialog = document.querySelector('#upload-dialog');
    form.hidden = false;
    form.reset();
    document.querySelector('#upload-picker').hidden = true;
    const hash = 'a'.repeat(64),
      title = 'Jardins da Lua',
      english = 'Moon Gardens';
    const manualText = 'Jardins da Lua. Edição 2025. Para 2 a 8 jogadores. Construa jardins em equipe: é um jogo cooperativo. Escolha cartas para organizar os jardins e marcar pontos em conjunto.';
    const current = {
      title: 'manual_98765',
      edition: '2025',
      language: 'pt-BR',
      manual: { sha256: hash, pages: 1, name: 'Manual de teste.pdf' },
      sources: {
        language: { source: 'PDF · idioma sugerido por vocabulário; confirmar', excerpt: 'pt-BR' },
        players: { source: 'PDF · texto do manual', page: 1, excerpt: 'Para 2 a 8 jogadores.' },
        pdfOriginalMetadata: { manualHash: hash, language: 'pt-BR', fields: { minPlayers: 2, maxPlayers: 8 } },
      },
    };
    const manual = { id: 'manual', documentId: 'main', name: 'Manual de teste', sourceHash: hash, scope: 'edition-confirmed', language: 'pt-BR', pages: [{ page: 1, text: manualText }] };
    const names = [
      { value: title, language: 'pt-BR' },
      { value: english, language: 'en' },
    ];
    const publicSource = (source, id, facts, license) => ({
      id,
      profileOnly: true,
      profileEligible: true,
      profileSpecificEligible: true,
      contextManualHashes: [hash],
      scope: 'work-metadata',
      catalogSource: source,
      catalogId: 'Q9001',
      identifiers: { wikidata: 'Q9001', bgg: '1' },
      originalTitles: names,
      language: source === 'wikipedia' ? 'en' : 'pt-BR',
      url: source === 'wikipedia' ? 'https://en.wikipedia.org/w/index.php?oldid=123' : 'https://www.wikidata.org/wiki/Q9001',
      license,
      licenseUrl: source === 'wikipedia' ? 'https://creativecommons.org/licenses/by-sa/4.0/' : '',
      authorsUrl: source === 'wikipedia' ? 'https://en.wikipedia.org/w/index.php?curid=123&action=history' : '',
      facts,
    });
    const wd = publicSource('wikidata', 'wd', { title, minDurationMinutes: 30, maxDurationMinutes: 30 }, 'CC0');
    const wiki = publicSource('wikipedia', 'wiki', { title, recommendedAge: 8, description: 'Corrupt description □□□□□□□□□□□□□□□□□□□□□□□□□□□□□□□□ unreadable text □□□□□□□□□□□□□□□□□□' }, 'CC BY-SA 4.0');
    wiki.url = 'https://en.wikipedia.org/w/index.php?curid=123';
    wiki.fieldEvidence = { recommendedAge: { revision: 123, url: 'https://en.wikipedia.org/w/index.php?oldid=123', excerpt: 'Ages: 8+' } };
    const fact = (value) => ({ value, sourceId: manual.id, page: 1, quote: manualText });
    const publicFact = (value) => ({ value, sourceId: wd.id, quote: JSON.stringify(wd.facts) });
    const raw = {
      ...Object.fromEntries(Object.keys(profileDefinitions).map((key) => [key, null])),
      edition: fact('2025'),
      description: fact('Construa jardins em equipe, escolhendo cartas para organizar a paisagem e marcar pontos em conjunto.'),
      gameType: fact('Cooperativo'),
      minDurationMinutes: publicFact(30),
      maxDurationMinutes: publicFact(30),
      recommendedAge: { value: 8, sourceId: 'fonte-inexistente', quote: manualText },
    };
    const inspected = inspectProfile(raw, [manual, wd, wiki]);
    const record = {
      status: 'ready',
      analysisOrigin: 'generation',
      knowledge: {
        title,
        edition: '2025',
        sources: [manual, wd, wiki],
        profile: inspected.fields,
        fields: inspected.fields,
        profileAnalysis: { ...inspected.analysis, publicEvidenceProtocol: 1, discovery: { version: 1, status: 'confirmed', hints: [{ value: english, language: 'en', origin: 'gemini-hint' }] } },
        sections: [],
      },
    };
    const state = { current, record, calls: [], analyses: 0, model: null, conflict: false };
    const repo = {
      mode: 'firebase',
      session: { storageStatus: { profileMetadataProtocol: 2, profileDiscoveryProtocol: 1, knowledgeConfigured: true, manualAiEnabled: true } },
      findResearch: async () => null,
      research: async (source, input) => {
        state.calls.push({ source, input: structuredClone(input) });
        if (source === 'sources') return { protocol: 2, apiVersion: '1.11.0', queryStrategyVersion: 2, sources: ['wikidata', 'wikipedia', 'bgg', 'ludopedia'].map((id) => ({ id, name: id, enabled: true, url: 'https://example.test/' + id })) };
        const candidate = {
          source,
          id: source,
          identifiers: { bgg: '1', wikidata: 'Q9001' },
          names,
          kind: 'base',
          edition: '2025',
          needsDetail: false,
          language: source === 'bgg' ? 'en' : 'pt-BR',
          url: 'https://example.test/' + source,
          license: source + ' · fixture',
          fields: source === 'bgg' ? { mechanics: ['Card Drafting', 'Set Collection'], ...(state.conflict ? { recommendedAge: 10 } : {}) } : { tags: ['Familiar'] },
        };
        return { candidates: [candidate], fetchedAt: Date.now() };
      },
    };
    const metadata = createMetadataForm({
      form,
      getCurrent: () => current,
      apply(values) {
        Object.assign(current, values);
        for (const [key, value] of Object.entries(values)) {
          const input = form.elements.namedItem(key);
          if (input) input.value = Array.isArray(value) ? value.join(', ') : (value ?? '');
        }
      },
      onManualEdit(key, value) {
        current[key] = ['minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes', 'recommendedAge'].includes(key)
          ? value === ''
            ? null
            : Number(value)
          : ['tags', 'mechanics'].includes(key)
            ? value
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean)
            : value;
      },
    });
    let panel;
    panel = createResearchPanel({
      root: document.querySelector('#research-panel'),
      getCurrent: () => current,
      getRepository: () => repo,
      canUse: () => true,
      readPreference: () => 'pt-BR',
      writePreference() {},
      onConsolidated: (model) => {
        state.model = model;
        metadata.update(model);
      },
      async onPrepareDraft(options) {
        if (state.failure) {
          if (state.failure.status === 413) throw Object.assign(new Error(state.failure.message), { status: 413 });
          panel.acceptKnowledge(state.failure, current);
          return state.failure;
        }
        state.preparation = options;
        if (!state.analyses) state.analyses++;
        else record.analysisOrigin = 'local-cache';
        panel.acceptKnowledge(record, current);
        return record;
      },
    });
    const steps = createGameSteps({ form, dialog, getSession: () => ({ mode: 'local' }), getDocuments: () => [{ id: 'main', name: 'Manual de teste.pdf', manual: current.manual }] });
    form.elements.title.value = current.title;
    form.elements.edition.value = current.edition;
    document.querySelector('#draft-cover').src = '/assets/icon.svg';
    panel.reset();
    steps.show();
    dialog.showModal();
    Object.assign(state, { panel, metadata, steps });
    globalThis.stage2 = state;
  });
  await page.locator('#game-title').fill('Jardins da Lua');
  await page.locator('#game-next').click();
  await page.evaluate(() => stage2.panel.loadExisting());
  assert.equal(await page.locator('[data-step-target="2"]').getAttribute('aria-current'), 'step');
  assert.equal(await page.evaluate(() => stage2.analyses), 0, 'abrir etapa não usa IA');
  await page.locator('[data-research-search]').click();
  await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
  const first = await page.evaluate(() => ({
    values: Object.fromEntries(['title', 'description', 'minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes', 'recommendedAge', 'gameType', 'tags', 'mechanics', 'edition'].map((key) => [key, stage2.current[key]])),
    origins: Object.fromEntries([...document.querySelectorAll('[data-metadata-field]')].map((el) => [el.dataset.metadataField, el.querySelector('summary').textContent])),
    diagnostics: document.querySelector('[data-research-diagnostics]').textContent,
    extras: document.querySelector('[data-research-extras]').textContent,
    calls: stage2.calls,
    aliases: document.querySelector('[data-research-aliases]').value,
    buttons: document.querySelectorAll('[data-research-search]').length,
    unresolved: stage2.metadata.unresolved(),
  }));
  await writeFile(`${out}/first.json`, JSON.stringify(first, null, 2));
  assert.deepEqual(
    { ...first.values, description: !!first.values.description },
    {
      title: 'Jardins da Lua',
      description: true,
      minPlayers: 2,
      maxPlayers: 8,
      minDurationMinutes: 30,
      maxDurationMinutes: 30,
      recommendedAge: 8,
      gameType: 'Cooperativo',
      tags: ['Familiar'],
      mechanics: ['Seleção de cartas', 'Coleção de conjuntos'],
      edition: '2025',
    },
  );
  assert.match(first.origins.minPlayers, /Origem: PDF · texto do manual, página 1/);
  assert.match(first.origins.description, /Origem: Gemini · manual, página 1/);
  assert.match(first.origins.minDurationMinutes, /Wikidata/);
  assert.match(first.origins.minDurationMinutes, /Gemini · fontes públicas/);
  assert.match(first.origins.recommendedAge, /Wikipédia/);
  assert.match(first.origins.mechanics, /BoardGameGeek/);
  assert.match(first.origins.tags, /Ludopedia/);
  assert.match(first.origins.language, /Origem: PDF · idioma/);
  assert.equal(await page.locator('[data-metadata-field=recommendedAge] a').filter({ hasText: 'Consultar fonte' }).getAttribute('href'), 'https://en.wikipedia.org/w/index.php?oldid=123');
  assert.match(first.diagnostics, /Na ficha: 11 informações preenchidas/);
  assert.match(first.diagnostics, /Não fornecidos pelo Gemini com evidência válida/);
  assert.match(first.diagnostics, /sugestões Gemini rejeitadas/);
  assert.doesNotMatch(first.diagnostics, /Sem evidência validada:/);
  assert.match(first.extras, /ilegível.*Wikipédia/);
  assert.doesNotMatch(first.extras, /□|Textos aguardando tradução/);
  assert.doesNotMatch(await page.locator('#game-form').textContent(), /□/);
  assert.equal(first.aliases, '');
  assert(first.calls.find((call) => call.source === 'bgg').input.alternateTitles.some((name) => name.value === 'Moon Gardens' && name.origin === 'gemini-hint'));
  assert.equal(first.buttons, 1);
  assert.deepEqual(first.unresolved, []);

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 820, height: 1100 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator('.review-grid').evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({ path: `${out}/overview-${viewport.width}.png` });
    await page.locator('[name=minDurationMinutes]').scrollIntoViewIfNeeded();
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll('#upload-dialog,.review-grid')].some((el) => el.scrollWidth > el.clientWidth + 1),
      gaps: [...document.querySelectorAll('[data-metadata-field]')]
        .filter((el) => !el.closest('[data-metadata-review]'))
        .map((el) => {
          const input = el.parentElement.querySelector('input,textarea,select');
          return el.getBoundingClientRect().top - input.getBoundingClientRect().bottom;
        }),
      origins: [...document.querySelectorAll('[data-metadata-field] summary')].map((el) => el.textContent),
    }));
    assert.equal(layout.overflow, false);
    assert(layout.gaps.every((gap) => gap >= 7));
    await page.screenshot({ path: `${out}/origins-${viewport.width}.png` });
    await page.locator('[data-metadata-field=minDurationMinutes]').evaluate((el) => (el.open = true));
    await page.locator('[data-metadata-field=minDurationMinutes]').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('[data-metadata-field=minDurationMinutes] a').filter({ hasText: 'Consultar fonte' }).count(), 2, 'cada origem conserva seu link');
    await page.screenshot({ path: `${out}/sources-${viewport.width}.png` });
    await page.locator('[data-metadata-field=minDurationMinutes]').evaluate((el) => (el.open = false));
    await page.locator('[name=mechanics]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/classifications-${viewport.width}.png` });
    viewports.push({ viewport, ...layout });
  }
  const automaticBefore = Number((await page.locator('[data-metadata-review] p').first().textContent()).match(/^\d+/)[0]);
  await page.locator('[name=recommendedAge]').fill('8');
  const automaticAfter = Number((await page.locator('[data-metadata-review] p').first().textContent()).match(/^\d+/)[0]);
  assert.equal(automaticAfter, automaticBefore - 1, 'valor conferido manualmente não é contado como automático');
  await page.locator('[name=recommendedAge]').fill('9');
  await page.locator('[name=minDurationMinutes]').fill('45');
  await page.locator('[name=maxDurationMinutes]').fill('45');
  await page.evaluate(() => (stage2.conflict = true));
  await page.locator('[data-research-search]').click();
  await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
  assert.equal(await page.locator('[name=recommendedAge]').inputValue(), '9');
  assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '45');
  assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '45');
  assert.match(await page.locator('[data-metadata-field=recommendedAge] summary').textContent(), /Sua correção foi preservada/);
  assert.equal(await page.locator('.metadata-conflict').count(), 0, 'sem alerta de decisão em campo corrigido');
  assert.deepEqual(await page.evaluate(() => stage2.metadata.unresolved()), []);
  await page.evaluate(() => {
    stage2.current.sources.recommendedAge = { source: 'Conferido e ajustado por você', confirmedAt: 1 };
    stage2.current.sources.duration = { source: 'Conferido e ajustado por você', confirmedAt: 1 };
    stage2.metadata.reset();
  });
  await page.locator('[data-research-search]').click();
  await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
  assert.equal(await page.locator('[name=recommendedAge]').inputValue(), '9');
  assert.match(await page.locator('[data-metadata-field=recommendedAge] summary').textContent(), /Sua correção foi preservada/);
  assert.equal(await page.locator('.metadata-conflict').count(), 0, 'correção salva não exige decisão nova');
  // Outro campo não corrigido com divergência real deve pedir apenas uma decisão.
  await page.evaluate(() => {
    stage2.metadata.reset();
    delete stage2.current.sources.recommendedAge;
    stage2.current.recommendedAge = null;
    document.querySelector('[name=recommendedAge]').value = '';
  });
  await page.locator('[data-research-search]').click();
  await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
  assert.equal(await page.locator('[data-metadata-review] .metadata-conflict').count(), 1);
  assert.match(await page.locator('[data-metadata-review]').textContent(), /1 divergência precisa/);
  await page.getByRole('button', { name: 'Usar Idade: 8', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => stage2.metadata.unresolved()), []);
  assert.equal(await page.locator('.metadata-conflict').count(), 0);
  // Campos sem dados ficam vazios e são identificados, sem texto inventado.
  await page.evaluate(() => {
    stage2.panel.reset();
    stage2.metadata.reset();
    stage2.current.edition = '';
    document.querySelector('[name=edition]').value = '';
    stage2.record.knowledge.edition = '';
    delete stage2.record.knowledge.profile.edition;
    stage2.record.knowledge.profileAnalysis.missing.push('edition');
  });
  await page.locator('[data-research-search]').click();
  await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
  assert.equal(await page.locator('[name=edition]').inputValue(), '');
  assert.match(await page.locator('[data-consolidated-summary]').textContent(), /Ainda sem dados confirmados: Edição/);
  assert.equal(await page.evaluate(() => stage2.analyses), 1, 'proveniência e renderização não repetem análise simulada');
  // Falha de saída ou de entrada não apaga ajustes já feitos na ficha.
  await page.evaluate(() => {
    stage2.failure = {
      status: 'attention',
      reason: 'provider-output-limit',
      message: 'O Gemini atingiu o limite de saída antes de concluir a ficha e as regras. A resposta parcial não foi aplicada; os dados já encontrados foram preservados. Nenhuma repetição automática foi feita.',
      generation: { finishReason: 'MAX_TOKENS', maxOutputTokens: 16384, usage: { outputTokens: 6500 } },
    };
  });
  await page.locator('[data-research-search]').click();
  await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
  assert.match(await page.locator('[data-research-status]').textContent(), /limite de saída/);
  assert.match(await page.locator('[data-profile-diagnostic]').textContent(), /MAX_TOKENS.*16384.*6500/);
  assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '45');
  assert.equal(await page.locator('[name=maxDurationMinutes]').inputValue(), '45');
  await page.evaluate(() => {
    stage2.failure = { status: 413, message: 'Os manuais excedem o limite de 400.000 caracteres. Nenhuma geração foi iniciada; os fatos já encontrados foram preservados.' };
  });
  await page.locator('[data-research-search]').click();
  await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
  assert.match(await page.locator('[data-research-status]').textContent(), /400.000.*Nenhuma geração/);
  assert.equal(await page.locator('[data-profile-diagnostic]').count(), 0, 'erro de entrada não mostra diagnóstico antigo de saída');
  assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '45');
  assert.equal(await page.locator('[data-research-search]').count(), 1);
  await page.evaluate(() => {
    stage2.failure = {
      status: 'attention',
      analysisOrigin: 'generation',
      provider: { httpStatus: 400, status: 'INVALID_ARGUMENT' },
      message: 'O Gemini recusou o formato da ficha enviado pelo servidor (HTTP 400).',
      knowledge: structuredClone(stage2.record.knowledge),
    };
    delete stage2.failure.knowledge.profileAnalysis;
  });
  await page.locator('[data-research-search]').click();
  await page.waitForFunction(() => !document.querySelector('[data-research-search]').disabled);
  const failedDetails = await page.locator('[data-profile-diagnostic]').textContent();
  assert.match(failedDetails, /Última tentativa não concluída/);
  assert.match(failedDetails, /análise anterior foram preservados/);
  assert.match(failedDetails, /HTTP 400.*INVALID_ARGUMENT/);
  assert.doesNotMatch(failedDetails, /nova análise|Ainda sem análise Gemini completa|Análise concluída/);
  assert.equal(await page.locator('[name=minDurationMinutes]').inputValue(), '45');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await writeFile(
    `${out}/browser.json`,
    JSON.stringify({ first, viewports, errors, external, limitations: 'Dados e provedores sintéticos; não prova cobertura do Gemini/catálogos reais. Usa HTML/CSS e controladores reais, sem Firebase, Drive ou Gemini reais.' }, null, 2),
  );
  console.log('Etapa 2: 11 campos, seis origens, descoberta de nome inglês sem digitação, correções preservadas, uma revisão só quando necessária, texto corrompido descartado e três larguras sem sobreposição. Somente serviços simulados.');
} finally {
  await browser.close();
}
