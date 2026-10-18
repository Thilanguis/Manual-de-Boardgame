import { consolidateMetadata, storedCatalogCandidates } from './metadata-consolidation.js';
import { consolidateCandidates, researchSnapshot } from './research-knowledge.js';
import { parallelResearch, normalizedQuery, sourceNames, manualSources, selectedFields, fieldLabels, researchSummary } from './research-client.js';
import { RESEARCH_PROTOCOL, RESEARCH_VERSION } from './research-contract.js';
import { recognizePdfImages } from './pdf-ocr.js';
import { resultSummary } from './research-presentation.js';
import { createTextTranslator } from './translation.js';
import { portugueseCandidate, translateCatalogCandidate, pdfMetadataCandidate } from './catalog-language.js';
import { savedKnowledgeCandidate } from './research-enrichment.js';

const node = (tag, text = '') => {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
};
const link = (label, url) => {
  const el = node('a', label);
  el.href = url;
  el.target = '_blank';
  el.rel = 'noopener noreferrer';
  return el;
};
const display = (value) => (Array.isArray(value) ? value.join(', ') : String(value ?? 'não informado'));
const disclosure = (title) => {
  const details = node('details');
  details.append(node('summary', title));
  return details;
};
export function createResearchPanel({
  root,
  getRepository,
  getCurrent,
  getPdf,
  canUse,
  readPreference,
  writePreference,
  onApplied = () => document.querySelector('[data-step-target="2"]')?.click(),
  onSuggestions = () => {},
  onConsolidated = () => {},
  onOcrPage = () => {},
}) {
  let controller,
    detailController,
    sequence = 0,
    sources = [],
    candidates = [],
    statuses = new Map(),
    active = false;
  let chosenIdentity = null;
  const pendingDetails = new Map();
  let sourcesUntil = 0;
  let detailActive = false;
  let ocrController,
    ocrActive = false,
    ocrCandidate = null,
    sourceFailure = '';
  let snapshot = null,
    queryInput = null,
    decisions = [];
  const aliasesInput = root.querySelector('[data-research-aliases]');
  const appliedCandidates = new Set();
  const candidateKey = (candidate) => `${candidate.source}:${candidate.id}`;
  function notifySuggestions() {
    onSuggestions(consolidateCandidates([...(ocrCandidate ? [ocrCandidate] : []), ...candidates].filter((candidate) => !appliedCandidates.has(candidateKey(candidate)))).length);
  }
  const language = root.querySelector('[data-research-language]'),
    kind = root.querySelector('[data-research-kind]'),
    status = root.querySelector('[data-research-status]'),
    list = root.querySelector('[data-research-results]'),
    review = root.querySelector('[data-research-review]'),
    sourceList = root.querySelector('[data-research-sources]');
  const search = root.querySelector('[data-research-search]'),
    expand = root.querySelector('[data-research-expand]'),
    cancel = root.querySelector('[data-research-cancel]');
  const ocrButton = root.querySelector('[data-research-ocr]'),
    ocrStatus = root.querySelector('[data-research-ocr-status]');
  function cancelWork(message = '') {
    ++sequence;
    controller?.abort();
    detailController?.abort();
    ocrController?.abort();
    if (ocrActive && ocrStatus) ocrStatus.textContent = 'Leitura do PDF cancelada.';
    if (ocrButton) ocrButton.disabled = false;
    ocrActive = false;
    detailActive = false;
    active = false;
    cancel.hidden = true;
    search.disabled = expand.disabled = false;
    search.removeAttribute('aria-busy');
    if (message) status.textContent = message;
  }
  function reset() {
    cancelWork();
    candidates = [];
    sourceFailure = '';
    chosenIdentity = null;
    pendingDetails.clear();
    onConsolidated(null);
    snapshot = queryInput = null;
    decisions = [];
    if (aliasesInput) aliasesInput.value = '';
    const refresh = root.querySelector('[data-research-refresh]');
    if (refresh) refresh.checked = false;
    statuses = new Map();
    ocrCandidate = null;
    appliedCandidates.clear();
    notifySuggestions();
    if (ocrStatus) ocrStatus.textContent = '';
    list.replaceChildren();
    review.replaceChildren();
    review.hidden = true;
    const preference = readPreference();
    language.value = ['pt-BR', 'en', 'fr'].includes(preference) ? preference : 'pt-BR';
    kind.value = 'unknown';
    status.textContent = 'Pesquise para completar os dados do manual.';
  }
  async function loadSources(signal) {
    if (getRepository().mode === 'local') {
      sources = [];
      sourceFailure = 'A pesquisa externa está disponível na biblioteca compartilhada. Você pode continuar com o PDF.';
      sourcesUntil = 0;
      return;
    }
    if (sourcesUntil > Date.now()) return;
    try {
      const response = await getRepository().research('sources', null, { signal, timeoutMs: 1500 });
      if (signal?.aborted) return;
      if (response.protocol !== RESEARCH_PROTOCOL) throw new Error(`API incompatível com o site ${RESEARCH_VERSION}. Atualize o Worker e o site; nenhuma consulta completa foi realizada.`);
      const version = root.querySelector('[data-research-version]');
      if (version) version.textContent = `Site ${RESEARCH_VERSION} · API ${response.apiVersion} · protocolo compatível`;
      sources = response.sources;
      sourceFailure = '';
      sourcesUntil = Date.now() + 60000;
    } catch (error) {
      if (signal?.aborted) return;
      sources = [];
      sourceFailure = getRepository().mode === 'local' ? 'Modo local: conectores externos exigem o acervo conectado e uma conta autorizada.' : 'Fontes externas não consultadas: ' + error.message;
      if (!signal?.aborted) status.textContent = getRepository().mode === 'local' ? 'Neste dispositivo, a identificação usa o PDF. Fontes externas ficam disponíveis no acervo conectado.' : `Fontes externas indisponíveis: ${error.message}`;
    }
    if (signal?.aborted) return;
    sourceList.replaceChildren();
    for (const source of sources) {
      const p = node('p');
      const runtime = statuses.get(source.id);
      p.append(
        link(source.name, source.url),
        document.createTextNode(
          ` · ${!source.enabled ? 'exige credenciais/configuração' : runtime?.status === 'error' ? 'falhou' : runtime?.status === 'done' ? 'respondeu' : 'habilitada; disponibilidade será testada na consulta'} · ${source.reason}`,
        ),
      );
      if (source.id === 'bgg' && source.enabled && source.logo) {
        const a = link('', source.url),
          img = document.createElement('img');
        img.src = source.logo;
        img.alt = 'Powered by BGG';
        img.width = 150;
        a.append(img);
        p.append(a);
      }
      sourceList.append(p);
    }
    for (const [name, url] of manualSources) {
      const p = node('p');
      p.append(link(`${name} ↗`, url), document.createTextNode(' · consulta manual; integração e reutilização ainda não autorizadas'));
      sourceList.append(p);
    }
  }
  function render() {
    notifySuggestions();
    const availability = root.querySelector('[data-research-availability]');
    if (availability) {
      availability.replaceChildren();
      for (const source of sources) {
        const row = node('p'),
          runtime = statuses.get(source.id);
        row.textContent = `${sourceNames[source.id] || source.name}: ${!source.enabled ? 'não consultada — exige credenciais/configuração' : runtime?.status === 'error' ? 'falhou — ' + runtime.error : runtime?.status === 'loading' ? 'consultando…' : runtime?.status === 'done' ? (runtime.diagnostics?.complete === false ? 'resposta parcial; houve falhas' : runtime.candidates?.length ? 'respondeu — ' + runtime.candidates.length + ' resultado(s)' : 'respondeu — nenhum resultado') : 'habilitada, ainda não consultada'}`;
        availability.append(row);
      }
    }
    list.replaceChildren();
    const all = [...(ocrCandidate ? [ocrCandidate] : []), ...candidates];
    const model = consolidateMetadata({ ...getCurrent(), kind: kind.value }, all, chosenIdentity);
    onConsolidated(model);
    for (const member of model.members.filter((m) => m.needsDetail)) void enrichDetail(member);
    const results = model.members.length ? [model] : [];
    if (model.members.length) {
      const card = node('article');
      card.className = 'research-card';
      card.append(node('h4', 'Informações reunidas'), node('p', Object.keys(model.fields).length + ' campos disponíveis. Confira e ajuste na etapa 2.'));
      const action = node('button', 'Conferir informações');
      action.type = 'button';
      action.className = 'button secondary small';
      action.onclick = () => onApplied({});
      card.append(action);
      if (model.pendingTranslations.length) {
        const details = disclosure('Textos aguardando tradução');
        for (const pending of model.pendingTranslations) details.append(node('p', fieldLabels[pending.key] + ' · ' + pending.language + ': ' + display(pending.value)));
        if (globalThis.Translator) {
          const translate = node('button', 'Traduzir para português');
          translate.type = 'button';
          translate.onclick = () => void translateSuggestion({ members: model.members });
          details.append(translate);
        }
        card.append(details);
      }
      list.append(card);
    }
    if (model.ambiguous.length) {
      const options = disclosure('Conferir qual jogo corresponde ao PDF');
      for (const group of model.ambiguous) {
        const action = node('button', (group.fields.title || group.names[0]?.value) + ' · ' + (group.edition || 'edição não confirmada'));
        action.type = 'button';
        action.className = 'button secondary small';
        action.onclick = () => void select(group);
        options.append(action);
      }
      list.append(options);
    }
    const diagnostics = root.querySelector('[data-research-diagnostics]');
    if (diagnostics) diagnostics.textContent = sourceFailure || researchSummary(sources, statuses);
    status.textContent = sourceFailure
      ? results.length
        ? 'Sugestões disponíveis. Não foi possível consultar as fontes externas.'
        : getRepository().mode === 'local'
          ? sourceFailure
          : 'Não foi possível pesquisar agora. Tente novamente.'
      : resultSummary(results, sources, statuses);
  }
  async function loadSavedKnowledge(current, signal, n) {
    if (!current.id || !current.manual?.sha256 || !getRepository().getKnowledge) return;
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(1500)]);
    let abort;
    try {
      const record = await Promise.race([
        getRepository().getKnowledge(current),
        new Promise((resolve) => {
          abort = () => resolve(null);
          if (timeout.aborted) abort();
          else timeout.addEventListener('abort', abort, { once: true });
        }),
      ]);
      if (timeout.aborted || n !== sequence) return;
      const suggestion = savedKnowledgeCandidate(record, current);
      if (suggestion) {
        candidates.push(suggestion);
        render();
      }
    } catch (error) {
      if (!timeout.aborted && n === sequence) statuses.set('gemini', { status: 'error', error: error.message });
    } finally {
      if (abort) timeout.removeEventListener('abort', abort);
    }
  }
  async function enrichDetail(member) {
    const key = member.source + ':' + member.id;
    if (pendingDetails.has(key)) return pendingDetails.get(key);
    const n = sequence;
    const signal = AbortSignal.any([controller?.signal || new AbortController().signal, AbortSignal.timeout(2500)]);
    const task = (async () => {
      try {
        const current = getCurrent();
        const result = await getRepository().research(member.source, { action: 'detail', id: member.id, query: current.title, pdfLanguage: current.language, preferredLanguage: 'pt-BR', kind: kind.value }, { signal, timeoutMs: 2500 });
        if (n !== sequence || signal.aborted || !canUse()) return;
        const detail = result.candidates?.find((c) => c.id === member.id);
        if (detail) {
          updateCandidate({ ...detail, names: [...member.names, ...(detail.names || [])], fetchedAt: result.fetchedAt || Date.now(), needsDetail: false });
          render();
        }
      } catch (error) {
        if (n === sequence) {
          statuses.set(member.source, { status: 'error', error: 'Não foi possível completar os dados desta fonte.' });
        }
      }
    })();
    pendingDetails.set(key, task);
    return task;
  }
  async function loadExisting() {
    const current = getCurrent();
    if (!current || !canUse()) return;
    cancelWork();
    chosenIdentity = null;
    const n = sequence;
    controller = new AbortController();
    const signal = controller.signal;
    candidates = storedCatalogCandidates(current);
    ocrCandidate = pdfMetadataCandidate(current);
    render();
    const input = { query: normalizedQuery(current.title), manualHash: current.manual?.sha256 || '', edition: current.edition || '', kind: 'unknown', preferredLanguage: 'pt-BR' };
    await Promise.allSettled([
      loadSavedKnowledge(current, signal, n),
      (async () => {
        const cached = await getRepository().findResearch?.(input, { signal: AbortSignal.timeout(1500) });
        if (n !== sequence || !canUse()) return;
        for (const candidate of cached?.candidates || []) if (!candidates.some((c) => c.source === candidate.source && c.id === candidate.id)) candidates.push(candidate);
        render();
      })(),
    ]);
  }
  function updateCandidate(next) {
    candidates = candidates.map((c) => (c.source === next.source && c.id === next.id ? next : c));
    if (ocrCandidate?.source === next.source && ocrCandidate?.id === next.id) ocrCandidate = next;
  }
  async function translateSuggestion(candidate) {
    if (!canUse()) return;
    detailController?.abort();
    detailController = new AbortController();
    const control = detailController,
      n = sequence;
    detailActive = true;
    cancel.hidden = false;
    const current = getCurrent();
    const translator = createTextTranslator({ scope: `${getRepository().session?.user?.uid || 'device'}:${current.manual?.sha256 || 'catalog'}` });
    try {
      const members = candidate.members || [candidate];
      const languages = [...new Set(members.flatMap((m) => portugueseCandidate(m).pendingTranslations.map((f) => f.language)))];
      // Preparação começa no clique, sem enviar conteúdo a APIs remotas.
      await Promise.all(
        languages.map((language) =>
          translator.prepare(language, {
            allowDownload: true,
            signal: control.signal,
            onProgress: (text) => {
              if (n === sequence) status.textContent = text;
            },
          }),
        ),
      );
      for (const member of members) {
        const next = await translateCatalogCandidate(member, translator, {
          signal: control.signal,
          onProgress: (text) => {
            if (n === sequence) status.textContent = text;
          },
        });
        if (n !== sequence || control.signal.aborted) return;
        updateCandidate(next);
      }
      render();
      status.textContent = 'Tradução pronta. Revise as sugestões antes de usar.';
      if (queryInput) snapshot = researchSnapshot(queryInput, candidates, decisions);
    } catch (error) {
      if (n === sequence && !control.signal.aborted) status.textContent = error.message;
    } finally {
      translator.destroy();
      if (control === detailController) {
        detailActive = false;
        cancel.hidden = !active;
      }
    }
  }
  async function run(expanded = false) {
    const current = getCurrent();
    if (!current || !canUse()) return;
    cancelWork();
    const n = ++sequence;
    controller = new AbortController();
    const signal = controller.signal;
    candidates = [];
    pendingDetails.clear();
    if (ocrCandidate?.manualHash !== current.manual?.sha256 || ocrCandidate?.pdfMethod === 'text') ocrCandidate = null;
    const extracted = pdfMetadataCandidate(current);
    if (extracted) ocrCandidate = extracted;
    appliedCandidates.clear();
    notifySuggestions();
    statuses.clear();
    review.hidden = true;
    list.replaceChildren();
    active = true;
    cancel.hidden = false;
    search.disabled = expand.disabled = true;
    search.setAttribute('aria-busy', 'true');
    status.textContent = 'Pesquisando…';
    const budget = AbortSignal.any([signal, AbortSignal.timeout(expanded ? 10000 : 7000)]);
    const knowledgeTask = loadSavedKnowledge(current, budget, n);
    try {
      const input = { action: 'search', query: normalizedQuery(current.title), pdfLanguage: current.language, preferredLanguage: language.value, kind: kind.value, expanded, fetchedAt: Date.now() };
      input.alternateTitles = current.sources?.originalTitle ? [{ value: current.sources.originalTitle.excerpt, language: 'other' }] : [];
      input.edition = current.edition || '';
      input.publisher = current.sources?.publisher?.excerpt || '';
      input.year = current.sources?.year?.excerpt || '';
      input.gameId = current.id || '';
      input.manualHash = current.manual?.sha256 || '';
      input.alternateTitles.push(...(current.sources?.catalog?.matches || []).flatMap((match) => match.names || []));
      input.alternateTitles.push(
        ...String(aliasesInput?.value || '')
          .split('\n')
          .map((line) => {
            const match = line.trim().match(/^(?:(pt-BR|pt|en|fr):\s*)?(.{2,160})$/i);
            return match ? { value: match[2], language: /^pt/i.test(match[1] || '') ? 'pt-BR' : (match[1] || 'other').toLowerCase(), origin: 'pista informada pelo administrador' } : null;
          })
          .filter(Boolean),
      );
      input.alternateTitles = input.alternateTitles.filter((name, i, all) => all.findIndex((n) => n.value === name.value && n.language === name.language) === i).slice(0, 6);
      queryInput = input;
      const cacheSignal = AbortSignal.any([budget, AbortSignal.timeout(1200)]);
      const cached =
        !expanded &&
        !root.querySelector('[data-research-refresh]')?.checked &&
        (await Promise.race([
          getRepository().findResearch?.(input, { signal: cacheSignal }),
          new Promise((resolve) => {
            if (cacheSignal.aborted) resolve(null);
            else cacheSignal.addEventListener('abort', () => resolve(null), { once: true });
          }),
        ]));
      if (signal.aborted || n !== sequence) return;
      if (cached) {
        queryInput = { ...input, fetchedAt: cached.fetchedAt };
        snapshot = cached;
        candidates = [...candidates.filter((candidate) => candidate.source === 'gemini'), ...cached.candidates];
        decisions = (cached.decisions || []).map((decision) => ({ ...decision, manualHash: decision.manualHash ?? cached.manualHash, edition: decision.edition ?? cached.edition }));
        await knowledgeTask;
        if (signal.aborted || n !== sequence) return;
        render();
        status.textContent = `Informações recuperadas · ${new Date(cached.fetchedAt).toLocaleDateString('pt-BR')}.`;
        return;
      }
      await loadSources(budget);
      if (signal.aborted || n !== sequence) return;
      if (input.query.length < 2) {
        status.textContent = 'Informe o nome do jogo para pesquisar.';
        return;
      }
      const collect = (update) => {
        if (n !== sequence || signal.aborted) return;
        statuses.set(update.source, update);
        if (update.candidates)
          for (const candidate of update.candidates) {
            const stamped = { ...candidate, fetchedAt: update.fetchedAt || Date.now() };
            const at = candidates.findIndex((c) => c.source === candidate.source && c.id === candidate.id);
            if (at < 0) candidates.push(stamped);
            else if (!(stamped.needsDetail && candidates[at].needsDetail === false)) candidates[at] = stamped;
          }
        render();
      };
      await parallelResearch(sources, input, (source, query, options) => getRepository().research(source, query, options), {
        signal: budget,
        onUpdate: collect,
      });
      const names = candidates
        .flatMap((c) => c.names || [])
        .filter((name) => ['pt', 'pt-BR', 'en', 'fr'].includes(name.language) && name.value !== input.query)
        .slice(0, 6);
      if (names.length && !budget.aborted && !input.alternateTitles.some((name) => names.some((n) => n.value === name.value))) {
        await parallelResearch(
          sources.filter((source) => ['wikidata', 'wikipedia'].includes(source.id)),
          { ...input, alternateTitles: names },
          (source, query, options) => getRepository().research(source, query, options),
          { signal: budget, onUpdate: collect },
        );
      }
      if (budget.aborted && !signal.aborted && n === sequence) {
        for (const [id, state] of statuses) if (state.status === 'loading') statuses.set(id, { source: id, status: 'error', error: 'Prazo da pesquisa atingido.' });
        render();
      }
      await knowledgeTask;
      await Promise.allSettled([...pendingDetails.values()]);
      if (n === sequence && !signal.aborted) {
        try {
          snapshot = researchSnapshot(input, candidates, decisions);
          void getRepository()
            .saveResearch?.(snapshot, current.id ? current : null)
            ?.catch(() => {
              if (n === sequence && !signal.aborted) status.textContent += ' Não foi possível guardar a pesquisa para outros dispositivos.';
            });
        } catch {
          status.textContent += ' Não foi possível guardar esta pesquisa; as sugestões continuam disponíveis.';
        }
      }
      if (!sources.some((s) => s.enabled)) render();
    } finally {
      if (n === sequence) {
        active = false;
        cancel.hidden = detailActive || ocrActive ? false : true;
        search.disabled = expand.disabled = false;
        search.removeAttribute('aria-busy');
      }
    }
  }
  function select(candidate) {
    if (!canUse()) return;
    chosenIdentity = candidate.source + ':' + candidate.id;
    render();
    onApplied({});
  }
  function confirmFields(current) {
    if (!queryInput) return;
    const model = consolidateMetadata(current, [...(ocrCandidate ? [ocrCandidate] : []), ...candidates], chosenIdentity);
    const facts = Object.entries(model.alternatives).flatMap(([key, options]) =>
      options.filter((fact) => JSON.stringify(fact.value) === JSON.stringify(current[key])).flatMap((fact) => (fact.origins || [fact]).map((origin) => ({ ...origin, key, state: 'confirmed' }))),
    );
    decisions.push({ manualHash: current.manual.sha256, edition: current.edition || '', reviewedAt: Date.now(), reviewedBy: getRepository().session?.user?.uid || 'device', facts });
    queryInput = { ...queryInput, edition: current.edition || '' };
    snapshot = researchSnapshot(queryInput, candidates, decisions);
  }
  search.onclick = () => void run(false);
  expand.onclick = () => void run(true);
  cancel.onclick = () => cancelWork('Pesquisa cancelada.');
  async function runOcr() {
    if (!canUse() || !getPdf || ocrActive) return;
    const current = getCurrent();
    ocrController = new AbortController();
    const control = ocrController;
    ocrActive = true;
    cancel.hidden = false;
    if (ocrButton) ocrButton.disabled = true;
    try {
      const result = await recognizePdfImages(await getPdf(), {
        language: current.language === 'other' ? 'pt-BR' : current.language,
        signal: control.signal,
        onPage: (page) => {
          if (!control.signal.aborted && canUse()) onOcrPage(page, current);
        },
        onProgress: (message) => {
          if (ocrStatus && !control.signal.aborted) ocrStatus.textContent = message;
        },
      });
      if (control.signal.aborted || !canUse()) return;
      const { sources: evidence, ...metadata } = result.metadata;
      const fields = Object.fromEntries(selectedFields({ fields: metadata }, {}).map(({ key, value }) => [key, value]));
      if (!Object.keys(fields).length) {
        ocrCandidate = null;
        if (ocrStatus) ocrStatus.textContent = 'Nenhum dado legível encontrado. Você pode preencher pelo manual.';
        render();
        return;
      }
      ocrCandidate = {
        source: 'pdf',
        manualHash: current.manual?.sha256 || '',
        id: 'local-ocr',
        url: '',
        fields,
        names: [{ value: current.title, language: current.language }],
        kind: 'unknown',
        edition: current.edition || '',
        language: result.metadata.language,
        descriptionLanguage: result.metadata.language,
        license: 'Manual enviado · texto reconhecido no dispositivo',
        evidence,
        conflicts: [],
      };
      if (ocrStatus) ocrStatus.textContent = `${result.pages.length} página(s) lida(s). Há sugestões para revisar.`;
      render();
    } catch (error) {
      if (!control.signal.aborted && ocrStatus) ocrStatus.textContent = error.message;
    } finally {
      if (control === ocrController) {
        ocrActive = false;
        cancel.hidden = !active && !detailActive;
        if (ocrButton) ocrButton.disabled = false;
      }
    }
  }
  if (ocrButton) ocrButton.onclick = () => void runOcr();
  language.onchange = () => {
    writePreference(language.value);
    invalidate();
  };
  kind.onchange = () => invalidate();
  function invalidate() {
    snapshot = queryInput = null;
    decisions = [];
    chosenIdentity = null;
    onConsolidated(null);
    cancelWork('Dados da busca alterados. Pesquise novamente.');
    candidates = [];
    statuses.clear();
    appliedCandidates.clear();
    notifySuggestions();
    list.replaceChildren();
    review.hidden = true;
  }
  return { snapshot: () => snapshot, confirmFields, reset, run, loadExisting, runOcr, cancel: cancelWork, invalidate, isBusy: () => active || ocrActive };
}
