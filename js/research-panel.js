import { consolidateMetadata, storedCatalogCandidates, metadataKeys, emptyValue } from './metadata-consolidation.js';
import { consolidateCandidates, researchSnapshot } from './research-knowledge.js';
import { parallelResearch, normalizedQuery, sourceNames, manualSources, selectedFields, fieldLabels } from './research-client.js';
import { RESEARCH_PROTOCOL, RESEARCH_VERSION, RESEARCH_QUERY_VERSION } from './research-contract.js';
import { recognizePdfImages } from './pdf-ocr.js';
import { resultSummary, researchSourceState } from './research-presentation.js';
import { createTextTranslator } from './translation.js';
import { portugueseCandidate, translateCatalogCandidate, pdfMetadataCandidate } from './catalog-language.js';
import { savedKnowledgeCandidate } from './research-enrichment.js';
import { informationIdentity, knowledgeMatchesIdentity } from './information-identity.js';
import { gameDocuments } from './documents.js';
import { profileDiagnostic, rejectionText } from './profile-diagnostics.js';
import { combinedProfileComplete, profileSourceMatches, profileDefinitions } from './profile-facts.js';
import { normalizeText } from './model.js';

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
  getDocuments = gameDocuments,
  getPdf,
  canUse,
  readPreference,
  writePreference,
  onApplied = () => document.querySelector('[data-step-target="2"]')?.click(),
  onSuggestions = () => {},
  onConsolidated = () => {},
  onOcrPage = () => {},
  onPrepareDraft = () => {},
  onCancel = () => {},
  onInvalidate = () => {},
}) {
  let controller,
    detailController,
    sequence = 0,
    sources = [],
    candidates = [],
    statuses = new Map(),
    active = false;
  let knowledgeMessage = '';
  let serverNotice = '';
  let chosenIdentity = null;
  let draftKnowledgeCandidate = null;
  let knowledgeDiagnostic = null;
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
    search.disabled = false;
    search.removeAttribute('aria-busy');
    if (message) status.textContent = message;
  }
  function reset() {
    cancelWork();
    knowledgeMessage = '';
    candidates = [];
    draftKnowledgeCandidate = null;
    knowledgeDiagnostic = null;
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
      serverNotice = response.queryStrategyVersion >= RESEARCH_QUERY_VERSION ? '' : 'A pesquisa do servidor precisa ser atualizada.';
      sourceFailure = '';
      sourcesUntil = Date.now() + 60000;
    } catch (error) {
      if (signal?.aborted) return;
      sources = [];
      serverNotice = '';
      sourceFailure = getRepository().mode === 'local' ? 'Modo local: conectores externos exigem o acervo conectado e uma conta autorizada.' : 'Fontes externas não consultadas: ' + error.message;
      if (!signal?.aborted) status.textContent = getRepository().mode === 'local' ? 'Neste dispositivo, a identificação usa o PDF. Fontes externas ficam disponíveis no acervo conectado.' : `Fontes externas indisponíveis: ${error.message}`;
    }
    if (signal?.aborted) return;
    sourceList.replaceChildren();
    const references = disclosure('Referências e consultas manuais');
    for (const source of sources) {
      const p = node('p');
      p.append(link(source.name, source.url));
      if (source.id === 'bgg' && source.enabled && source.logo) {
        const a = link('', source.url),
          img = document.createElement('img');
        img.src = source.logo;
        img.alt = 'Powered by BGG';
        img.width = 150;
        a.append(img);
        p.append(a);
      }
      references.append(p);
    }
    for (const [name, url] of manualSources) {
      const p = node('p');
      p.append(link(`${name} ↗`, url), document.createTextNode(' · consulta manual; integração e reutilização ainda não autorizadas'));
      references.append(p);
    }
    sourceList.append(references);
  }
  function render() {
    notifySuggestions();
    const availability = root.querySelector('[data-research-availability]');
    const sourceState = (id) => researchSourceState(id, statuses, candidates, snapshot);
    if (availability) {
      availability.replaceChildren();
      for (const source of sources.filter((s) => !s.enabled || sourceState(s.id)?.status !== 'done' || sourceState(s.id)?.diagnostics?.complete === false)) {
        const row = node('p'),
          runtime = sourceState(source.id);
        row.textContent = `${sourceNames[source.id] || source.name}: ${!source.enabled ? 'não consultada — exige credenciais/configuração' : runtime?.status === 'error' ? 'falhou — ' + runtime.error : runtime?.status === 'loading' ? 'consultando…' : runtime?.status === 'cached' ? 'sem resultados na pesquisa salva; nenhuma nova consulta' : runtime?.status === 'done' ? (runtime.diagnostics?.complete === false ? 'resposta parcial; houve falhas' : runtime.candidates?.length ? 'respondeu — ' + runtime.candidates.length + ' resultado(s)' : 'respondeu — nenhum resultado') : active ? 'aguardando esta pesquisa' : 'habilitada, ainda não consultada'}`;
        availability.append(row);
      }
    }
    list.replaceChildren();
    const all = [...(ocrCandidate ? [ocrCandidate] : []), ...candidates, ...(draftKnowledgeCandidate && draftKnowledgeCandidate.manualHash === getCurrent()?.manual?.sha256 ? [draftKnowledgeCandidate] : [])];
    const model = consolidateMetadata({ ...getCurrent(), kind: kind.value }, all, chosenIdentity);
    onConsolidated(model);
    if (active) for (const member of model.members.filter((m) => m.needsDetail)) void enrichDetail(member);
    if (active) {
      // Uma busca resumida ainda não tem ano/designers/aliases para resolver
      // identidade. Busca o detalhe de no máximo um nome exato por conector;
      // a consolidação continua exigindo evidência antes de aplicar valores.
      const titles = [getCurrent().title, ...(queryInput?.alternateTitles || []).map((n) => n.value)].map(normalizeText);
      for (const source of ['bgg', 'ludopedia']) {
        const matches = candidates.filter((c) => c.source === source && c.needsDetail && c.names?.some((n) => titles.includes(normalizeText(n.value))));
        if (matches.length === 1) void enrichDetail(matches[0]);
      }
    }
    const results = [model];
    const extras = root.querySelector('[data-research-extras]');
    extras?.replaceChildren();
    const unreadable = [...new Set(all.filter((c) => portugueseCandidate(c).rejectedTexts.length).map((c) => sourceNames[c.source] || c.source))];
    if (unreadable.length) (extras || list).append(node('p', `Texto ilegível descartado em ${unreadable.join(', ')}. Não será sugerido nem enviado para tradução. Os fatos legíveis foram preservados.`));
    if (model.pendingTranslations.length) {
      const details = disclosure('Textos aguardando tradução');
      for (const pending of model.pendingTranslations) {
        const value = display(pending.value),
          entry = node('div');
        entry.className = 'translation-preview';
        entry.append(node('strong', fieldLabels[pending.key] + ' · ' + ({ en: 'Inglês', fr: 'Francês', other: 'idioma não identificado' }[pending.language] || pending.language)));
        const preview = value.length > 260 ? value.slice(0, 260).replace(/\s+\S*$/, '') + '…' : value;
        entry.append(node('p', preview));
        if (value.length > 260) {
          const full = disclosure('Ler texto original');
          full.append(node('p', value));
          entry.append(full);
        }
        details.append(entry);
      }
      if (globalThis.Translator) {
        const translate = node('button', 'Traduzir para português');
        translate.type = 'button';
        translate.onclick = () => void translateSuggestion({ members: model.members });
        details.append(translate);
      } else details.append(node('small', 'A tradução local não está disponível neste navegador. Você pode editar a versão em português na ficha.'));
      (extras || list).append(details);
    }
    if (model.ambiguous.length) {
      const options = disclosure('Conferir qual jogo corresponde ao PDF');
      options.open = true;
      for (const group of model.ambiguous) {
        const action = node('button', (group.fields.title || group.names[0]?.value) + ' · ' + (group.publicationYear || group.edition || 'edição não confirmada'));
        action.type = 'button';
        action.className = 'button secondary small';
        action.onclick = () => void select(group);
        options.append(action);
      }
      list.append(options);
    }
    const diagnostics = root.querySelector('[data-research-diagnostics]');
    if (diagnostics) {
      diagnostics.replaceChildren(node('p', sourceFailure || 'Pesquisa em português, inglês e francês. Resultados por fonte:'));
      if (!active && (knowledgeDiagnostic?.status === 'ready' || snapshot || [...statuses.values()].some((state) => state.status === 'done'))) {
        const current = getCurrent();
        const filled = metadataKeys.filter((key) => !emptyValue(current[key])).length;
        const missing = metadataKeys.filter((key) => emptyValue(current[key]) && emptyValue(model.fields[key]));
        const summary = node(
          'p',
          `Na ficha: ${filled} ${filled === 1 ? 'informação preenchida' : 'informações preenchidas'}.${missing.length ? ` Ainda sem dados confirmados: ${missing.map((key) => fieldLabels[key]).join(', ')}. Esses campos permanecem vazios.` : ''}`,
        );
        summary.dataset.consolidatedSummary = '';
        diagnostics.append(summary);
      }
      if (knowledgeDiagnostic) {
        const d = knowledgeDiagnostic,
          block = node('div');
        block.dataset.profileDiagnostic = '';
        block.append(
          node('strong', 'Ficha Gemini'),
          node(
            'p',
            d.preservedValid
              ? `${d.statusLabel}. ${d.preservedValid} campos da análise anterior foram preservados; esta tentativa não confirmou novos campos.`
              : `${d.statusLabel}${d.status === 'ready' ? ` · ${d.originLabel}. ${d.valid} ${d.valid === 1 ? 'campo aproveitável' : 'campos aproveitáveis'}${d.rejected.length ? `; ${d.rejected.length} sugestões Gemini rejeitadas na validação` : ''}` : ''}.`,
          ),
        );
        if (d.provider) block.append(node('p', `Resposta do provedor: HTTP ${d.provider.httpStatus} · ${d.provider.status}.`));
        if (d.generation) {
          const g = d.generation;
          block.append(node('p', `Término da IA: ${g.finishReason}. Limite de saída: ${g.maxOutputTokens} tokens${Number.isSafeInteger(g.usage?.outputTokens) ? `; saída informada pelo provedor: ${g.usage.outputTokens}` : ''}.`));
        }
        if (d.missing.length)
          block.append(
            node('p', (d.legacy ? 'Ainda sem análise Gemini completa: ' : 'Não fornecidos pelo Gemini com evidência válida: ') + d.missing.map((k) => fieldLabels[k]).join(', ') + '. Os campos podem ser complementados pelo PDF e pelos catálogos.'),
          );
        if (d.discoveryMessage) block.append(node('p', d.discoveryMessage));
        if (d.modelCompletion?.filled?.length)
          block.append(node('p', 'Complemento pelo conhecimento do Gemini: ' + d.modelCompletion.filled.map((key) => fieldLabels[key] || key).join(', ') + '. Identificado na ficha como conhecimento do modelo, sem fonte externa verificada.'));
        for (const rejection of d.rejected) block.append(node('p', rejectionText(rejection)));
        for (const limitation of d.limitations) block.append(node('p', limitation));
        diagnostics.prepend(block);
      }
      for (const source of sources.filter((s) => s.enabled)) {
        const state = sourceState(source.id);
        if (!state || ['loading', 'error', 'cached'].includes(state.status)) continue;
        const returned = candidates.filter((c) => c.source === source.id),
          accepted = model.members.filter((c) => c.source === source.id);
        const fields = [...new Set(accepted.flatMap((c) => selectedFields(portugueseCandidate(c), {}).map((f) => f.key)).filter((k) => k !== 'title'))];
        diagnostics.append(
          node(
            'p',
            `${sourceNames[source.id] || source.name}: ${returned.length} candidato(s), ${accepted.length} correspondência(s) confirmada(s); ${fields.length ? fields.map((k) => fieldLabels[k]).join(', ') : 'sem metadados adicionais aplicáveis'}.`,
          ),
        );
        const reasons = disclosure('Campos sem evidência nesta fonte');
        for (const candidate of accepted) for (const [key, reason] of Object.entries(candidate.fieldReasons || {})) if (reason) reasons.append(node('p', `${fieldLabels[key] || key}: ${reason}`));
        if (reasons.childElementCount > 1) diagnostics.append(reasons);
      }
    }
    const pending = active || /^(?:Analisando|Análise em andamento|Lendo|Reconhecendo|Completando)/.test(knowledgeMessage);
    status.textContent = pending
      ? knowledgeMessage || resultSummary(results, sources, statuses, { pending: true })
      : knowledgeMessage ||
        (sourceFailure
          ? model.members.length
            ? 'Sugestões disponíveis. Não foi possível consultar as fontes externas.'
            : getRepository().mode === 'local'
              ? sourceFailure
              : 'Não foi possível pesquisar agora. Tente novamente.'
          : resultSummary(results, sources, statuses));
    if (!pending && !knowledgeMessage && knowledgeDiagnostic?.summary) status.textContent += (status.textContent ? ' ' : '') + knowledgeDiagnostic.summary;
    if (serverNotice) status.textContent += (status.textContent ? ' ' : '') + serverNotice;
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
      (async () => {
        const cached = await getRepository().findResearch?.(input, { signal: AbortSignal.timeout(1500) });
        if (n !== sequence || !canUse()) return;
        if (cached) snapshot = cached;
        for (const candidate of (cached?.candidates || []).filter((c) => c.source !== 'gemini')) if (!candidates.some((c) => c.source === candidate.source && c.id === candidate.id)) candidates.push(candidate);
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
    candidates = storedCatalogCandidates(current);
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
    search.disabled = true;
    search.setAttribute('aria-busy', 'true');
    status.textContent = 'Pesquisando…';
    let budget = AbortSignal.any([signal, AbortSignal.timeout(expanded ? 10000 : 7000)]);
    knowledgeMessage = '';
    const health = getRepository().session?.storageStatus;
    const combined = health?.profileMetadataProtocol >= 2 && health.knowledgeConfigured === true && health.manualAiEnabled === true;
    const research = {
      preferredLanguage: language.value,
      kind: kind.value,
      alternateTitles: [
        ...(current.sources?.catalog?.matches || []).flatMap((m) => m.names || []),
        ...(current.sources?.originalTitle?.excerpt ? [{ value: current.sources.originalTitle.excerpt, language: 'other' }] : []),
        ...String(aliasesInput?.value || '')
          .split('\n')
          .flatMap((line) => {
            const m = line.trim().match(/^(?:(pt-BR|pt|en|fr):\s*)?(.{2,160})$/i);
            return m ? [{ value: m[2], language: /^pt/i.test(m[1] || '') ? 'pt-BR' : (m[1] || 'other').toLowerCase() }] : [];
          }),
      ].slice(0, 6),
    };
    const knowledgeTask = Promise.resolve()
      .then(() => onPrepareDraft({ includePublic: true, research }))
      .catch((error) => {
        if (n === sequence) {
          knowledgeMessage = error.message;
          knowledgeDiagnostic = null;
        }
      });
    try {
      if (combined) {
        await loadSources(budget);
        const record = await knowledgeTask;
        if (signal.aborted || n !== sequence) return;
        if ((record?.status === 'running' || combinedProfileComplete(record?.knowledge, health?.profileEvidenceProtocol || 1)) && !expanded && !root.querySelector('[data-research-refresh]')?.checked) {
          for (const diagnostic of record?.knowledge?.diagnostics || [])
            if (['wikidata', 'wikipedia', 'bgg', 'ludopedia', 'publisher'].includes(diagnostic.source))
              statuses.set(diagnostic.source, {
                status: diagnostic.state === 'failed' ? 'error' : 'done',
                error: diagnostic.state === 'failed' ? 'Esta fonte não respondeu; os demais resultados foram preservados.' : '',
                candidates: candidates.filter((c) => c.source === diagnostic.source),
              });
          const latest = getCurrent();
          queryInput = { query: normalizedQuery(latest.title), edition: latest.edition || '', manualHash: latest.manual?.sha256 || '', preferredLanguage: language.value, kind: kind.value, fetchedAt: Date.now() };
          const completed = new Set((record?.knowledge?.diagnostics || []).map((d) => d.source));
          const complementary = sources.filter((source) => source.enabled && !completed.has(source.id));
          if (complementary.length) {
            const discoveryHints = record.profileDiscovery?.hints || record.knowledge?.profileAnalysis?.discovery?.hints || [];
            queryInput.alternateTitles = [...research.alternateTitles, ...discoveryHints].slice(0, 6);
            await parallelResearch(
              complementary,
              { action: 'search', ...queryInput, pdfLanguage: latest.language, alternateTitles: [...research.alternateTitles, ...discoveryHints].slice(0, 6) },
              (source, query, options) => getRepository().research(source, query, options),
              {
                signal: AbortSignal.any([signal, AbortSignal.timeout(7000)]),
                onUpdate: collect,
              },
            );
            await Promise.allSettled([...pendingDetails.values()]);
            if (signal.aborted || n !== sequence) return;
          }
          snapshot = researchSnapshot(queryInput, candidates, decisions);
          render();
          return;
        }
        budget = AbortSignal.any([signal, AbortSignal.timeout(expanded ? 10000 : 7000)]);
      }
      const input = { action: 'search', query: normalizedQuery(current.title), pdfLanguage: current.language, preferredLanguage: language.value, kind: kind.value, expanded, fetchedAt: Date.now() };
      input.alternateTitles = current.sources?.originalTitle ? [{ value: current.sources.originalTitle.excerpt, language: 'other' }] : [];
      input.edition = current.edition || '';
      input.publisher = current.sources?.publisher?.excerpt || '';
      input.year = current.sources?.year?.excerpt || '';
      input.gameId = current.id || '';
      input.manualHash = current.manual?.sha256 || '';
      input.alternateTitles.push(...(current.sources?.catalog?.matches || []).flatMap((match) => match.names || []));
      input.alternateTitles.push(...(draftKnowledgeCandidate?.identityHints || []));
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
        candidates = cached.candidates.filter((candidate) => candidate.source !== 'gemini');
        decisions = (cached.decisions || []).map((decision) => ({ ...decision, manualHash: decision.manualHash ?? cached.manualHash, edition: decision.edition ?? cached.edition }));
        render();
        if (cached.queryStrategyVersion >= RESEARCH_QUERY_VERSION) {
          await knowledgeTask;
          if (signal.aborted || n !== sequence) return;
          return;
        }
      }
      await loadSources(budget);
      if (signal.aborted || n !== sequence) return;
      if (input.query.length < 2) {
        status.textContent = 'Informe o nome do jogo para pesquisar.';
        return;
      }
      function collect(update) {
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
      }
      await parallelResearch(sources, input, (source, query, options) => getRepository().research(source, query, options), {
        signal: budget,
        onUpdate: collect,
      });
      const names = consolidateMetadata({ ...current, kind: kind.value }, candidates, chosenIdentity)
        .members.flatMap((c) => c.names || [])
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
      const hints = (draftKnowledgeCandidate?.identityHints || []).filter((h) => !input.alternateTitles.some((n) => n.value === h.value));
      if (hints.length && n === sequence && !signal.aborted) {
        input.alternateTitles = [...input.alternateTitles, ...hints].slice(0, 6);
        await parallelResearch(
          sources.filter((s) => ['wikidata', 'wikipedia'].includes(s.id)),
          input,
          (source, query, options) => getRepository().research(source, query, options),
          { signal: AbortSignal.any([signal, AbortSignal.timeout(4500)]), onUpdate: collect },
        );
      }
      await Promise.allSettled([...pendingDetails.values()]);
      if (n === sequence && !signal.aborted) {
        try {
          snapshot = researchSnapshot(input, candidates, decisions);
          void getRepository()
            .saveResearch?.(snapshot)
            ?.catch(() => {
              if (n === sequence && !signal.aborted) status.textContent += ' Não foi possível guardar a pesquisa para outros dispositivos.';
            });
        } catch {
          status.textContent += ' Não foi possível guardar esta pesquisa; as sugestões continuam disponíveis.';
        }
      }
      if (!sources.some((s) => s.enabled)) render();
    } finally {
      await knowledgeTask;
      if (n === sequence) {
        active = false;
        render();
        cancel.hidden = detailActive || ocrActive ? false : true;
        search.disabled = false;
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
  search.onclick = () => {
    if (!active)
      void run(false).catch((error) => {
        sourceFailure = error.message;
        render();
      });
  };
  cancel.onclick = () => {
    cancelWork('Operação cancelada.');
    onCancel();
  };
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
    invalidate({ identityChanged: false });
  };
  kind.onchange = () => invalidate({ identityChanged: false });
  function invalidate({ identityChanged = true } = {}) {
    onInvalidate();
    snapshot = queryInput = null;
    decisions = [];
    chosenIdentity = null;
    cancelWork('Dados da busca alterados. Pesquise novamente.');
    if (identityChanged) candidates = [];
    if (identityChanged) {
      draftKnowledgeCandidate = null;
      knowledgeDiagnostic = null;
      knowledgeMessage = '';
    }
    ocrCandidate = pdfMetadataCandidate(getCurrent());
    statuses.clear();
    appliedCandidates.clear();
    notifySuggestions();
    list.replaceChildren();
    review.hidden = true;
    render();
  }
  return {
    snapshot: () => snapshot,
    confirmFields,
    reset,
    run,
    loadExisting,
    runOcr,
    cancel: cancelWork,
    setKnowledgeStatus(message) {
      knowledgeMessage = message;
      if (canUse()) {
        render();
        cancel.hidden = !active && !/Analisando|andamento|Lendo|Reconhecendo|Completando/.test(message);
      }
    },
    invalidate,
    acceptPdf(candidate) {
      if (canUse()) {
        ocrCandidate = candidate;
        render();
      }
    },
    acceptKnowledge(record, game) {
      if (!canUse()) return;
      const current = getCurrent();
      const target = {
        ...current,
        documents: Object.fromEntries(
          getDocuments(current)
            .filter((d) => d.manual)
            .map((d) => [d.id, d]),
        ),
      };
      const matches = informationIdentity(game) === informationIdentity(current, '', getDocuments(current)) && knowledgeMatchesIdentity(record?.knowledge, target);
      const candidate = matches ? savedKnowledgeCandidate(record, target) : null;
      draftKnowledgeCandidate = candidate;
      knowledgeDiagnostic = profileDiagnostic(record, candidate);
      candidates = candidates.filter((c) => c.source !== 'gemini' && !c.fromKnowledge);
      if (matches)
        for (const source of record?.knowledge?.sources || []) {
          if (!source.profileOnly || !profileSourceMatches(source, getDocuments(current)) || !['wikidata', 'wikipedia', 'bgg', 'ludopedia'].includes(source.catalogSource)) continue;
          const item = {
            source: source.catalogSource,
            fromKnowledge: true,
            id: source.catalogId,
            identifiers: source.identifiers,
            identityEvidence: source.identityEvidence,
            publicationYear: source.publicationYear,
            creators: source.creators || [],
            needsDetail: false,
            names: source.originalTitles || [],
            fields: Object.fromEntries(Object.entries(source.facts || {}).filter(([key]) => key in profileDefinitions && !(source.profileSpecificEligible === false && (profileDefinitions[key].type === 'integer' || key === 'edition')))),
            language: source.language,
            descriptionLanguage: source.language,
            url: source.url,
            license: source.license,
            licenseUrl: source.licenseUrl,
            authorsUrl: source.authorsUrl,
            fieldEvidence: source.fieldEvidence || {},
            ...(source.attributionLogo ? { attributionLogo: source.attributionLogo } : {}),
            kind: source.kind || 'unknown',
            edition: source.edition || '',
            manualHash: current.manual.sha256,
            conflicts: [],
          };
          candidates = candidates.filter((c) => c.source !== item.source || c.id !== item.id);
          candidates.push(item);
        }
      render();
    },
    isBusy: () => active || ocrActive,
  };
}
