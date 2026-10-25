import { findDocument, documentGame, primaryDocumentId, gameDocuments, documentName } from './documents.js';
import { fileErrorMessage } from './file-errors.js';
import { loadPdf, loadRemotePdf, pdfLibrary } from './pdf.js';
import { pdfSearchText, pdfSearchMatches } from './pdf-search.js';

export function createReader({ repository, getProgress, saveProgress, onError }) {
  const el = (id) => document.getElementById(id);
  const reader = el('reader'),
    stage = el('reader-stage'),
    pages = el('reader-pages'),
    search = el('reader-search'),
    input = el('reader-search-input');
  let pdf = null,
    game = null,
    sourceGame = null,
    pageNumber = 1,
    zoom = 1;
  let generation = 0,
    sequence = 0,
    pumping = null,
    entries = [],
    returnFocus,
    controller,
    resizeTimer,
    frame,
    progressTimer;
  let searchSequence = 0,
    searchTimer,
    matches = [],
    matchIndex = -1,
    searchedQuery = '',
    textCache = new Map();
  const progressKey = () => (game.documentId && game.documentId !== 'main' ? `${game.id}:${game.documentId}` : game.id);
  function status(text) {
    el('reader-status').textContent = text;
    el('reader-status').hidden = !text;
  }
  function controls() {
    const total = pdf?.numPages || 0;
    el('page-number').value = pageNumber;
    el('page-number').max = total || 1;
    el('page-number').disabled = !total;
    el('page-total').textContent = `/ ${total || '—'}`;
    el('page-prev').disabled = !total || pageNumber <= 1;
    el('page-next').disabled = !total || pageNumber >= total;
    el('reader-document').disabled = el('reader-search-toggle').disabled = !total;
    el('zoom-fit').textContent = `${Math.round(zoom * 100)}%`;
    el('zoom-fit').setAttribute('aria-pressed', String(zoom === 1));
    const name = game ? documentName(findDocument(sourceGame, game.documentId)) : 'Manual';
    el('reader-subtitle').textContent = total ? `Página ${pageNumber} de ${total} · ${name}` : `Carregando ${name}…`;
  }
  function remember() {
    clearTimeout(progressTimer);
    if (game && pdf) saveProgress(progressKey(), { page: pageNumber, total: pdf.numPages, lastRead: Date.now() });
  }
  function release(entry) {
    entry.task?.cancel();
    entry.textTask?.cancel();
    entry.canvas.width = entry.canvas.height = 0;
    entry.layer.replaceChildren();
    entry.textLayer = null;
    entry.ready = false;
    entry.page.removeAttribute('data-rendered');
    if (!entry.task && !entry.textTask) entry.pdfPage?.cleanup();
  }
  function clearHighlights() {
    globalThis.CSS?.highlights?.delete('pdf-search');
    globalThis.CSS?.highlights?.delete('pdf-search-current');
    pages.querySelectorAll('.pdf-search-hit').forEach((node) => node.classList.remove('pdf-search-hit'));
  }
  function highlight() {
    clearHighlights();
    if (search.hidden) return;
    const ranges = [],
      current = [];
    for (const [index, match] of matches.entries()) {
      const entry = entries[match.page - 1];
      if (!entry?.ready) continue;
      const first = entry.textLayer.textDivs[match.first.item],
        last = entry.textLayer.textDivs[match.last.item];
      if (!first?.firstChild || !last?.firstChild) continue;
      if (globalThis.CSS?.highlights && globalThis.Highlight) {
        const range = new Range();
        range.setStart(first.firstChild, match.first.offset);
        range.setEnd(last.firstChild, match.last.end);
        ranges.push(range);
        if (index === matchIndex) current.push(range);
      } else first.classList.add('pdf-search-hit');
    }
    if (globalThis.CSS?.highlights && globalThis.Highlight) {
      CSS.highlights.set('pdf-search', new Highlight(...ranges));
      CSS.highlights.set('pdf-search-current', new Highlight(...current));
    }
  }
  function sizeEntry(entry) {
    const padding = getComputedStyle(stage);
    const width = Math.max(1, Math.min(1100, stage.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight)));
    entry.scale = (width / entry.base.width) * zoom;
    entry.page.style.width = `${entry.base.width * entry.scale}px`;
    entry.page.style.height = `${entry.base.height * entry.scale}px`;
    entry.shell.style.width = `${entry.base.width * entry.scale}px`;
  }
  let pendingMatch = null;
  function positionMatch(entry) {
    if (search.hidden || !pendingMatch || matches[matchIndex] !== pendingMatch || pendingMatch.page !== entry.number) return;
    const span = entry.textLayer?.textDivs[pendingMatch.first.item];
    if (span) {
      stage.scrollTop += span.getBoundingClientRect().top - stage.getBoundingClientRect().top - 80;
      pendingMatch = null;
    }
  }
  async function pump() {
    const token = generation,
      source = pdf;
    if (!source || pumping !== null) return;
    pumping = token;
    try {
      while (token === generation && source === pdf) {
        const entry = entries.filter((item) => item.wanted && !item.ready && !item.failed).sort((a, b) => Math.abs(a.number - pageNumber) - Math.abs(b.number - pageNumber))[0];
        if (!entry) break;
        try {
          const page = await source.getPage(entry.number);
          if (token !== generation) break;
          if (!entry.wanted) continue;
          entry.pdfPage = page;
          entry.base = page.getViewport({ scale: 1 });
          sizeEntry(entry);
          const viewport = page.getViewport({ scale: entry.scale });
          // Até ~24 MB por canvas; apenas páginas visíveis e vizinhas têm pixels alocados.
          const dpi = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6_000_000 / (viewport.width * viewport.height)));
          entry.canvas.width = Math.ceil(viewport.width * dpi);
          entry.canvas.height = Math.ceil(viewport.height * dpi);
          entry.canvas.style.width = `${viewport.width}px`;
          entry.canvas.style.height = `${viewport.height}px`;
          entry.page.style.setProperty('--scale-factor', entry.scale);
          entry.page.style.setProperty('--total-scale-factor', entry.scale);
          entry.page.style.setProperty('--user-unit', page.userUnit || 1);
          entry.task = page.render({ canvasContext: entry.canvas.getContext('2d'), viewport, transform: dpi === 1 ? null : [dpi, 0, 0, dpi, 0, 0], background: '#ffffff' });
          await entry.task.promise;
          if (token !== generation || !entry.wanted) continue;
          const pdfjs = await pdfLibrary();
          if (token !== generation || !entry.wanted) continue;
          entry.textTask = entry.textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: entry.layer, viewport });
          await entry.textTask.render();
          if (token !== generation || !entry.wanted) continue;
          entry.ready = true;
          entry.page.dataset.rendered = 'true';
          highlight();
          positionMatch(entry);
        } catch (error) {
          if (!['RenderingCancelledException', 'AbortException', 'AbortError'].includes(error.name) && token === generation && entry.wanted) {
            entry.failed = true;
            entry.label.textContent = `Página ${entry.number} · não foi possível exibir. Reabra o manual para tentar novamente.`;
            onError(error);
          }
        } finally {
          entry.task = entry.textTask = null;
          if (!entry.wanted || token !== generation) release(entry);
        }
      }
    } finally {
      if (pumping === token) {
        pumping = null;
        if (pdf && entries.some((entry) => entry.wanted && !entry.ready && !entry.failed)) void pump();
      }
    }
  }
  function refreshVisible() {
    if (!pdf || !entries.length) return;
    const bounds = stage.getBoundingClientRect(),
      visible = [],
      marker = bounds.top + Math.min(150, stage.clientHeight / 4);
    let current;
    for (const entry of entries) {
      const rect = entry.shell.getBoundingClientRect();
      if (rect.bottom > bounds.top && rect.top < bounds.bottom) visible.push(entry);
      if (rect.top <= marker && rect.bottom > marker) current = entry;
    }
    current ||= visible[0];
    if (current && current.number !== pageNumber) {
      pageNumber = current.number;
      controls();
      clearTimeout(progressTimer);
      progressTimer = setTimeout(remember, 200);
    }
    const needed = new Set(visible.flatMap((entry) => [entry.number - 1, entry.number, entry.number + 1]));
    if (!needed.size) needed.add(pageNumber);
    for (const entry of entries) {
      const wanted = needed.has(entry.number);
      if (!wanted && entry.wanted) release(entry);
      entry.wanted = wanted;
    }
    void pump();
  }
  function requestRender() {
    if (!pdf || !entries.length) return;
    const old = entries[pageNumber - 1],
      fraction = Math.max(0, (stage.scrollTop - old.shell.offsetTop) / old.shell.offsetHeight);
    ++generation;
    for (const entry of entries) {
      release(entry);
      entry.failed = false;
      sizeEntry(entry);
    }
    stage.scrollTop = old.shell.offsetTop + fraction * old.shell.offsetHeight;
    controls();
    refreshVisible();
  }
  function goToPage(next) {
    if (!pdf || !entries.length) return;
    pageNumber = Math.max(1, Math.min(pdf.numPages, Number.parseInt(next, 10) || 1));
    stage.scrollTop = entries[pageNumber - 1].shell.offsetTop;
    controls();
    refreshVisible();
    remember();
  }
  function searchStatus(text) {
    el('reader-search-status').textContent = text;
    el('reader-search-prev').disabled = el('reader-search-next').disabled = !matches.length;
  }
  function showMatch(next) {
    if (!matches.length) return;
    matchIndex = (next + matches.length) % matches.length;
    pendingMatch = matches[matchIndex];
    goToPage(pendingMatch.page);
    highlight();
    positionMatch(entries[pendingMatch.page - 1]);
    searchStatus(`${matchIndex + 1} de ${matches.length}`);
  }
  async function runSearch() {
    clearTimeout(searchTimer);
    const token = ++searchSequence,
      source = pdf,
      query = input.value.trim();
    searchedQuery = query;
    matches = [];
    matchIndex = -1;
    pendingMatch = null;
    highlight();
    if (!query || !source) {
      searchStatus('');
      return;
    }
    searchStatus('Buscando…');
    let hasText = false,
      failed = false;
    try {
      for (let number = 1; number <= source.numPages; number++) {
        if (token !== searchSequence || source !== pdf) return;
        let content = textCache.get(number);
        if (!content) {
          const page = await source.getPage(number),
            data = await page.getTextContent();
          content = pdfSearchText(data.items.filter((item) => typeof item.str === 'string'));
          if (token !== searchSequence || source !== pdf) return;
          textCache.set(number, content);
          if (!entries[number - 1]?.wanted) page.cleanup();
        }
        hasText ||= !!content.text.trim();
        matches.push(...pdfSearchMatches(content, query).map((match) => ({ ...match, page: number })));
        if (number % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      if (token !== searchSequence || source !== pdf) return;
      failed = true;
      onError(error);
    }
    if (token !== searchSequence || source !== pdf) return;
    if (failed) {
      matches = [];
      searchStatus('Busca indisponível. Reabra o PDF.');
    } else if (matches.length)
      showMatch(
        Math.max(
          0,
          matches.findIndex((match) => match.page >= pageNumber),
        ),
      );
    else searchStatus(hasText ? 'Nenhum resultado. Páginas em imagem podem precisar de OCR.' : 'PDF sem texto pesquisável. É necessário OCR.');
  }
  function toggleSearch(open) {
    search.hidden = !open;
    el('reader-search-toggle').setAttribute('aria-expanded', String(open));
    if (open) {
      input.focus();
      input.select();
    } else {
      ++searchSequence;
      clearTimeout(searchTimer);
      matches = [];
      searchedQuery = '';
      matchIndex = -1;
      pendingMatch = null;
      searchStatus('');
      clearHighlights();
      el('reader-search-toggle').focus();
    }
    refreshVisible();
  }
  async function close() {
    remember();
    controller?.abort();
    ++sequence;
    ++generation;
    ++searchSequence;
    clearTimeout(searchTimer);
    clearTimeout(progressTimer);
    clearTimeout(resizeTimer);
    cancelAnimationFrame(frame);
    for (const entry of entries) {
      entry.wanted = false;
      release(entry);
    }
    clearHighlights();
    entries = [];
    matches = [];
    pendingMatch = null;
    textCache = new Map();
    search.hidden = true;
    input.value = '';
    searchedQuery = '';
    searchStatus('');
    el('reader-search-toggle').setAttribute('aria-expanded', 'false');
    reader.hidden = true;
    document.body.classList.remove('reader-open');
    const previous = pdf;
    pdf = null;
    // Outra abertura tem canvases próprios e não precisa aguardar uma tarefa
    // de uma página cujo worker acabou de ser destruído.
    pumping = null;
    game = sourceGame = null;
    pages.replaceChildren();
    el('reader-document').replaceChildren();
    el('reader-document-picker').hidden = true;
    el('reader-title').textContent = el('reader-subtitle').textContent = '';
    await previous?.destroy().catch(() => {});
    if (returnFocus?.isConnected && !returnFocus.closest('dialog') && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true });
    else el('hero-main')?.focus({ preventScroll: true });
  }
  el('reader-close').onclick = close;
  el('reader-document').onchange = (event) => {
    if (sourceGame) void api.open(sourceGame, { documentId: event.target.value });
  };
  el('page-prev').onclick = () => goToPage(pageNumber - 1);
  el('page-next').onclick = () => goToPage(pageNumber + 1);
  el('page-number').onchange = (event) => goToPage(event.target.value);
  const setZoom = (next) => {
    zoom = Math.min(3, Math.max(0.25, Math.round(next * 100) / 100));
    requestRender();
  };
  el('zoom-out').onclick = () => setZoom(zoom - 0.25);
  el('zoom-in').onclick = () => setZoom(zoom + 0.25);
  el('zoom-fit').onclick = () => setZoom(1);
  el('reader-search-toggle').onclick = () => toggleSearch(search.hidden);
  el('reader-search-close').onclick = () => toggleSearch(false);
  el('reader-search-prev').onclick = () => showMatch(matchIndex - 1);
  search.onsubmit = (event) => {
    event.preventDefault();
    if (input.value.trim() !== searchedQuery || !matches.length) void runSearch();
    else showMatch(matchIndex + 1);
  };
  input.oninput = () => {
    ++searchSequence;
    matches = [];
    matchIndex = -1;
    pendingMatch = null;
    clearHighlights();
    searchStatus(input.value.trim() ? 'Buscando…' : '');
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void runSearch(), 300);
  };
  document.addEventListener('keydown', (event) => {
    if (reader.hidden) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      toggleSearch(true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!search.hidden) toggleSearch(false);
      else void close();
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goToPage(pageNumber - 1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goToPage(pageNumber + 1);
    }
  });
  stage.addEventListener(
    'scroll',
    () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refreshVisible);
    },
    { passive: true },
  );
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    if (!reader.hidden) resizeTimer = setTimeout(requestRender, 180);
  });
  const api = {
    close,
    revokeMissing(games) {
      if (!game) return;
      const latest = findDocument(
        games.find((item) => item.id === game.id),
        game.documentId,
      );
      if (!latest || latest.manual.sha256 !== game.manual.sha256) {
        void close();
        onError(Object.assign(new Error('O PDF foi atualizado ou removido. Reabra o documento.'), { status: 409 }));
      }
    },
    async open(nextGame, { page, documentId = primaryDocumentId(nextGame), sourceHash } = {}) {
      if (!repository.session.canRead) {
        onError(new Error('Entre com uma conta aprovada.'));
        return;
      }
      const doc = findDocument(nextGame, documentId);
      if (!doc || (sourceHash && doc.manual.sha256 !== sourceHash)) {
        onError(new Error('Esta referência pertence a outra versão do PDF.'));
        return;
      }
      if (!reader.hidden) await close();
      const opening = ++sequence;
      controller?.abort();
      const control = (controller = new AbortController());
      returnFocus = document.activeElement;
      document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
      document.body.classList.remove('modal-open');
      document.body.classList.add('reader-open');
      reader.hidden = false;
      game = documentGame(nextGame, doc);
      sourceGame = nextGame;
      const selector = el('reader-document');
      selector.replaceChildren(
        ...gameDocuments(nextGame).map((document) => {
          const option = window.document.createElement('option');
          option.value = document.id;
          option.textContent = `${documentName(document)} · ${document.manual.pages} ${document.manual.pages === 1 ? 'página' : 'páginas'}`;
          return option;
        }),
      );
      selector.value = doc.id;
      el('reader-document-picker').hidden = gameDocuments(nextGame).length < 2;
      zoom = 1;
      pageNumber = 1;
      stage.scrollTop = stage.scrollLeft = 0;
      el('reader-title').textContent = game.title;
      status('Carregando o manual…');
      controls();
      el('reader-close').focus();
      try {
        const view = game,
          source = repository.getManualSource ? await repository.getManualSource(view) : null;
        if (opening !== sequence) return;
        const loaded = source ? await loadRemotePdf(source, { signal: control.signal }) : await loadPdf(await repository.getManual(view, { signal: control.signal }), { signal: control.signal });
        if (opening !== sequence) {
          await loaded.destroy();
          return;
        }
        pdf = loaded;
        const first = await pdf.getPage(1);
        if (opening !== sequence) return;
        const base = first.getViewport({ scale: 1 });
        entries = Array.from({ length: pdf.numPages }, (_, index) => {
          const shell = document.createElement('section'),
            label = document.createElement('p'),
            container = document.createElement('div'),
            canvas = document.createElement('canvas'),
            layer = document.createElement('div');
          shell.className = 'reader-page-shell';
          shell.dataset.pageNumber = index + 1;
          label.className = 'reader-page-label';
          label.textContent = `Página ${index + 1}`;
          container.className = 'pdf-page';
          layer.className = 'textLayer';
          canvas.width = canvas.height = 0;
          canvas.setAttribute('aria-label', `Página ${index + 1} do manual`);
          if (index === 0) {
            container.id = 'pdf-page';
            canvas.id = 'pdf-canvas';
            layer.id = 'pdf-text';
          }
          container.append(canvas, layer);
          shell.append(label, container);
          pages.append(shell);
          const entry = { number: index + 1, shell, label, page: container, canvas, layer, base, wanted: false, ready: false };
          sizeEntry(entry);
          return entry;
        });
        status('');
        controls();
        goToPage(Number.isInteger(page) ? page : getProgress(progressKey())?.page || 1);
        if (!search.hidden && input.value.trim()) void runSearch();
      } catch (error) {
        if (opening === sequence) {
          status(fileErrorMessage(error));
          onError(error);
        }
      }
    },
  };
  return api;
}
