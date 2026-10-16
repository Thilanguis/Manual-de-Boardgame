import { gameDocuments, findDocument, primaryDocumentId, documentGame } from './documents.js';
import { fileErrorMessage } from './file-errors.js';
import { extendOcrIndex, pendingOcrPages, ocrCoverage } from './pdf-knowledge.js';
import { emptyGuide, cleanGuide, SECTION_TYPES, staleSection } from './guide-model.js';
import { analyzePdf, suggestedSections, packIndex, unpackIndex, indexMatches } from './pdf-index.js';
import { createTextTranslator, translateIndex, translatedValue, isPortuguese } from './translation.js';
import { imageToJpeg } from './pdf.js';
import { cachedIndex, indexCacheKey } from './index-cache.js';
const el = (tag, text, className) => {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (className) e.className = className;
  return e;
};
const button = (text, fn, className = 'button secondary small') => {
  const b = el('button', text, className);
  b.type = 'button';
  b.onclick = fn;
  return b;
};
const $ = (id) => document.getElementById(id);
export function formattedText(target, text) {
  for (const line of String(text || '').split('\n')) {
    const p = el('p');
    for (const part of line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)) {
      if (/^\*\*[^*]+\*\*$/.test(part)) p.append(el('strong', part.slice(2, -2)));
      else if (/^\*[^*]+\*$/.test(part)) p.append(el('em', part.slice(1, -1)));
      else p.append(document.createTextNode(part));
    }
    target.append(p);
  }
}
export function createGuidePanel({ repository, openManual, onNotice, scope, getPreparation = () => null }) {
  const dialog = $('guide-dialog'),
    view = $('guide-content'),
    status = $('guide-status');
  let game,
    guide,
    published,
    index,
    indexes = [],
    knowledge = null,
    indexNotice = '',
    selectedDocumentId,
    editor = false,
    busy = false,
    dirty = false,
    sequence = 0,
    controller,
    translator,
    indexDirty = false,
    returnFocus,
    sessionUid = repository.session.user?.uid;
  const urls = new Map(),
    receipts = [];
  let indexLoadSequence = 0;
  const searchWorker = new Worker(new URL('./rule-search-worker.js', import.meta.url), { type: 'module' });
  let searchSequence = 0,
    workerIndex,
    workerGuide,
    workerHash,
    workerRevision,
    searchTimer;
  searchWorker.onmessage = ({ data }) => {
    if (data.id !== searchSequence || !dialog.open || editor || $('guide-search').hidden) return;
    if (data.error) message(data.error);
    else renderResults(data.results);
  };
  searchWorker.onerror = () => message('A pesquisa não ficou pronta. Reabra o guia e tente novamente.');
  window.addEventListener('beforeunload', (event) => {
    if (dirty || busy) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  const activeDocument = () => findDocument(game, selectedDocumentId || primaryDocumentId(game));
  const activeGame = () => documentGame(game, activeDocument());
  const cacheKey = () => indexCacheKey(scope, repository.session.user?.uid, activeGame());
  async function loadIndexes() {
    const token = sequence,
      load = ++indexLoadSequence;
    const entries = await Promise.all(
      gameDocuments(game).map(async (document) => {
        try {
          return { document, index: await repository.getTechnicalIndex(game, document) };
        } catch (error) {
          return { document, index: null, error };
        }
      }),
    );
    if (token !== sequence || load !== indexLoadSequence) return;
    indexes = entries.filter((entry) => indexMatches(entry.index, documentGame(game, entry.document)));
    const failed = entries.filter((entry) => entry.error);
    indexNotice = failed.length ? `Não foi possível pesquisar ${failed.length === 1 ? 'um documento' : 'alguns documentos'}. ${fileErrorMessage(failed[0].error)}` : '';
    const ready = indexes.find((entry) => entry.document.id === selectedDocumentId);
    if (ready && !indexDirty) index = ready.index;
    workerIndex = undefined;
  }
  const progressKey = () => `acervo-guide-progress:${scope}:${repository.session.user?.uid || 'visitor'}:${game.id}`;
  const message = (text) => {
    status.textContent = text;
    status.hidden = !text;
  };
  function setBusy(value) {
    busy = value;
    dialog.setAttribute('aria-busy', String(value));
    for (const b of dialog.querySelectorAll('[data-mutate], .guide-editor-section input, .guide-editor-section textarea, .guide-editor-section select')) b.disabled = value || b.dataset.limitDisabled === 'true';
    $('guide-cancel-analysis').hidden = !value || !controller;
    if (!value && game) contextNotice();
  }
  function mutation(text, fn, className) {
    const b = button(text, () => act(fn), className);
    b.dataset.mutate = '';
    b.disabled = busy;
    return b;
  }
  async function act(fn) {
    if (busy) return;
    const token = sequence;
    try {
      await fn();
    } catch (error) {
      if (token === sequence) message(error.message);
    }
  }
  function release() {
    for (const u of urls.values()) URL.revokeObjectURL(u);
    urls.clear();
  }
  function close(force = false) {
    if (busy && !controller && !force) {
      message('Aguarde o salvamento terminar.');
      return false;
    }
    if (dirty && !force && !window.confirm('Há alterações não salvas no guia. Fechar e descartar essas alterações?')) return false;
    ++sequence;
    ++searchSequence;
    clearTimeout(searchTimer);
    searchWorker.postMessage({ type: 'context', index: null, guide: null, currentHash: '' });
    workerIndex = workerGuide = workerHash = undefined;
    controller?.abort();
    translator?.destroy();
    controller = null;
    for (const r of receipts.splice(0)) repository.discardGuideAsset(r).catch(() => {});
    release();
    dialog.close();
    document.body.classList.remove('modal-open');
    returnFocus?.focus();
    busy = dirty = false;
    view.replaceChildren();
    $('guide-search').value = '';
    $('guide-title').textContent = '';
    message('');
    game = guide = published = index = knowledge = null;
    indexes = [];
    return true;
  }
  $('guide-close').onclick = () => close();
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  $('guide-cancel-analysis').onclick = () => controller?.abort();
  $('guide-search').oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderSearch, 150);
  };
  const maySwitch = () => {
    if (dirty || busy) {
      message('Salve o rascunho ou conclua a operação antes de mudar de modo.');
      return false;
    }
    return true;
  };
  $('guide-tab-learn').onclick = () => {
    if (!maySwitch()) return;
    editor = false;
    guide = published;
    renderReader();
  };
  $('guide-tab-quick').onclick = () => {
    if (!maySwitch()) return;
    editor = false;
    guide = published;
    renderSearch();
  };
  $('guide-analyze').onclick = () => act(analyze);
  $('guide-ocr').onclick = () => act(() => analyze(true));
  $('guide-translate').onclick = () => act(translate);
  function stale(g = guide) {
    return g?.sections.some((s) => staleSection(game, s, g.sourceHash));
  }
  function pageButton(page, hash, documentId = selectedDocumentId || primaryDocumentId(game)) {
    const targetGame = game;
    const b = button(`Ver no manual · p. ${page}`, () => {
      if (close()) openManual(targetGame, { page, documentId, sourceHash: hash });
    });
    b.disabled = hash !== findDocument(game, documentId)?.manual.sha256;
    b.title = b.disabled ? 'O PDF foi substituído. Referência aguardando revisão.' : 'Abrir esta página do PDF oficial';
    return b;
  }
  async function image(id, parent, caption) {
    const token = sequence;
    try {
      if (!urls.has(id)) {
        const blob = await repository.getGuideAsset(game, id);
        if (token !== sequence || !parent.isConnected) return;
        if (!urls.has(id)) urls.set(id, URL.createObjectURL(blob));
      }
      if (token !== sequence) return;
      const img = el('img');
      img.src = urls.get(id);
      img.alt = caption || 'Ilustração do guia';
      img.loading = 'lazy';
      const figure = el('figure');
      figure.append(img);
      if (caption) figure.append(el('figcaption', caption));
      parent.append(figure);
    } catch {
      if (token === sequence) parent.append(el('p', 'Imagem indisponível.', 'muted-text'));
    }
  }
  function renderSection(s, parent, hash) {
    const article = el('details', '', `guide-section guide-${s.type}`),
      summary = el('summary', isPortuguese(s.language || 'pt-BR') ? s.title : 'Seção aguardando tradução');
    article.id = `guide-section-${s.id}`;
    article.open = true;
    article.append(summary);
    const content = el('div', '', 'guide-section-body');
    if (s.translationPending || !isPortuguese(s.language || 'pt-BR')) content.append(el('p', 'Tradução para português pendente. Consulte o texto original ou o PDF.'));
    else if (s.type === 'lista') {
      const list = el('ul');
      for (const line of s.text.split('\n').filter(Boolean)) {
        const li = el('li');
        formattedText(li, line.replace(/^[-*]\s*/, ''));
        list.append(li);
      }
      content.append(list);
    } else formattedText(content, s.text);
    if (s.originalText && !isPortuguese(s.sourceLanguage || 'pt-BR')) {
      const original = el('details');
      original.append(el('summary', 'Texto original'), el('p', s.originalText));
      content.append(original);
    }
    if (s.imageId) image(s.imageId, content, s.caption);
    if (s.page) content.append(pageButton(s.page, s.sourceHash || hash, s.documentId || 'main'));
    if (s.source) {
      const origin = el('details');
      origin.append(el('summary', 'Origem'), el('p', s.source));
      if (s.sourceLicense) origin.append(el('p', `${s.sourceLicense} · texto adaptado e revisado`));
      for (const [label, url] of [
        ['Fonte', s.sourceUrl],
        ['Autores', s.sourceAuthors],
        ['Licença', s.sourceLicenseUrl],
      ])
        if (url) {
          const link = el('a', label);
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          origin.append(link, document.createTextNode(' '));
        }
      content.append(origin);
    }
    article.append(content);
    summary.addEventListener('click', () => {
      if (dialog.open)
        try {
          localStorage.setItem(progressKey(), s.id);
        } catch {}
    });
    parent.append(article);
  }
  function contextNotice() {
    $('guide-stale').hidden = !stale(published) && !(editor && stale());
    $('guide-stale').textContent = 'O PDF foi substituído. O guia foi preservado, mas as referências de páginas precisam ser revisadas. Os links antigos estão desativados.';
    $('guide-analyze').hidden = !repository.canPrepare(game);
    $('guide-ocr').hidden = !repository.canPrepare(game);
    const automatic = ['waiting', 'analyzing', 'ocr', 'translating'].includes(getPreparation(game, selectedDocumentId)?.state);
    const coverage = index && ocrCoverage(index);
    $('guide-ocr').hidden = !repository.canPrepare(game) || !index || index.analysisComplete === false || (!coverage.pending && !coverage.failed);
    if (index) $('guide-ocr').textContent = coverage.pending ? 'Ler páginas escaneadas' : 'Tentar páginas não legíveis';
    $('guide-analyze').textContent = !index ? 'Analisar PDF completo' : index.analysisComplete === false ? 'Retomar análise do PDF' : 'PDF analisado';
    $('guide-analyze').dataset.limitDisabled = String(automatic || (!!index && index.analysisComplete !== false));
    $('guide-ocr').dataset.limitDisabled = String(automatic);
    $('guide-ocr').disabled = busy || automatic;
    $('guide-analyze').disabled = busy || $('guide-analyze').dataset.limitDisabled === 'true';
    $('guide-analyze').title = automatic ? 'Este documento está sendo preparado.' : index && index.analysisComplete !== false ? 'A análise salva já está sendo utilizada.' : '';
    const foreign = index && !isPortuguese(index.language || game.language);
    $('guide-translate').hidden = !repository.canPrepare(game) || !foreign || !index.pages.some((p) => p.text.trim() && !translatedValue(p.translation, p.text));
    $('guide-translate').dataset.limitDisabled = String(automatic || !globalThis.Translator);
    $('guide-translate').disabled = busy || automatic || !globalThis.Translator;
    $('guide-translation-note').hidden = !foreign;
    $('guide-translation-note').textContent = !globalThis.Translator
      ? 'Tradução local indisponível neste navegador. Você pode escrever a versão em português no rascunho.'
      : 'A tradução ocorre neste dispositivo e pode baixar um pacote de idioma. Confira as regras no manual.';
    // Preparação e recuperação ficam exclusivamente em Gerenciar jogo → Documentos.
    for (const id of ['guide-analyze', 'guide-ocr', 'guide-translate', 'guide-translation-note', 'guide-cancel-analysis']) $(id).hidden = true;
  }
  function renderReader() {
    ++searchSequence;
    $('guide-search').hidden = true;
    view.replaceChildren();
    contextNotice();
    if (!guide?.sections?.length) {
      view.append(el('p', 'Este jogo ainda não tem um guia publicado.'));
      return;
    }
    const nav = el('nav', '', 'guide-index');
    nav.setAttribute('aria-label', 'Índice do guia');
    for (const s of guide.sections)
      nav.append(
        button(s.title, () => {
          const section = $(`guide-section-${s.id}`);
          section.open = true;
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
          try {
            localStorage.setItem(progressKey(), s.id);
          } catch {}
        }),
      );
    const contents = el('details', '', 'guide-contents');
    contents.open = !window.matchMedia('(max-width: 600px)').matches;
    contents.append(el('summary', `Índice do guia · ${guide.sections.length} seções`), nav);
    view.append(contents);
    for (const s of guide.sections) renderSection(s, view, guide.sourceHash);
    try {
      const saved = localStorage.getItem(progressKey());
      if (saved && guide.sections.some((s) => s.id === saved)) view.prepend(button('Retomar última seção', () => $(`guide-section-${saved}`).scrollIntoView({ behavior: 'smooth', block: 'start' })));
    } catch {}
  }
  function renderSearch() {
    $('guide-search').hidden = false;
    view.replaceChildren();
    contextNotice();
    const id = ++searchSequence;
    if (!indexes.length && !index && !knowledge?.sections.length) view.append(el('p', 'Ainda não há conteúdo preparado para pesquisa. O PDF original continua disponível.'));
    if (!$('guide-search').value.trim()) {
      if (index || indexes.length) {
        view.append(el('p', 'Pesquise uma palavra ou expressão, ou escolha um assunto.'));
        for (const entry of indexes.length ? indexes : [{ index, document: activeDocument() }])
          for (const h of entry.index.headings.slice(0, 160)) {
            const row = el('div', '', 'guide-topic');
            row.append(el('small', entry.document.name));
            row.append(el('strong', translatedValue(h.translation, h.title) || (isPortuguese(entry.index.language || 'pt-BR') ? h.title : h.category || `Página ${h.page}`)), pageButton(h.page, entry.index.sourceHash, entry.document.id));
            view.append(row);
          }
      }
      return;
    }
    if (workerIndex !== index || workerRevision !== index?.revision || workerGuide !== published || workerHash !== game.manual.sha256) {
      searchWorker.postMessage({ type: 'context', index, indexes, documents: gameDocuments(game), guide: published, knowledge, currentHash: game.manual.sha256 });
      workerIndex = index;
      workerGuide = published;
      workerHash = game.manual.sha256;
      workerRevision = index?.revision;
    }
    view.append(el('p', 'Pesquisando regras…', 'muted-text'));
    searchWorker.postMessage({ type: 'query', id, query: $('guide-search').value });
  }
  function renderResults(results) {
    view.replaceChildren(el('p', results.length ? `${results.length} resultados${results.length === 60 ? ' mais relevantes' : ''}.` : 'Não encontramos uma informação sustentada para esta pesquisa.'));
    for (const r of results) {
      const card = el('article', '', 'rule-result');
      card.append(el('h3', r.title), el('small', r.source));
      // Escolhe um trecho próximo da busca sem executar HTML do PDF.
      const at = r.text.toLocaleLowerCase().indexOf($('guide-search').value.toLocaleLowerCase()),
        begin = Math.max(0, at - 100);
      card.append(el('p', r.needsTranslation ? 'Tradução pendente. Consulte o texto original ou a página do manual.' : `${begin ? '…' : ''}${r.text.slice(begin, begin + 650)}${r.text.length > begin + 650 ? '…' : ''}`));
      if (r.translated) card.append(el('small', 'Tradução automática · confira no manual'));
      if (r.needsTranslation || r.translated) {
        const original = el('details');
        original.append(el('summary', 'Texto original'), el('p', r.originalText));
        card.append(original);
      }
      if (r.documentName) card.append(el('small', r.documentName));
      if (r.editionUnconfirmed) card.append(el('small', 'Informação geral da obra · edição não confirmada'));
      if (r.sourceUrl) {
        const link = el('a', `Fonte · ${r.sourceLicense} ↗`);
        link.href = r.sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        card.append(link);
        if (r.sourceAuthors) {
          const authors = el('a', 'Autores e histórico ↗');
          authors.href = r.sourceAuthors;
          authors.target = '_blank';
          authors.rel = 'noopener noreferrer';
          card.append(authors);
        }
      }
      if (r.page) card.append(pageButton(r.page, r.sourceHash || game.manual.sha256, r.documentId));
      if (r.sectionId)
        card.append(
          button('Abrir seção do guia', () => {
            guide = published;
            renderReader();
            $(`guide-section-${r.sectionId}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
          }),
        );
      view.append(card);
    }
  }
  function inputField(label, name, value, kind = 'input') {
    const wrapper = el('label', label),
      field = el(kind);
    field.name = name;
    field.value = value ?? '';
    wrapper.append(field);
    return wrapper;
  }
  function readEditor() {
    if (!editor || !view.querySelector('.guide-editor-actions')) return;
    guide.sections = [...view.querySelectorAll('.guide-editor-section')].map((row) => {
      const s = { ...guide.sections.find((s) => s.id === row.dataset.id) };
      for (const name of ['title', 'text', 'type', 'page', 'caption']) s[name] = row.querySelector(`[name=${name}]`).value;
      const previous = guide.sections.find((s) => s.id === row.dataset.id);
      if (s.text.trim() && s.text !== previous.text) {
        s.translationPending = false;
        s.language = 'pt-BR';
        s.translationMethod = 'manual';
      }
      s.reviewed = row.querySelector('[name=reviewed]').checked;
      return s;
    });
  }
  function renderEditor() {
    ++searchSequence;
    $('guide-search').hidden = true;
    view.replaceChildren();
    contextNotice();
    const actions = el('div', '', 'guide-editor-actions');
    actions.append(
      mutation('Nova seção', () => {
        readEditor();
        guide.sections.push({ id: crypto.randomUUID(), documentId: selectedDocumentId, sourceHash: activeDocument().manual.sha256, title: 'Nova seção', text: '', type: 'texto', reviewed: false, page: null, imageId: '', caption: '' });
        dirty = true;
        renderEditor();
      }),
      mutation('Salvar rascunho', save),
      mutation('Pré-visualizar', () => {
        readEditor();
        const clean = cleanGuide(guide);
        view.replaceChildren(button('Voltar ao editor', renderEditor));
        for (const s of clean.sections) renderSection(s, view, clean.sourceHash);
      }),
      mutation('Publicar guia', publish, 'button primary small'),
    );
    if (stale())
      actions.append(
        mutation('Revisar referências para o PDF atual', () => {
          readEditor();
          guide.sourceHash = game.manual.sha256;
          guide.sections.forEach((s) => {
            if (staleSection(game, s, guide.sourceHash)) {
              const doc = findDocument(game, s.documentId || 'main');
              if (doc) {
                s.sourceHash = doc.manual.sha256;
                s.reviewed = false;
              }
            }
          });
          dirty = true;
          renderEditor();
          message('Confira cada página no PDF atual e marque novamente as seções revisadas.');
        }),
      );
    const docSelect = el('select');
    docSelect.setAttribute('aria-label', 'Documento das sugestões');
    for (const doc of gameDocuments(game)) {
      const opt = el('option', doc.name);
      opt.value = doc.id;
      opt.selected = doc.id === selectedDocumentId;
      docSelect.append(opt);
    }
    docSelect.onchange = async () => {
      readEditor();
      selectedDocumentId = docSelect.value;
      index = indexes.find((entry) => entry.document.id === selectedDocumentId)?.index || (await cachedIndex(cacheKey()));
      indexDirty = false;
      renderEditor();
    };
    view.append(docSelect);
    view.append(actions, el('p', 'Sugestões são trechos extraídos, não resumos. Edite para ensinar o jogo e confirme cada seção. Formatação: **negrito**, *itálico*. Para listas, use uma linha por item.', 'muted-text'));
    if (knowledge?.sections.some((s) => s.review !== 'rejected'))
      view.append(
        mutation('Adicionar sugestões do conhecimento', () => {
          readEditor();
          let count = 0;
          for (const section of knowledge.sections.filter((s) => s.review !== 'rejected')) {
            const source = knowledge.sources.find((s) => s.id === section.sourceId);
            if (!source || guide.sections.some((s) => s.originalText === section.text && s.sourceUrl === source.url) || guide.sections.length >= 100) continue;
            guide.sections.push({
              id: crypto.randomUUID(),
              title: section.title,
              text: section.text,
              originalText: section.text,
              type: 'texto',
              page: null,
              documentId: selectedDocumentId,
              sourceHash: '',
              reviewed: false,
              language: 'pt-BR',
              source: 'Síntese Gemini · revisar',
              sourceUrl: source.url,
              sourceLicense: source.license,
              sourceAuthors: source.authorsUrl || '',
              sourceLicenseUrl: source.licenseUrl || '',
            });
            count++;
          }
          if (!count) throw new Error('As sugestões disponíveis já estão no rascunho.');
          dirty = true;
          renderEditor();
          message('Sugestões adicionadas. Revise antes de publicar.');
        }),
      );
    if (game.description && game.sources?.description?.confirmedAt)
      view.append(
        mutation('Adicionar visão geral revisada', () => {
          readEditor();
          if (guide.sections.some((section) => section.title === 'Visão geral')) throw new Error('O guia já tem uma visão geral. Edite a seção existente.');
          guide.sections.push({
            id: crypto.randomUUID(),
            title: 'Visão geral',
            text: game.description,
            type: 'texto',
            reviewed: false,
            page: null,
            source: `Informação de catálogo · ${game.sources.description.source}`,
            sourceUrl: game.sources.description.url || '',
            sourceLicense: game.sources.description.license || '',
            sourceAuthors: game.sources.description.authorsUrl || '',
            sourceLicenseUrl: game.sources.description.licenseUrl || '',
            imageId: '',
            caption: '',
          });
          dirty = true;
          renderEditor();
        }),
      );
    if (indexes.length > 1)
      view.append(
        mutation('Adicionar sugestões de todos os documentos', () => {
          readEditor();
          const existing = new Set(guide.sections.map((s) => `${s.documentId || 'main'}:${s.sourceHash || guide.sourceHash}:${s.page}:${s.originalTitle || s.title}`));
          for (const entry of indexes)
            for (const suggestion of suggestedSections(entry.index)) {
              const id = `${suggestion.documentId}:${suggestion.sourceHash}:${suggestion.page}:${suggestion.originalTitle || suggestion.title}`;
              if (existing.has(id) || guide.sections.length >= 100) continue;
              try {
                cleanGuide({ ...guide, sections: [...guide.sections, suggestion] });
              } catch {
                break;
              }
              guide.sections.push(suggestion);
              existing.add(id);
            }
          dirty = true;
          renderEditor();
          message('Trechos adicionados. Revise as explicações e as referências antes de publicar.');
        }),
      );
    if (index?.pages.some((p) => p.text.trim().length >= 40))
      view.append(
        mutation('Adicionar sugestões do PDF ao rascunho', () => {
          readEditor();
          if (stale()) throw new Error('Revise as referências do PDF atual antes de acrescentar sugestões.');
          const existing = new Set(guide.sections.map((s) => `${s.documentId || 'main'}:${s.sourceHash || guide.sourceHash}:${s.page}:${s.originalTitle || s.title}`));
          const additions = suggestedSections(index).filter((s) => !existing.has(`${s.documentId || 'main'}:${s.sourceHash || guide.sourceHash}:${s.page}:${s.originalTitle || s.title}`));
          if (!additions.length) throw new Error('Os trechos disponíveis já estão no rascunho. Suas edições foram preservadas.');
          let added = 0;
          for (const suggestion of additions) {
            if (guide.sections.length >= 100) break;
            try {
              cleanGuide({ ...guide, sections: [...guide.sections, suggestion] });
            } catch {
              break;
            }
            guide.sections.push(suggestion);
            added++;
          }
          if (!added) throw new Error('O rascunho está cheio. Organize as seções antes de acrescentar outras; o índice completo continua na Consulta rápida.');
          dirty = true;
          renderEditor();
          message(`${added} sugestões adicionadas. Revise antes de publicar.${added < additions.length ? ' Os demais trechos continuam na Consulta rápida.' : ''}`);
        }),
      );
    for (const [i, s] of guide.sections.entries()) {
      const row = el('fieldset', '', 'guide-editor-section');
      row.dataset.id = s.id;
      row.append(el('legend', `Seção ${i + 1}`));
      row.append(inputField('Título', 'title', s.title), inputField('Texto / resposta', 'text', s.text, 'textarea'));
      if (s.translationPending) row.append(el('p', 'Escreva a versão em português ou traduza o índice antes de incluir uma nova sugestão.', 'guide-warning'));
      if (s.originalText) {
        const original = el('details');
        original.append(el('summary', 'Trecho original e referência'), el('p', s.originalText));
        row.append(original);
      }
      row.querySelector('textarea').rows = 6;
      row.querySelector('[name=title]').maxLength = 160;
      row.querySelector('[name=text]').maxLength = 20000;
      const type = inputField('Apresentação', 'type', '', 'select'),
        select = type.querySelector('select');
      for (const t of SECTION_TYPES) {
        const opt = el('option', t);
        opt.value = t;
        select.append(opt);
      }
      select.value = s.type;
      row.append(type);
      const page = inputField('Página física do PDF (opcional)', 'page', s.page);
      page.querySelector('input').type = 'number';
      page.querySelector('input').min = 1;
      page.querySelector('input').max = findDocument(game, s.documentId || 'main')?.manual.pages || game.manual.pages;
      row.append(page);
      const imageInput = inputField('Ilustração (JPEG, PNG ou WebP)', 'image', '', 'input'),
        file = imageInput.querySelector('input');
      file.type = 'file';
      file.accept = 'image/jpeg,image/png,image/webp';
      file.dataset.mutate = '';
      file.onchange = () =>
        act(async () => {
          readEditor();
          const item = guide.sections.find((v) => v.id === s.id),
            selected = file.files[0],
            token = sequence,
            activeGame = game;
          if (!selected) return;
          if (selected.size > 12 * 1024 * 1024) throw new Error('Selecione uma imagem de até 12 MB.');
          setBusy(true);
          try {
            const jpeg = await imageToJpeg(selected),
              receipt = await repository.uploadGuideAsset(activeGame, jpeg, `${activeGame.title} — ${item.title}.jpg`, (p) => {
                if (token === sequence) message(`Enviando imagem: ${p}%`);
              });
            if (token !== sequence) {
              await repository.discardGuideAsset(receipt).catch(() => {});
              return;
            }
            receipts.push(receipt);
            item.imageId = receipt.driveFileId;
            item.reviewed = false;
            guide.assets[receipt.driveFileId] = { mimeType: 'image/jpeg' };
            urls.set(receipt.driveFileId, URL.createObjectURL(jpeg));
            dirty = true;
            renderEditor();
            message('Imagem enviada. Salve o rascunho para vinculá-la ao guia.');
          } finally {
            if (token === sequence) setBusy(false);
          }
        });
      row.append(imageInput, inputField('Legenda / descrição da imagem', 'caption', s.caption));
      if (s.imageId) {
        image(s.imageId, row, s.caption);
        row.append(
          mutation('Remover ilustração da seção', () => {
            readEditor();
            guide.sections[i].imageId = '';
            guide.sections[i].reviewed = false;
            dirty = true;
            renderEditor();
          }),
        );
      }
      const reviewed = inputField('Revisei esta explicação e suas referências', 'reviewed', '', 'input');
      reviewed.className = 'check-row';
      reviewed.querySelector('input').type = 'checkbox';
      reviewed.querySelector('input').checked = s.reviewed;
      row.append(reviewed);
      const controls = el('div', '', 'guide-section-controls');
      for (const [label, direction] of [
        ['Subir', -1],
        ['Descer', 1],
      ]) {
        const b = mutation(label, () => {
          readEditor();
          const next = i + direction;
          [guide.sections[i], guide.sections[next]] = [guide.sections[next], guide.sections[i]];
          dirty = true;
          renderEditor();
        });
        b.disabled = i + direction < 0 || i + direction >= guide.sections.length;
        b.dataset.limitDisabled = String(b.disabled);
        controls.append(b);
      }
      controls.append(
        mutation('Remover seção', () => {
          readEditor();
          guide.sections.splice(i, 1);
          dirty = true;
          renderEditor();
        }),
      );
      if (s.page) controls.append(pageButton(Number(s.page), s.sourceHash || guide.sourceHash, s.documentId || 'main'));
      const docReference = inputField('Documento da referência', 'documentId', '', 'select');
      const selector = docReference.querySelector('select');
      for (const doc of gameDocuments(game)) {
        const opt = el('option', doc.name);
        opt.value = doc.id;
        opt.selected = doc.id === (s.documentId || 'main');
        selector.append(opt);
      }
      selector.onchange = () => {
        readEditor();
        const section = guide.sections.find((item) => item.id === s.id);
        section.documentId = selector.value;
        section.sourceHash = findDocument(game, selector.value).manual.sha256;
        section.reviewed = false;
        dirty = true;
        renderEditor();
      };
      row.append(docReference);
      row.append(controls);
      row.addEventListener('input', (event) => {
        dirty = true;
        if (event.target.name !== 'reviewed') row.querySelector('[name=reviewed]').checked = false;
      });
      view.append(row);
    }
  }
  async function save() {
    readEditor();
    cleanGuide(guide);
    const tokenBeforeUpload = sequence;
    setBusy(true);
    try {
      await persistIndex();
    } finally {
      if (tokenBeforeUpload === sequence) setBusy(false);
    }
    if (tokenBeforeUpload !== sequence) return false;
    const clean = cleanGuide(guide),
      token = sequence,
      activeGame = game,
      pending = [...receipts];
    setBusy(true);
    message('Salvando rascunho privado…');
    try {
      const saved = await repository.saveGuide(activeGame, clean);
      for (const receipt of pending) {
        try {
          await repository.finalizeGuideAsset(receipt);
          if (receipts.includes(receipt)) receipts.splice(receipts.indexOf(receipt), 1);
        } catch {
          onNotice('Rascunho salvo. A finalização de um arquivo precisa ser tentada novamente.');
        }
      }
      if (token !== sequence) return false;
      guide = saved;
      dirty = false;
      renderEditor();
      message('Rascunho salvo. A versão publicada anterior continua disponível.');
      return true;
    } finally {
      if (token === sequence) setBusy(false);
    }
  }
  async function publish() {
    readEditor();
    const clean = cleanGuide(guide);
    if (!clean.reviewed) throw new Error('Marque todas as seções como revisadas antes de publicar.');
    if (stale(clean)) throw new Error('Revise as referências do PDF atual antes de publicar.');
    const token = sequence;
    if (!(await save()) || token !== sequence) return;
    setBusy(true);
    try {
      const next = await repository.publishGuide(game, guide, published?.revision || 0);
      if (token !== sequence) return;
      published = next;
      message('Guia publicado. As alterações agora estão disponíveis no Acervo.');
      onNotice('Guia publicado.');
    } finally {
      if (token === sequence) setBusy(false);
    }
  }
  async function persistIndex() {
    if (!indexDirty || !index || !editor) return;
    const token = sequence,
      activeGame = game;
    if (repository.saveTechnicalIndex) {
      await repository.saveTechnicalIndex(game, activeDocument(), index, { state: ocrCoverage(index).failed || ocrCoverage(index).pending ? 'partial' : 'ready' });
      indexDirty = false;
      index.unsavedChanges = false;
      await cachedIndex(cacheKey(), index);
      await loadIndexes();
      return;
    }
    const packed = await packIndex(index);
    const receipt = await repository.uploadGuideAsset(activeGame, packed, `${activeGame.title} — índice de regras.json.gz`, (p) => {
      if (token === sequence) message(`Salvando consulta rápida: ${p}%`);
    });
    if (token !== sequence) {
      await repository.discardGuideAsset(receipt).catch(() => {});
      return;
    }
    receipts.push(receipt);
    if (guide.indexFileId && guide.indexFileId !== receipt.driveFileId) delete guide.assets[guide.indexFileId];
    guide.assets[receipt.driveFileId] = { mimeType: 'application/gzip' };
    guide.indexFileId = receipt.driveFileId;
    index.savedAssetId = receipt.driveFileId;
    index.unsavedChanges = false;
    indexDirty = false;
    await cachedIndex(cacheKey(), index);
  }
  function processingOptions(signal, token, key) {
    return {
      signal,
      checkpoint: async (partial) => {
        if (token !== sequence) return;
        index = partial;
        indexDirty = true;
        index.unsavedChanges = true;
        await cachedIndex(key, partial);
        workerRevision = undefined;
      },
      onProgress: (p) => {
        if (token !== sequence) return;
        message(typeof p === 'string' ? p : p.message);
        if (typeof p !== 'string') {
          $('guide-progress').hidden = false;
          $('guide-progress').value = p.current;
          $('guide-progress').max = p.total || 1;
        }
      },
    };
  }
  async function translate() {
    if (!index || busy) return;
    if (editor) readEditor();
    const token = sequence;
    controller = new AbortController();
    const options = processingOptions(controller.signal, token, cacheKey());
    setBusy(true);
    try {
      await translator.prepare(index.language || game.language, { allowDownload: true, signal: controller.signal, onProgress: message });
      await translateIndex(index, translator, options);
      if (token !== sequence) return;
      if (repository.canPrepare(game)) await repository.saveTechnicalIndex(game, activeDocument(), index, { state: ocrCoverage(index).failed ? 'partial' : 'ready', signal: controller.signal });
      await loadIndexes();
      if (editor) {
        // Só completa sugestões intocadas e ainda pendentes; preserva texto editado.
        const suggestions = suggestedSections(index);
        for (const s of guide.sections) {
          const next = suggestions.find((n) => n.documentId === (s.documentId || 'main') && n.sourceHash === (s.sourceHash || guide.sourceHash) && n.page === Number(s.page) && n.originalTitle === s.originalTitle);
          if (s.translationPending && !s.text.trim() && next && !next.translationPending) Object.assign(s, { text: next.text, translationPending: false, translationMethod: next.translationMethod, reviewed: false });
        }
        dirty ||= guide.sections.length > 0;
        renderEditor();
      } else renderSearch();
      message('Tradução concluída. Confira o português brasileiro e as regras antes de publicar.');
    } catch (error) {
      if (token === sequence) message(controller?.signal.aborted ? 'Tradução pausada. As páginas concluídas foram guardadas.' : error.message);
    } finally {
      if (token === sequence) {
        controller = null;
        setBusy(false);
        $('guide-progress').hidden = true;
      }
    }
  }
  async function analyze(ocr = false) {
    if (!index) await loadIndexes();
    if (['waiting', 'analyzing', 'ocr', 'translating'].includes(getPreparation(game, selectedDocumentId)?.state)) {
      message('Este documento está sendo preparado. Você pode continuar navegando.');
      return;
    }
    if (editor) readEditor();
    const wasEditor = editor,
      token = sequence,
      sourceGame = activeGame();
    controller = new AbortController();
    setBusy(true);
    if (!ocr && indexMatches(index, sourceGame) && index.analysisComplete !== false) {
      setBusy(false);
      controller = null;
      message('A análise salva já está disponível.');
      return;
    }
    message(ocr ? 'Preparando leitura das páginas escaneadas…' : 'Abrindo o manual…');
    try {
      const signal = controller.signal,
        blob = await repository.getManual(sourceGame, { signal });
      if (token !== sequence) return;
      controller.signal.throwIfAborted();
      const options = processingOptions(signal, token, cacheKey());
      const result = ocr ? await extendOcrIndex(blob, sourceGame, index, { ...options, retry: !pendingOcrPages(index).length }) : await analyzePdf(blob, sourceGame, { ...options, previous: index });
      if (token !== sequence || sourceGame.manual.sha256 !== activeGame().manual.sha256) return;
      index = result;
      await cachedIndex(cacheKey(), index);
      if (token !== sequence) return;
      if (repository.canPrepare(game)) await repository.saveTechnicalIndex(game, activeDocument(), index, { state: ocrCoverage(index).failed || ocrCoverage(index).pending ? 'partial' : 'ready', signal });
      await loadIndexes();
      if (wasEditor) renderEditor();
      else renderSearch();
      const coverage = ocrCoverage(index);
      message(
        ocr
          ? `Páginas lidas: ${coverage.readable} de ${coverage.total} com texto.${coverage.failed ? ` ${coverage.failed} não legíveis; você pode tentar essas páginas novamente.` : ''} Confira os trechos antes de publicar.`
          : coverage.pending
            ? 'Há páginas escaneadas. Inicie a leitura de imagens para analisar todas.'
            : 'PDF analisado. Os trechos estão prontos para revisão.',
      );
    } catch (error) {
      if (token === sequence) {
        if (wasEditor) renderEditor();
        else renderSearch();
        message(controller?.signal.aborted ? 'Análise pausada. As páginas concluídas foram guardadas; você pode continuar depois.' : error.message);
      }
    } finally {
      if (token === sequence) {
        controller = null;
        setBusy(false);
        $('guide-progress').hidden = true;
      }
    }
  }
  return {
    isBusy: () => busy || dirty,
    async refreshIndexes() {
      if (!dialog.open || busy || dirty || !repository.session.canRead) return;
      await loadIndexes();
      if (!dialog.open || busy || dirty || !repository.session.canRead) return;
      if (editor) renderEditor();
      else if (!$('guide-search').hidden) renderSearch();
      contextNotice();
    },
    updateSession(session) {
      if (!session.canRead || sessionUid !== session.user?.uid || (!session.canEdit && editor)) close(true);
      sessionUid = session.user?.uid;
      if (game) contextNotice();
    },
    invalidate(next) {
      if (game?.id !== next.id) return;
      if (next.deleting) {
        close(true);
        return;
      }
      if (JSON.stringify(gameDocuments(game)) === JSON.stringify(gameDocuments(next))) return;
      controller?.abort();
      if (editor) readEditor();
      game = next;
      if (!findDocument(game, selectedDocumentId)) selectedDocumentId = primaryDocumentId(game);
      index = null;
      indexes = [];
      void loadIndexes().then(() => {
        if (dialog.open && !editor && !$('guide-search').hidden) renderSearch();
      });
      if (dialog.open) {
        if (editor) renderEditor();
        else if ($('guide-search').hidden) renderReader();
        else renderSearch();
      }
      onNotice('O PDF foi substituído. Seu guia foi preservado; confira as referências da versão atual.');
    },
    async open(nextGame, mode = 'learn') {
      close(true);
      returnFocus = document.activeElement;
      if (!repository.session.canRead) return;
      game = nextGame;
      selectedDocumentId = primaryDocumentId(game);
      indexes = [];
      published = guide = index = knowledge = null;
      indexDirty = false;
      translator = createTextTranslator({ scope: cacheKey() });
      editor = false;
      dirty = false;
      const token = ++sequence;
      $('guide-title').textContent = game.title;
      $('guide-mode').textContent = mode === 'edit' ? 'EDITAR GUIA' : mode === 'quick' ? 'BUSCAR REGRAS' : 'COMO JOGAR';
      $('guide-search').value = '';
      view.replaceChildren();
      message('Carregando conteúdo…');
      document.querySelectorAll('dialog[open]').forEach((d) => d.close());
      document.body.classList.add('modal-open');
      dialog.showModal();
      let loadingNotice = '';
      try {
        const loaded = await repository.getGuide(game);
        if (token !== sequence) return;
        published = guide = loaded;
        if (mode === 'learn') {
          renderReader();
          message('');
          return;
        }
        try {
          knowledge = (await repository.getKnowledge?.(game))?.knowledge || null;
        } catch {
          loadingNotice = 'O conhecimento do jogo está indisponível. A pesquisa dos PDFs continua disponível.';
        }
        if (token !== sequence) return;
        if (mode === 'edit' && repository.session.canEdit) {
          guide = (await repository.getGuide(game, true)) || emptyGuide(game);
          editor = true;
        }
        if (token !== sequence) return;
        index = await cachedIndex(cacheKey());
        if (!indexMatches(index, activeGame())) index = null;
        if (index) {
          index.language ||= game.language;
          indexDirty = index.unsavedChanges === true || (!index.savedAssetId && !index.sharedFileId);
        }
        const indexedGuide = editor && guide?.indexFileId ? guide : loaded;
        if (indexedGuide?.indexFileId && !stale(indexedGuide) && (!index || (!index.unsavedChanges && index.savedAssetId && index.savedAssetId !== indexedGuide.indexFileId))) {
          try {
            index = await unpackIndex(await repository.getGuideAsset(game, indexedGuide.indexFileId), game);
            index.language ||= game.language;
            index.savedAssetId = indexedGuide.indexFileId;
            index.unsavedChanges = false;
            indexDirty = false;
            await cachedIndex(cacheKey(), index);
          } catch {
            loadingNotice = 'O índice salvo está indisponível. Você pode analisar o PDF neste dispositivo.';
          }
        }
        await loadIndexes();
        if (token !== sequence) return;
        if (editor) {
          guide.sourceHash = game.manual.sha256;
          renderEditor();
        } else if (mode === 'quick') renderSearch();
        else renderReader();
        message(loadingNotice || indexNotice);
      } catch (error) {
        if (token === sequence) message(error.message);
      }
    },
    close,
  };
}
