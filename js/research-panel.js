import { consolidateCandidates, researchSnapshot, factSignature } from './research-knowledge.js';
import { parallelResearch, normalizedQuery, sourceNames, manualSources, sameWork, matchWarnings, selectedFields, fieldLabels, researchSummary } from './research-client.js';
import { RESEARCH_PROTOCOL, RESEARCH_VERSION } from './research-contract.js';
import { recognizePdfImages } from './pdf-ocr.js';
import { presentCandidate, candidateFacts, resultSummary } from './research-presentation.js';
import { createTextTranslator } from './translation.js';
import { portugueseCandidate, translateCatalogCandidate, pdfMetadataCandidate } from './catalog-language.js';

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
  apply,
  canUse,
  readPreference,
  writePreference,
  onApplied = () => document.querySelector('[data-step-target="2"]')?.click(),
  onSuggestions = () => {},
  onOcrPage = () => {},
}) {
  let controller,
    detailController,
    sequence = 0,
    sources = [],
    candidates = [],
    statuses = new Map(),
    selected,
    active = false;
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
    onSuggestions([...(ocrCandidate ? [ocrCandidate] : []), ...candidates].filter((candidate) => !appliedCandidates.has(candidateKey(candidate))).length);
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
    snapshot = queryInput = null;
    decisions = [];
    if (aliasesInput) aliasesInput.value = '';
    const refresh = root.querySelector('[data-research-refresh]');
    if (refresh) refresh.checked = false;
    statuses = new Map();
    selected = null;
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
    const priority = (c) => (c.source === 'ludopedia' ? 0 : c.fields?.title && ['pt-BR', 'pt-br', 'pt'].includes(c.language) ? 1 : getCurrent()?.language === 'fr' && c.language === 'fr' ? 2 : 3);
    for (const original of consolidateCandidates([...(ocrCandidate ? [ocrCandidate] : []), ...candidates]).sort((a, b) => priority(a) - priority(b))) {
      const candidate = presentCandidate(original, candidates);
      const card = node('article');
      card.className = 'research-card';
      card.dataset.researchSource = candidate.source;
      const heading = node('h4', candidate.fields.title || getCurrent()?.title || 'Trechos do PDF');
      const related = candidates.filter((c) => c !== candidate && sameWork(c, candidate));
      const action = node('button', 'Revisar sugestões');
      action.type = 'button';
      action.className = 'button secondary small';
      action.onclick = () => select(original);
      const useAll = node('button', 'Usar sugestões');
      useAll.type = 'button';
      useAll.className = 'button primary small';
      useAll.dataset.researchUseAll = '';
      useAll.onclick = () => select(original, true);
      card.append(heading);
      if (candidate.secondaryTitle) card.append(node('p', candidate.secondaryTitle));
      const source = candidate.url ? link(sourceNames[candidate.source], candidate.url) : node('small', sourceNames[candidate.source]);
      source.className = 'research-source';
      card.append(source);
      if (candidate.contributors?.length > 1) card.append(node('small', `${candidate.contributors.length} fontes · informações reunidas`));
      if (candidate.fields.description) card.append(node('p', candidate.fields.description));
      const facts = candidateFacts(candidate),
        metadata = node('dl');
      metadata.className = 'research-facts';
      for (const [label, value] of facts) {
        const item = node('div');
        item.append(node('dt', label), node('dd', value));
        metadata.append(item);
      }
      if (facts.length) card.append(metadata);
      const additional = selectedFields(candidate, {}).filter((field) => field.key !== 'title').length;
      if (!additional) card.append(node('small', candidate.needsDetail ? 'Dados adicionais ainda não consultados.' : 'Só o título foi encontrado. Sem outros dados para preencher.'));
      const details = disclosure('Edição, nomes e direitos de uso');
      for (const field of candidate.pendingTranslations || []) details.append(node('p', `${fieldLabels[field.key]} · original (${field.language}): ${display(field.value)}`));
      details.append(node('p', candidate.edition ? `Edição: ${candidate.edition}` : 'A fonte não confirmou a edição do seu manual.'));
      const names = [...new Set(candidate.names.map((name) => name.value))];
      if (names.length) details.append(node('p', names.join(' · ')));
      if (candidate.identityNote) details.append(node('p', candidate.identityNote));
      details.append(node('p', `Uso: ${candidate.license || 'Confira as condições na fonte.'}`));
      if (candidate.licenseUrl) details.append(link('Licença', candidate.licenseUrl));
      if (original.fields.description && !candidate.fields.description) details.append(node('p', `Rótulo de identificação: ${original.fields.description}. Não usado como resumo.`));
      if (candidate.attributionLogo) {
        const a = link('', candidate.url),
          img = document.createElement('img');
        img.src = candidate.attributionLogo;
        img.alt = 'Powered by BGG';
        img.width = 150;
        a.append(img);
        card.append(a);
      }
      if (related.length) details.append(node('p', `Também identificado em ${related.map((c) => sourceNames[c.source]).join(', ')}.`));
      card.append(details);
      if (kind.value !== 'unknown' && candidate.kind !== 'unknown' && candidate.kind !== kind.value) {
        action.disabled = useAll.disabled = true;
        card.append(node('p', 'Tipo incompatível com o manual; não aplicar.'));
      }
      const actions = node('div');
      actions.className = 'research-actions';
      actions.append(action, useAll);
      if (candidate.pendingTranslations?.length) {
        card.append(node('small', 'Há textos aguardando tradução para português.'));
        const translate = node('button', 'Traduzir para português');
        translate.type = 'button';
        translate.className = 'button secondary small';
        translate.onclick = () => void translateSuggestion(original);
        translate.title = 'Tradução neste dispositivo; pode baixar o pacote de idioma. Nenhum texto é enviado a um servidor.';
        if (globalThis.Translator) actions.append(translate);
        else card.append(node('small', 'A tradução local não está disponível aqui. Use a revisão para escrever em português.'));
      }
      card.append(actions);
      list.append(card);
    }
    const diagnostics = root.querySelector('[data-research-diagnostics]');
    if (diagnostics) diagnostics.textContent = sourceFailure || researchSummary(sources, statuses);
    status.textContent = sourceFailure ? (getRepository().mode === 'local' ? sourceFailure : 'Não foi possível pesquisar agora. Tente novamente.') : resultSummary(candidates, sources, statuses);
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
    if (ocrCandidate?.manualHash !== current.manual?.sha256 || ocrCandidate?.pdfMethod === 'text') ocrCandidate = null;
    const extracted = pdfMetadataCandidate(current);
    if (extracted) ocrCandidate = extracted;
    appliedCandidates.clear();
    notifySuggestions();
    statuses.clear();
    review.hidden = true;
    selected = null;
    list.replaceChildren();
    active = true;
    cancel.hidden = false;
    search.disabled = expand.disabled = true;
    search.setAttribute('aria-busy', 'true');
    status.textContent = 'Pesquisando…';
    const budget = AbortSignal.any([signal, AbortSignal.timeout(expanded ? 10000 : 7000)]);
    try {
      const input = { action: 'search', query: normalizedQuery(current.title), pdfLanguage: current.language, preferredLanguage: language.value, kind: kind.value, expanded, fetchedAt: Date.now() };
      input.alternateTitles = current.sources?.originalTitle ? [{ value: current.sources.originalTitle.excerpt, language: 'other' }] : [];
      input.edition = current.edition || '';
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
        candidates = cached.candidates;
        decisions = (cached.decisions || []).map((decision) => ({ ...decision, manualHash: decision.manualHash ?? cached.manualHash, edition: decision.edition ?? cached.edition }));
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
            else candidates[at] = stamped;
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
  async function select(candidate, acceptAll = false) {
    if (!canUse()) return;
    const initial = getCurrent();
    detailController?.abort();
    detailController = new AbortController();
    const selectionController = detailController;
    detailActive = true;
    cancel.hidden = false;
    const signal = detailController.signal,
      n = sequence;
    review.hidden = acceptAll;
    review.replaceChildren(node('p', 'Preparando as sugestões desta fonte…'));
    if (acceptAll) status.textContent = 'Preparando sugestões…';
    try {
      if (candidate.needsDetail || candidate.members?.some((member) => member.needsDetail)) {
        const members = await Promise.all(
          (candidate.members || [candidate]).map(async (member) => {
            if (!member.needsDetail) return member;
            const result = await getRepository().research(member.source, { action: 'detail', id: member.id, query: initial.title, pdfLanguage: initial.language, preferredLanguage: language.value, kind: kind.value }, { signal });
            const detail = result.candidates.find((c) => c.id === member.id);
            if (!detail) throw new Error('Não foi possível confirmar este jogo nesta fonte.');
            const next = { ...detail, names: [...member.names, ...detail.names], fetchedAt: result.fetchedAt || Date.now() };
            candidates = candidates.map((c) => (c.source === next.source && c.id === next.id ? next : c));
            return next;
          }),
        );
        candidate = consolidateCandidates(members)[0];
        render();
      }
      if (signal.aborted || n !== sequence || !canUse()) return;
      selected = presentCandidate(candidate, candidates);
      if (acceptAll && selected.requiresEditionReview) {
        // Aprovações de outro PDF não autorizam o atalho de aceitação integral.
        review.hidden = false;
        showReview();
        review.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      if (acceptAll) {
        const fields = selectedFields(selected, initial);
        if (!fields.length) throw new Error('Esta fonte não trouxe campos para preencher.');
        if (fields.some((field) => JSON.stringify(field.current) !== JSON.stringify(getCurrent()[field.key]))) throw new Error('Você alterou os dados durante a consulta. Tente usar as sugestões novamente.');
        const conflicts = fields.filter((field) => field.conflict);
        if (
          (conflicts.length || selected.conflicts?.length || selected.source === 'pdf') &&
          !window.confirm(
            `Usar todas as sugestões de ${sourceNames[selected.source]}?${conflicts.length ? '\nSubstituir: ' + conflicts.map((field) => fieldLabels[field.key]).join(', ') + '.' : ''}\nConfira o jogo, a edição e os dados na etapa 2 antes de salvar.`,
          )
        ) {
          status.textContent = 'Nenhum campo foi alterado.';
          return;
        }
        if (signal.aborted || n !== sequence) return;
        finishApplication(Object.fromEntries(fields.map((field) => [field.key, field.value])), selected);
        return;
      }
      showReview();
      review.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (error) {
      if (!signal.aborted && n === sequence) {
        if (acceptAll) status.textContent = error.message;
        else review.replaceChildren(node('p', error.message));
      }
    } finally {
      if (selectionController === detailController) {
        detailActive = false;
        cancel.hidden = !active;
      }
    }
  }
  function finishApplication(values, candidate) {
    if (!canUse()) throw new Error('Não foi possível aplicar agora. Tente novamente.');
    if (kind.value !== 'unknown' && candidate.kind !== 'unknown' && kind.value !== candidate.kind) throw new Error('Jogo base e expansão não correspondem. Revise o resultado escolhido.');
    apply(values, candidate);
    onApplied(values);
    const destination = root.closest('form')?.querySelector('[data-game-step="2"]');
    if (destination?.hidden) throw new Error('Os campos foram preenchidos, mas a etapa 2 não abriu. Use “Conferir dados” no topo para continuar.');
    decisions.push({
      manualHash: queryInput?.manualHash || '',
      edition: queryInput?.edition || '',
      source: candidate.source,
      id: candidate.id,
      fields: Object.keys(values),
      reviewedAt: Date.now(),
      reviewedBy: getRepository().session?.user?.uid || 'device',
      values,
      facts: Object.entries(values)
        .map(([key, value]) => ({ ...(candidate.fieldSources?.[key] || candidate), key, value, state: 'confirmed' }))
        .map(({ source, id, key, value, state, language, url, license }) => ({ source, id, key, value, state, language, url, license })),
      rejected: selectedFields(candidate, {})
        .filter((field) => !(field.key in values))
        .map((field) => field.key),
    });
    if (queryInput) {
      try {
        snapshot = researchSnapshot(queryInput, candidates, decisions);
      } catch {
        snapshot = null;
      }
    }
    appliedCandidates.add(candidateKey(candidate));
    notifySuggestions();
    review.hidden = true;
    status.textContent = 'Campos preenchidos. Confira antes de salvar.';
  }
  function showReview() {
    const current = getCurrent();
    if (!current || !selected) return;
    review.replaceChildren();
    review.append(node('h4', 'Revisar sugestões'), node('p', 'Selecione os campos que deseja usar.'));
    if (selected.pendingTranslations?.length) {
      const translations = disclosure('Escrever tradução em português');
      translations.append(node('p', 'Os originais serão preservados. Categorias e mecânicas: separe por vírgulas.'));
      const inputs = [];
      for (const pending of selected.pendingTranslations) {
        const label = node('label', `${fieldLabels[pending.key]} · ${sourceNames[pending.source] || pending.source}`);
        label.append(node('p', display(pending.value)));
        const input = document.createElement('textarea');
        input.rows = pending.key === 'description' ? 4 : 2;
        input.maxLength = pending.key === 'description' ? 2000 : 400;
        input.dataset.manualTranslation = pending.key;
        label.append(input);
        translations.append(label);
        inputs.push([pending, input]);
      }
      const save = node('button', 'Adicionar traduções às sugestões');
      save.type = 'button';
      save.className = 'button secondary small';
      save.onclick = () => {
        for (const [pending, input] of inputs) {
          if (!input.value.trim()) continue;
          const member = (selected.members || [selected]).find((m) => m.source === pending.source && m.id === pending.id);
          const fieldTranslations = {
            ...member.fieldTranslations,
            [pending.key]: {
              sourceValue: pending.value,
              value: Array.isArray(pending.value)
                ? input.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                : input.value.trim(),
              sourceLanguage: pending.language,
              targetLanguage: 'pt-BR',
              method: 'manual',
              createdAt: Date.now(),
            },
          };
          Object.assign(member, { fieldTranslations });
          updateCandidate(member);
        }
        selected = presentCandidate(consolidateCandidates(selected.members || [selected])[0], candidates);
        showReview();
      };
      translations.append(save);
      review.append(translations);
    }
    if (selected.requiresEditionReview) {
      const warning = node('p', 'A edição deste PDF ainda não foi conferida. Revise os campos antes de usar.');
      warning.className = 'research-warning';
      review.append(warning);
    }
    const details = disclosure('Origem, edição e direitos de uso');
    details.append(node('p', `Fonte: ${sourceNames[selected.source]} · ${selected.license || 'consulte as condições de uso'}`));
    if (selected.url) details.append(link('Consultar a origem', selected.url));
    if (selected.licenseUrl) details.append(link('Licença do trecho', selected.licenseUrl));
    if (selected.descriptionLanguage)
      details.append(node('p', `Idioma do resumo: ${{ pt: 'Português', 'pt-BR': 'Português brasileiro', 'pt-br': 'Português brasileiro', en: 'Inglês', fr: 'Francês' }[selected.descriptionLanguage] || selected.descriptionLanguage}`));
    const warnings = selected.source === 'pdf' ? ['O OCR pode errar letras e números. Confira os trechos nas páginas indicadas.'] : matchWarnings(selected, { ...current, kind: kind.value }, candidates);
    if (selected.conflicts?.length) review.append(node('p', 'Esta fonte tem informações divergentes. Confira os campos com o manual.'));
    for (const warning of warnings) {
      const p = node('p', warning);
      p.className = 'research-warning';
      details.append(p);
    }
    review.append(node('p', selected.source === 'pdf' ? 'Confira o texto reconhecido nas páginas do manual.' : 'Confira se o título e a edição correspondem ao seu manual.'), details);
    const allLabel = node('label'),
      all = document.createElement('input');
    all.type = 'checkbox';
    all.dataset.researchAll = '';
    allLabel.className = 'research-choice';
    allLabel.append(all, node('span', 'Selecionar todos'));
    review.append(allLabel);
    const choices = [];
    for (const field of selectedFields(selected, current)) {
      const label = node('label'),
        checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = field.checked;
      if (
        [...decisions]
          .reverse()
          .find((decision) => decision.source === selected.source && decision.id === selected.id)
          ?.rejected?.includes(field.key)
      )
        checkbox.checked = false;
      if (selected.source === 'pdf') checkbox.checked = false;
      checkbox.dataset.researchField = field.key;
      label.className = 'research-choice';
      const content = node('span');
      content.append(node('strong', fieldLabels[field.key]), node('span', display(field.value)));
      if (field.conflict) content.append(node('small', `Substituirá: ${display(field.current)}`));
      const origin = selected.fieldSources?.[field.key];
      if (origin) {
        const originLabel = node('small', `${sourceNames[origin.source] || origin.source} · ${origin.language}`);
        originLabel.dataset.researchOrigin = field.key;
        content.append(originLabel);
      }
      const alternatives = selected.alternatives?.[field.key] || [];
      if (new Set(alternatives.map((fact) => factSignature(fact.value))).size > 1) {
        const select = document.createElement('select');
        select.dataset.researchAlternative = field.key;
        select.setAttribute('aria-label', `Origem de ${fieldLabels[field.key]}`);
        alternatives.forEach((fact, i) => {
          const option = node('option', `${display(fact.value)} · ${sourceNames[fact.source] || fact.source} (${fact.language})`);
          option.value = String(i);
          select.append(option);
        });
        select.onchange = () => {
          const fact = alternatives[Number(select.value)];
          field.value = fact.value;
          content.children[1].textContent = display(fact.value);
          const originLabel = content.querySelector('[data-research-origin]');
          if (originLabel) originLabel.textContent = `${sourceNames[fact.source] || fact.source} · ${fact.language}`;
          selected.fieldSources[field.key] = fact;
          const pairKeys = ['minDurationMinutes', 'maxDurationMinutes'].includes(field.key) ? ['minDurationMinutes', 'maxDurationMinutes'] : ['minPlayers', 'maxPlayers'].includes(field.key) ? ['minPlayers', 'maxPlayers'] : [];
          for (const [other, box] of choices.filter(([other]) => pairKeys.includes(other.key) && other.key !== field.key)) {
            const options = selected.alternatives[other.key] || [];
            const at = options.findIndex((option) => option.source === fact.source && option.id === fact.id && option.language === fact.language);
            if (at >= 0) {
              other.value = options[at].value;
              const otherContent = box.closest('label').querySelector(':scope > span');
              otherContent.children[1].textContent = display(other.value);
              const otherOrigin = otherContent.querySelector('[data-research-origin]');
              if (otherOrigin) otherOrigin.textContent = `${sourceNames[fact.source] || fact.source} · ${fact.language}`;
              selected.fieldSources[other.key] = options[at];
              const input = review.querySelector(`[data-research-alternative="${other.key}"]`);
              if (input) input.value = String(at);
            }
            box.checked = false;
          }

          checkbox.checked = false;
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        };
        content.append(select);
      }
      label.append(checkbox, content);
      const evidence = selected.evidence?.[field.key === 'minPlayers' || field.key === 'maxPlayers' ? 'players' : ['minDurationMinutes', 'maxDurationMinutes'].includes(field.key) ? 'duration' : field.key];
      if (evidence) details.append(node('p', `${fieldLabels[field.key]}${evidence.page ? ' · p. ' + evidence.page : ''}: ${evidence.excerpt}`));
      review.append(label);
      choices.push([field, checkbox]);
    }
    const pairs = [choices.filter(([f]) => ['minPlayers', 'maxPlayers'].includes(f.key)), choices.filter(([f]) => ['minDurationMinutes', 'maxDurationMinutes'].includes(f.key))];
    for (const [field, reason] of Object.entries(selected.fieldReasons || {})) if (reason && !selected.fields[field]) details.append(node('p', `${fieldLabels[field] || (field === 'durationMinutes' ? 'Duração' : field)}: ${reason}`));
    for (const pair of pairs) if (pair.some(([field]) => field.conflict)) pair.forEach(([, checkbox]) => (checkbox.checked = false));
    for (const pair of pairs) for (const [, checkbox] of pair) checkbox.onchange = () => pair.forEach(([, other]) => (other.checked = checkbox.checked));
    const label = node('label'),
      confirm = document.createElement('input');
    confirm.type = 'checkbox';
    label.className = 'research-choice';
    label.append(confirm, node('span', 'Conferi o jogo, a edição e os campos selecionados.'));
    review.append(label);
    const selectionStatus = node('p'),
      errorMessage = node('p'),
      button = node('button', 'Usar campos na etapa 2');
    selectionStatus.setAttribute('aria-live', 'polite');
    errorMessage.setAttribute('role', 'alert');
    errorMessage.hidden = true;
    button.type = 'button';
    button.className = 'button primary small';
    button.disabled = true;
    function updateSelection() {
      const count = choices.filter(([, box]) => box.checked).length;
      all.checked = !!choices.length && count === choices.length;
      all.indeterminate = count > 0 && count < choices.length;
      all.disabled = !choices.length;
      selectionStatus.textContent = count ? `${count} campo(s) selecionado(s).` : 'Selecione ao menos um campo.';
      button.disabled = !confirm.checked || !count;
    }
    all.onchange = () => {
      choices.forEach(([, checkbox]) => (checkbox.checked = all.checked));
      updateSelection();
    };
    review.addEventListener('change', updateSelection, { signal: detailController.signal });
    updateSelection();
    review.append(selectionStatus, errorMessage, button);
    button.onclick = () => {
      if (!canUse()) {
        errorMessage.textContent = 'Não foi possível aplicar agora. Aguarde a operação em andamento e tente novamente.';
        errorMessage.hidden = false;
        return;
      }
      if (!confirm.checked) return;
      if (kind.value !== 'unknown' && selected.kind !== 'unknown' && kind.value !== selected.kind) {
        errorMessage.textContent = 'Jogo base e expansão não correspondem. Revise o resultado escolhido.';
        errorMessage.hidden = false;
        return;
      }
      const values = Object.fromEntries(choices.filter(([, box]) => box.checked).map(([field]) => [field.key, field.value]));
      if (!Object.keys(values).length) return;
      const latest = getCurrent();
      if (choices.some(([field, box]) => box.checked && JSON.stringify(field.current) !== JSON.stringify(latest[field.key]))) {
        showReview();
        const warning = node('p', 'Você alterou os dados enquanto revisava. Confira a seleção novamente.');
        warning.setAttribute('role', 'alert');
        review.prepend(warning);
        warning.scrollIntoView({ block: 'center' });
        return;
      }
      // Nenhum campo muda enquanto o administrador não confirmar explicitamente.
      try {
        finishApplication(values, selected);
      } catch (error) {
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
      }
    };
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
    cancelWork('Dados da busca alterados. Pesquise novamente.');
    candidates = [];
    statuses.clear();
    selected = null;
    appliedCandidates.clear();
    notifySuggestions();
    list.replaceChildren();
    review.hidden = true;
  }
  return { snapshot: () => snapshot, reset, run, runOcr, cancel: cancelWork, invalidate, isBusy: () => active || ocrActive };
}
