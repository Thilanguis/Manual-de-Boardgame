import { gameDocuments, documentGame, documentName, findDocument } from './documents.js';
import { staleSection, ruleCategory } from './guide-model.js';
import { indexMatches } from './pdf-index.js';
import { fileErrorMessage } from './file-errors.js';
import { usableKnowledge, KNOWLEDGE_TOPICS } from './knowledge-model.js';
import { searchKnowledge, queryWords } from './rule-relevance.js';
import { cleanRuleText, contextualExcerpt } from './rule-passages.js';
import { readableIndex } from './rule-layout.js';
import { observeKnowledge } from './knowledge-observer.js';

const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
};
const button = (text, action) => {
  const node = el('button', text, 'button secondary small');
  node.type = 'button';
  node.onclick = action;
  return node;
};
export function formattedText(target, text) {
  let list = null,
    listType = '';
  for (const block of cleanRuleText(text)
    .split(/\n\s*\n/)
    .filter(Boolean)) {
    const marker = block.match(/^(?:([•●▪◦*–—-])\s+|(\d{1,2})[.)]\s+)([\s\S]*)$/);
    let paragraph;
    if (marker) {
      const type = marker[2] ? 'ol' : 'ul';
      if (!list || listType !== type) {
        list = el(type);
        target.append(list);
        listType = type;
      }
      paragraph = el('li');
      if (marker[2]) paragraph.value = Number(marker[2]);
      list.append(paragraph);
    } else {
      list = null;
      paragraph = el('p');
      target.append(paragraph);
    }
    for (const part of (marker ? marker[3] : block).split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)) {
      if (/^\*\*[^*]+\*\*$/.test(part)) paragraph.append(el('strong', part.slice(2, -2)));
      else if (/^\*[^*]+\*$/.test(part)) paragraph.append(el('em', part.slice(1, -1)));
      else paragraph.append(document.createTextNode(part));
    }
  }
}

// O nome do módulo é mantido para compatibilidade. Não contém editor ou escrita
// de guias: a consulta usa apenas conteúdo previamente armazenado e autorizado.
export function createGuidePanel({ repository, openManual, getPreparation = () => null, scope = 'local' }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $('guide-dialog'),
    view = $('guide-content'),
    status = $('guide-status'),
    input = $('guide-search');
  const worker = new Worker(new URL('./rule-search-worker.js', import.meta.url), { type: 'module' });
  let game,
    published,
    knowledge,
    indexes = [],
    sequence = 0,
    searchSequence = 0,
    timer,
    observation,
    returnFocus,
    layoutController,
    loading = false;
  let errors = new Map(),
    sessionUid = repository.session.user?.uid;
  const urls = new Map();
  const message = () => {
    status.textContent = [...errors.values()].join(' ');
    status.hidden = !status.textContent;
  };
  function context() {
    worker.postMessage({ type: 'context', indexes, documents: gameDocuments(game), guide: published, knowledge, currentHash: game?.manual.sha256 || '' });
  }
  function pageButton(page, hash, documentId) {
    const document = findDocument(game, documentId || 'main');
    if (!document || document.manual.sha256 !== hash || page < 1 || page > document.manual.pages) return null;
    return button(`Ver no manual · p. ${page}`, () => {
      const selected = game;
      close();
      void openManual(selected, { page, documentId: document.id, sourceHash: hash });
    });
  }
  async function image(id, target, caption) {
    const token = sequence;
    try {
      // O cartão ainda está sendo construído; aguarda sua inserção também quando
      // o blob já está em cache, sem baixar novamente a imagem.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (token !== sequence || !target.isConnected) return;
      if (!published?.assets?.[id]) return;
      if (!urls.has(id)) {
        const blob = await repository.getGuideAsset(game, id);
        if (token !== sequence || !target.isConnected) return;
        urls.set(id, URL.createObjectURL(blob));
      }
      if (token !== sequence || !target.isConnected) return;
      const picture = el('img');
      picture.src = urls.get(id);
      picture.alt = caption || 'Ilustração revisada';
      picture.loading = 'lazy';
      target.append(picture);
      if (caption) target.append(el('small', caption));
    } catch {
      if (token === sequence) target.append(el('small', 'Imagem indisponível.'));
    }
  }
  function resultCard(result) {
    const card = el('article', '', 'rule-result');
    card.dataset.match = result.matchType || 'direct';
    card.dataset.page = result.page || '';
    card.dataset.document = result.documentId || 'main';
    card.append(el('h3', result.title), el('small', result.source));
    if (result.editionUnconfirmed) card.append(el('small', 'Informação geral da obra · edição não confirmada'));
    if (result.needsTranslation) card.append(el('p', 'Tradução pendente. Consulte o texto original ou a página do manual.'));
    else {
      const excerpt = contextualExcerpt(result.text, queryWords(input.value), 480);
      const preview = el('div', '', 'rule-preview');
      formattedText(preview, excerpt.preview);
      card.append(preview);
      if (excerpt.hasMore) {
        const full = el('details');
        full.append(el('summary', result.generated || result.sectionId ? 'Ler explicação completa' : 'Ler trecho completo'));
        formattedText(full, excerpt.text);
        card.append(full);
      }
    }
    if (result.needsTranslation || result.translated || result.layoutRebuilt) {
      const original = el('details');
      original.append(el('summary', result.originalPage ? 'Texto original da página' : 'Texto original'));
      formattedText(original, result.originalText || '');
      card.append(original);
    }
    const document = findDocument(game, result.documentId || 'main');
    if (result.page) {
      const referenceRow = el('div', '', 'rule-reference');
      if (document) referenceRow.append(el('small', documentName(document)));
      const reference = pageButton(result.page, result.sourceHash, result.documentId);
      if (reference) referenceRow.append(reference);
      card.append(referenceRow);
    }
    if (/^https:\/\//.test(result.sourceUrl || '')) {
      const source = el('a', `Fonte · ${result.sourceLicense || 'consultar origem'} ↗`);
      source.href = result.sourceUrl;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      card.append(source);
      if (/^https:\/\//.test(result.sourceAuthors || '') || /^https:\/\//.test(result.sourceLicenseUrl || '')) {
        const attribution = el('details');
        attribution.append(el('summary', 'Autores e licença'));
        for (const [url, label] of [
          [result.sourceAuthors, 'Autores e histórico ↗'],
          [result.sourceLicenseUrl, 'Condições da licença ↗'],
        ]) {
          if (!/^https:\/\//.test(url || '')) continue;
          const link = el('a', label);
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          const row = el('p');
          row.append(link);
          attribution.append(row);
        }
        attribution.append(el('p', result.sourceLicense || ''));
        card.append(attribution);
      }
    }
    if (result.imageId) void image(result.imageId, card, result.caption);
    return card;
  }
  const hasContent = () => indexes.length || knowledge?.sections.length || published?.sections.length;
  function emptyMessage() {
    if (loading) return 'Carregando conteúdo…';
    if (errors.size) return 'O conteúdo não pôde ser carregado por completo. O manual continua disponível.';
    const preparing = gameDocuments(game).some((document) => ['waiting', 'analyzing', 'ocr', 'translating'].includes(getPreparation(game, document.id)?.state));
    return preparing ? 'Os documentos estão sendo preparados. Você já pode ler os PDFs.' : 'Ainda não há conteúdo preparado para consulta. Você pode ler o manual.';
  }
  function overview() {
    view.dataset.query = '';
    view.replaceChildren();
    const section = knowledge?.sections.find((section) => section.topic === 'visao-geral');
    if (section) {
      const result = searchKnowledge({ ...knowledge, sections: [section] }, section.title)[0];
      if (result) view.append(resultCard(result));
    } else {
      const section = published?.sections.find((section) => /visão geral|visao geral|objetivo/i.test(section.title));
      if (section) view.append(resultCard({ ...section, source: 'Informação revisada', sourceHash: section.sourceHash || published.sourceHash, sectionId: section.id }));
    }
    const topics = new Map();
    for (const section of knowledge?.sections || []) if (KNOWLEDGE_TOPICS[section.topic] && section.topic !== 'visao-geral') topics.set(KNOWLEDGE_TOPICS[section.topic], KNOWLEDGE_TOPICS[section.topic]);
    for (const section of published?.sections || []) {
      const topic = ruleCategory(section.title);
      if (topic) topics.set(topic, topic);
    }
    for (const entry of indexes)
      for (const heading of entry.index.headings || []) {
        const topic = heading.category || ruleCategory(heading.title);
        if (topic) topics.set(topic, topic);
      }
    if (topics.size) {
      const nav = el('nav', '', 'rules-topics');
      nav.setAttribute('aria-label', 'Assuntos das regras');
      for (const title of [...topics.keys()].slice(0, 12))
        nav.append(
          button(title, () => {
            input.value = title === 'Pontuação e vitória' ? 'vitória' : title;
            renderSearch();
          }),
        );
      view.append(nav);
    }
    if (!hasContent()) {
      view.append(
        el('p', emptyMessage()),
        button('Abrir manual', () => {
          const selected = game;
          close();
          void openManual(selected);
        }),
      );
    } else if (!section && !view.querySelector('.rule-result')) view.prepend(el('p', 'Pesquise uma regra ou escolha um assunto.'));
  }
  function renderResults(results) {
    view.dataset.query = input.value.trim();
    view.replaceChildren();
    if (!results.length) {
      view.append(el('p', hasContent() ? 'Não encontramos essa informação. Tente outro termo ou consulte o manual.' : emptyMessage()));
      return;
    }
    const direct = results.filter((r) => r.matchType !== 'related'),
      related = results.filter((r) => r.matchType === 'related');
    function more(label, items) {
      if (!items.length) return;
      const details = el('details', '', 'rules-more');
      details.append(el('summary', label + ' (' + items.length + ')'));
      details.addEventListener('toggle', () => {
        if (!details.open || details.dataset.loaded) return;
        details.dataset.loaded = 'true';
        for (const result of items) details.append(resultCard(result));
      });
      view.append(details);
    }
    if (direct.length) {
      for (const result of direct.slice(0, 3)) view.append(resultCard(result));
      more('Mais resultados', direct.slice(3));
      more('Trechos relacionados', related);
    } else {
      view.append(el('p', 'Não encontramos uma resposta direta. Estes trechos podem ajudar.', 'rules-related-notice'), el('h3', 'Trechos relacionados'));
      for (const result of related.slice(0, 3)) view.append(resultCard(result));
      more('Mais trechos relacionados', related.slice(3));
    }
  }
  function renderSearch() {
    if (!game || !dialog.open) return;
    ++searchSequence;
    message();
    if (!input.value.trim()) return overview();
    view.replaceChildren(el('p', 'Pesquisando…'));
    worker.postMessage({ type: 'query', id: searchSequence, query: input.value });
  }
  worker.onmessage = ({ data }) => {
    if (data.id !== searchSequence || data.query !== input.value.trim() || !dialog.open) return;
    if (data.error) {
      errors.set('search', data.error);
      message();
    } else renderResults(data.results);
  };
  worker.onerror = () => {
    errors.set('search', 'Não foi possível iniciar a consulta. Feche e tente novamente.');
    message();
  };
  async function loadIndexes(token) {
    layoutController?.abort();
    layoutController = new AbortController();
    const control = layoutController;
    const target = game;
    const entries = await Promise.all(
      gameDocuments(game).map(async (document) => {
        try {
          return { document, index: await repository.getTechnicalIndex(target, document) };
        } catch (error) {
          return { document, error };
        }
      }),
    );
    if (token !== sequence || !game) return;
    errors.delete('layout');
    // Um PDF por vez: documentos múltiplos não multiplicam memória e workers.
    for (const entry of entries) {
      if (token !== sequence || !game || control.signal.aborted) return;
      if (!indexMatches(entry.index, documentGame(target, entry.document))) continue;
      try {
        entry.index = await readableIndex(repository, target, entry.document, entry.index, { scope, signal: control.signal, permitted: () => token === sequence && !!game });
      } catch (error) {
        if (control.signal.aborted) return;
        errors.set('layout', `Não foi possível organizar um documento. ${fileErrorMessage(error)}`);
      }
    }
    if (token !== sequence || !game) return;
    indexes = entries.filter((entry) => indexMatches(entry.index, documentGame(game, entry.document)));
    const failed = entries.filter((entry) => entry.error);
    if (failed.length) errors.set('index', `Um documento não pôde ser pesquisado. ${fileErrorMessage(failed[0].error)}`);
    else errors.delete('index');
    context();
    renderSearch();
  }
  async function loadKnowledge(token) {
    if (!game || !dialog.open || token !== sequence) return;
    if (!observation) {
      observation = observeKnowledge(repository, game, {
        onRecord(record) {
          if (token !== sequence || !game || !dialog.open) return;
          knowledge = usableKnowledge(record?.knowledge, game);
          errors.delete('knowledge');
          context();
          renderSearch();
        },
        onError(error) {
          if (token !== sequence || !game || !dialog.open) return;
          errors.set('knowledge', `As explicações estão indisponíveis. ${error.status === 401 || error.status === 403 ? fileErrorMessage(error) : 'A consulta dos PDFs continua disponível.'}`);
          message();
        },
      });
    }
    await observation.refresh();
  }
  function close() {
    ++sequence;
    layoutController?.abort();
    ++searchSequence;
    clearTimeout(timer);
    observation?.close();
    observation = null;
    worker.postMessage({ type: 'context', indexes: [], documents: [], guide: null, knowledge: null, currentHash: '' });
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
    if (dialog.open) dialog.close();
    document.body.classList.remove('modal-open');
    game = published = knowledge = null;
    indexes = [];
    errors.clear();
    loading = false;
    input.value = '';
    view.replaceChildren();
    status.textContent = '';
    returnFocus?.focus();
    return true;
  }
  $('guide-close').onclick = close;
  dialog.addEventListener('close', () => {
    if (game) close();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  input.oninput = () => {
    ++searchSequence; // Descarta respostas antigas antes do próximo debounce.
    view.dataset.query = '';
    view.replaceChildren(el('p', 'Pesquisando…'));
    clearTimeout(timer);
    timer = setTimeout(renderSearch, 150);
  };
  const panel = {
    close,
    isBusy: () => false,
    updateSession(session) {
      if (!session.canRead || sessionUid !== session.user?.uid) close();
      sessionUid = session.user?.uid;
    },
    invalidate(next) {
      if (game?.id !== next.id) return;
      if (next.deleting) return close();
      const changed = JSON.stringify(gameDocuments(game)) !== JSON.stringify(gameDocuments(next));
      game = next;
      if (changed) {
        observation?.close();
        observation = null;
        knowledge = usableKnowledge(knowledge, game);
        indexes = [];
        void panel.refreshIndexes();
      }
    },
    async refreshIndexes() {
      if (!game || !dialog.open) return;
      const token = sequence;
      await Promise.all([loadIndexes(token), loadKnowledge(token)]);
    },
    async open(nextGame) {
      close();
      if (!repository.session.canRead) return;
      returnFocus = document.activeElement;
      game = nextGame;
      loading = true;
      const token = ++sequence;
      $('guide-title').textContent = game.title;
      $('guide-mode').textContent = 'CONSULTAR REGRAS';
      input.hidden = false;
      document.querySelectorAll('dialog[open]').forEach((node) => node.close());
      document.body.classList.add('modal-open');
      dialog.showModal();
      overview();
      input.focus();
      await Promise.all([
        loadIndexes(token),
        loadKnowledge(token),
        (async () => {
          try {
            const guide = await repository.getGuide(game);
            if (token !== sequence || !game) return;
            published = guide ? { ...guide, sections: guide.sections.filter((section) => !staleSection(game, section, guide.sourceHash)) } : null;
          } catch (error) {
            if (token === sequence) errors.set('legacy', `O conteúdo revisado não pôde ser carregado. ${fileErrorMessage(error)}`);
          }
          if (token === sequence && game) {
            context();
            renderSearch();
          }
        })(),
      ]);
      if (token === sequence && game) {
        loading = false;
        context();
        renderSearch();
      }
    },
  };
  return panel;
}
