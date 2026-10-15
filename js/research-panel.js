import { parallelResearch, normalizedQuery, sourceNames, manualSources, sameWork, matchWarnings, selectedFields, fieldLabels, researchSummary } from './research-client.js';
import { RESEARCH_PROTOCOL, RESEARCH_VERSION } from './research-contract.js';
import { recognizePdfImages } from './pdf-ocr.js';

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
export function createResearchPanel({ root, getRepository, getCurrent, getPdf, apply, canUse, readPreference, writePreference }) {
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
    if (ocrActive && ocrStatus) ocrStatus.textContent = 'Leitura local cancelada. Nenhum campo foi aplicado automaticamente.';
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
    if (ocrStatus) ocrStatus.textContent = '';
    list.replaceChildren();
    review.replaceChildren();
    review.hidden = true;
    const preference = readPreference();
    language.value = ['pt-BR', 'en', 'fr'].includes(preference) ? preference : 'pt-BR';
    kind.value = 'unknown';
    status.textContent = 'O PDF é a fonte principal. Confirme a edição antes de aplicar sugestões externas.';
  }
  async function loadSources(signal) {
    if (getRepository().mode === 'local') {
      sources = [];
      sourceFailure = 'Modo local: fontes externas não consultadas; entre no acervo conectado para usar as APIs. O PDF e o OCR local continuam disponíveis.';
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
    for (const candidate of [...(ocrCandidate ? [ocrCandidate] : []), ...candidates].sort((a, b) => priority(a) - priority(b))) {
      const card = node('article');
      card.className = 'research-card';
      card.dataset.researchSource = candidate.source;
      const heading = node('strong', candidate.fields.title || getCurrent()?.title || 'Trechos do PDF'),
        p = node('p', `${sourceNames[candidate.source]} · ${candidate.language || 'idioma não informado'} · ${candidate.kind === 'base' ? 'jogo base' : candidate.kind === 'expansion' ? 'expansão' : 'tipo não confirmado'} · edição exige revisão`);
      const names = node('small', [...new Set((candidate.names || []).map((n) => n.value))].slice(0, 8).join(' / '));
      const related = candidates.filter((c) => c !== candidate && sameWork(c, candidate));
      const action = node('button', 'Revisar sugestões');
      action.type = 'button';
      action.className = 'button secondary small';
      action.onclick = () => select(candidate);
      card.append(heading, p, names);
      if (candidate.url) card.append(link('Fonte ↗', candidate.url));
      if (candidate.identityNote) card.append(node('p', candidate.identityNote));
      if (candidate.attributionLogo) {
        const a = link('', candidate.url),
          img = document.createElement('img');
        img.src = candidate.attributionLogo;
        img.alt = 'Powered by BGG';
        img.width = 150;
        a.append(img);
        card.append(a);
      }
      if (related.length) card.append(node('p', `Mesmo jogo identificado em ${related.map((c) => sourceNames[c.source]).join(', ')}. A edição continua exigindo revisão.`));
      if (kind.value !== 'unknown' && candidate.kind !== 'unknown' && candidate.kind !== kind.value) {
        action.disabled = true;
        card.append(node('p', 'Tipo incompatível com o manual; não aplicar.'));
      }
      card.append(action);
      list.append(card);
    }
    status.textContent = sourceFailure || researchSummary(sources, statuses);
  }
  async function run(expanded = false) {
    const current = getCurrent();
    if (!current || !canUse()) return;
    cancelWork();
    const n = ++sequence;
    controller = new AbortController();
    const signal = controller.signal;
    candidates = [];
    statuses.clear();
    review.hidden = true;
    selected = null;
    list.replaceChildren();
    active = true;
    cancel.hidden = false;
    search.disabled = expand.disabled = true;
    search.setAttribute('aria-busy', 'true');
    status.textContent = 'Consultando fontes disponíveis… Você já pode salvar os dados do PDF.';
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
  async function select(candidate) {
    if (!canUse()) return;
    detailController?.abort();
    detailController = new AbortController();
    const selectionController = detailController;
    detailActive = true;
    cancel.hidden = false;
    const signal = detailController.signal,
      n = sequence;
    review.hidden = false;
    review.replaceChildren(node('p', 'Preparando as sugestões desta fonte…'));
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
      selected = candidate;
      showReview();
    } catch (error) {
      if (!signal.aborted && n === sequence) review.replaceChildren(node('p', error.message));
    } finally {
      if (selectionController === detailController) {
        detailActive = false;
        cancel.hidden = !active;
      }
    }
  }
  function showReview() {
    const current = getCurrent();
    if (!current || !selected) return;
    review.replaceChildren();
    review.append(node('h4', `Revisar · ${sourceNames[selected.source]}`), node('p', `Uso: ${selected.license}. Descrição: ${selected.descriptionLanguage || 'não disponível'}. Você pode editar ou traduzir manualmente após aplicar.`));
    if (selected.url) review.append(link('Consultar a origem', selected.url));
    if (selected.licenseUrl) review.append(link('Licença do trecho', selected.licenseUrl));
    for (const warning of selected.source === 'pdf' ? ['O OCR pode errar letras e números. Confira os trechos nas páginas indicadas.'] : matchWarnings(selected, { ...current, kind: kind.value }, candidates)) {
      const p = node('p', warning);
      p.className = 'research-warning';
      review.append(p);
    }
    const choices = [];
    for (const field of selectedFields(selected, current)) {
      const label = node('label'),
        checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = field.checked;
      if (selected.source === 'pdf') checkbox.checked = false;
      checkbox.dataset.researchField = field.key;
      label.className = 'research-choice';
      label.append(checkbox, node('span', `${fieldLabels[field.key]}: ${display(field.value)}${field.conflict ? ` · diverge do PDF/cadastro: ${display(field.current)}` : ''}`));
      const evidence = selected.evidence?.[field.key === 'minPlayers' || field.key === 'maxPlayers' ? 'players' : ['minDurationMinutes', 'maxDurationMinutes'].includes(field.key) ? 'duration' : field.key];
      if (evidence) label.append(node('small', `${evidence.page ? 'p. ' + evidence.page + ' · ' : ''}${evidence.excerpt}`));
      review.append(label);
      choices.push([field, checkbox]);
    }
    const pairs = [choices.filter(([f]) => ['minPlayers', 'maxPlayers'].includes(f.key)), choices.filter(([f]) => ['minDurationMinutes', 'maxDurationMinutes'].includes(f.key))];
    for (const [field, reason] of Object.entries(selected.fieldReasons || {})) if (reason && !selected.fields[field]) review.append(node('p', `${fieldLabels[field] || (field === 'durationMinutes' ? 'Duração' : field)}: ${reason}`));
    for (const pair of pairs) for (const [, checkbox] of pair) checkbox.onchange = () => pair.forEach(([, other]) => (other.checked = checkbox.checked));
    const label = node('label'),
      confirm = document.createElement('input');
    confirm.type = 'checkbox';
    label.className = 'research-choice';
    label.append(confirm, node('span', 'Conferi o jogo, a edição e os campos escolhidos com o PDF original.'));
    review.append(label);
    const button = node('button', 'Aplicar campos confirmados');
    button.type = 'button';
    button.className = 'button primary small';
    button.disabled = true;
    confirm.onchange = () => (button.disabled = !confirm.checked);
    review.append(button);
    button.onclick = () => {
      if (!canUse() || !confirm.checked) return;
      if (kind.value !== 'unknown' && selected.kind !== 'unknown' && kind.value !== selected.kind) return;
      const values = Object.fromEntries(choices.filter(([, box]) => box.checked).map(([field]) => [field.key, field.value]));
      // Nenhum campo muda enquanto o administrador não confirmar explicitamente.
      try {
        apply(values, selected);
        review.hidden = true;
        status.textContent = 'Campos confirmados aplicados. A capa do PDF e os dados não selecionados foram preservados.';
      } catch (error) {
        review.append(node('p', error.message));
      }
    };
  }
  search.onclick = () => void run(false);
  expand.onclick = () => void run(true);
  cancel.onclick = () => cancelWork('Pesquisa cancelada. Você pode salvar os dados do PDF.');
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
      const fields = Object.fromEntries(Object.entries(metadata).filter(([key, value]) => fieldLabels[key] && value != null && value !== '' && (!Array.isArray(value) || value.length)));
      if (!Object.keys(fields).length) {
        ocrCandidate = null;
        if (ocrStatus) ocrStatus.textContent = 'A leitura não encontrou campos com evidência suficiente. Consulte o PDF e preencha somente o que puder confirmar.';
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
      if (ocrStatus) ocrStatus.textContent = `OCR local: ${result.pages.length} página(s) lida(s), ${Object.keys(fields).length} campo(s) sugerido(s). Revise antes de aplicar.`;
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
    cancelWork('Nome, idioma ou tipo alterado. Clique em pesquisar para atualizar as sugestões.');
    candidates = [];
    statuses.clear();
    selected = null;
    list.replaceChildren();
    review.hidden = true;
  }
  return { reset, run, runOcr, cancel: cancelWork, invalidate, isBusy: () => active || ocrActive };
}
