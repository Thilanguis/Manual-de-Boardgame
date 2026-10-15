import { parallelResearch, normalizedQuery, sourceNames, manualSources, sameWork, matchWarnings, selectedFields, fieldLabels, researchSummary } from './research-client.js';
import { RESEARCH_PROTOCOL, RESEARCH_VERSION } from './research-contract.js';
import { recognizePdfImages } from './pdf-ocr.js';
import { presentCandidate, candidateFacts, resultSummary } from './research-presentation.js';

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
export function createResearchPanel({ root, getRepository, getCurrent, getPdf, apply, canUse, readPreference, writePreference, onApplied = () => document.querySelector('[data-step-target="2"]')?.click(), onSuggestions = () => {} }) {
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
    for (const original of [...(ocrCandidate ? [ocrCandidate] : []), ...candidates].sort((a, b) => priority(a) - priority(b))) {
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
      card.append(node('small', additional ? 'Use todas as sugestões ou escolha os campos na revisão.' : candidate.needsDetail ? 'Abra a revisão para consultar os dados desta fonte.' : 'Só o título foi encontrado. Sem outros dados para preencher.'));
      const details = disclosure('Edição, nomes e direitos de uso');
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
      card.append(actions);
      list.append(card);
    }
    const diagnostics = root.querySelector('[data-research-diagnostics]');
    if (diagnostics) diagnostics.textContent = sourceFailure || researchSummary(sources, statuses);
    status.textContent = sourceFailure ? (getRepository().mode === 'local' ? sourceFailure : 'Não foi possível pesquisar agora. Tente novamente.') : resultSummary(candidates, sources, statuses);
  }
  async function run(expanded = false) {
    const current = getCurrent();
    if (!current || !canUse()) return;
    cancelWork();
    const n = ++sequence;
    controller = new AbortController();
    const signal = controller.signal;
    candidates = [];
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
    try {
      await loadSources(signal);
      if (signal.aborted || n !== sequence) return;
      const input = { action: 'search', query: normalizedQuery(current.title), pdfLanguage: current.language, preferredLanguage: language.value, kind: kind.value, expanded };
      input.alternateTitles = current.sources?.originalTitle ? [{ value: current.sources.originalTitle.excerpt, language: 'other' }] : [];
      // Mantém a edição na evidência e pesquisa o nome do jogo separadamente.
      if (current.edition) input.query = input.query.replace(/\s+(?:\d+(?:st|nd|rd|th|e|ª)?\s+)?(?:édition|edition|edição)\b.*$/i, '').trim() || input.query;
      if (input.query.length < 2) {
        status.textContent = 'Informe o nome do jogo para pesquisar.';
        return;
      }
      await parallelResearch(sources, input, (source, query, options) => getRepository().research(source, query, options), {
        signal,
        onUpdate(update) {
          if (n !== sequence || signal.aborted) return;
          statuses.set(update.source, update);
          if (update.candidates) candidates.push(...update.candidates);
          render();
        },
      });
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
      if (candidate.needsDetail) {
        const result = await getRepository().research(candidate.source, { action: 'detail', id: candidate.id, pdfLanguage: getCurrent().language, preferredLanguage: language.value, kind: kind.value }, { signal });
        if (signal.aborted || n !== sequence) return;
        const detail = result.candidates.find((c) => c.id === candidate.id);
        if (!detail) throw new Error('Não foi possível confirmar este jogo nesta fonte.');
        candidate = { ...detail, names: [...candidate.names, ...detail.names] };
        candidates = candidates.map((c) => (c.source === candidate.source && c.id === candidate.id ? candidate : c));
        render();
      }
      if (signal.aborted || n !== sequence || !canUse()) return;
      selected = presentCandidate(candidate, candidates);
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
      if (selected.source === 'pdf') checkbox.checked = false;
      checkbox.dataset.researchField = field.key;
      label.className = 'research-choice';
      const content = node('span');
      content.append(node('strong', fieldLabels[field.key]), node('span', display(field.value)));
      if (field.conflict) content.append(node('small', `Substituirá: ${display(field.current)}`));
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
    cancelWork('Dados da busca alterados. Pesquise novamente.');
    candidates = [];
    statuses.clear();
    selected = null;
    appliedCandidates.clear();
    notifySuggestions();
    list.replaceChildren();
    review.hidden = true;
  }
  return { reset, run, runOcr, cancel: cancelWork, invalidate, isBusy: () => active || ocrActive };
}
