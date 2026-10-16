import { findDocument, documentGame, primaryDocumentId } from './documents.js';
import { fileErrorMessage } from './file-errors.js';
import { loadPdf, loadRemotePdf, pdfLibrary } from './pdf.js';

export function createReader({ repository, getProgress, saveProgress, onError }) {
  const element = (id) => document.getElementById(id);
  const reader = element('reader'),
    canvas = element('pdf-canvas'),
    layer = element('pdf-text'),
    stage = element('reader-stage');
  let documentPdf = null,
    game = null,
    pageNumber = 1,
    zoom = 1,
    renderTask = null,
    textTask = null,
    generation = 0,
    openSequence = 0;
  let renderChain = Promise.resolve(),
    returnFocus = null,
    resizeTimer;
  function status(text) {
    element('reader-status').textContent = text;
    element('reader-status').hidden = !text;
  }
  function updateControls() {
    const total = documentPdf?.numPages || 0;
    element('page-number').value = pageNumber;
    element('page-number').max = total || 1;
    element('page-number').disabled = !total;
    element('page-total').textContent = `/ ${total || '—'}`;
    element('page-prev').disabled = !total || pageNumber <= 1;
    element('page-next').disabled = !total || pageNumber >= total;
    element('zoom-fit').textContent = `${Math.round(zoom * 100)}%`;
    element('reader-subtitle').textContent = total ? `Página ${pageNumber} de ${total} · ${game?.manual?.name || 'Manual'}` : 'Carregando manual…';
  }
  function requestRender() {
    if (!documentPdf) return;
    const token = ++generation;
    renderTask?.cancel();
    textTask?.cancel();
    renderChain = renderChain
      .catch(() => {})
      .then(async () => {
        if (token !== generation || !documentPdf) return;
        const page = await documentPdf.getPage(pageNumber);
        if (token !== generation || !documentPdf) return;
        status('Preparando a página…');
        const base = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(220, stage.clientWidth - (window.innerWidth < 600 ? 16 : 32));
        const scale = (availableWidth / base.width) * zoom;
        const viewport = page.getViewport({ scale });
        const dpi = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
        canvas.width = Math.ceil(viewport.width * dpi);
        canvas.height = Math.ceil(viewport.height * dpi);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const pageContainer = element('pdf-page');
        pageContainer.style.width = `${viewport.width}px`;
        pageContainer.style.height = `${viewport.height}px`;
        pageContainer.style.setProperty('--scale-factor', scale);
        pageContainer.style.setProperty('--total-scale-factor', scale);
        pageContainer.style.setProperty('--user-unit', page.userUnit || 1);
        layer.replaceChildren();
        renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: dpi === 1 ? null : [dpi, 0, 0, dpi, 0, 0], background: '#ffffff' });
        await renderTask.promise;
        if (token !== generation) return;
        const pdfjs = await pdfLibrary();
        textTask = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
        await textTask.render();
        if (token !== generation) return;
        status('');
        updateControls();
        saveProgress(game.documentId && game.documentId !== 'main' ? `${game.id}:${game.documentId}` : game.id, { page: pageNumber, total: documentPdf.numPages, lastRead: Date.now() });
      })
      .catch((error) => {
        if (error.name !== 'RenderingCancelledException' && error.name !== 'AbortException' && token === generation) {
          status('Não foi possível exibir esta página. Tente outra página ou reabra o manual.');
          onError(error);
        }
      });
  }
  function goToPage(next) {
    if (!documentPdf) return;
    pageNumber = Math.max(1, Math.min(documentPdf.numPages, Number.parseInt(next, 10) || 1));
    stage.scrollTop = stage.scrollLeft = 0;
    updateControls();
    requestRender();
  }
  function setZoom(next) {
    zoom = Math.min(3, Math.max(0.5, Math.round(next * 100) / 100));
    updateControls();
    requestRender();
  }
  async function close() {
    ++openSequence;
    ++generation;
    renderTask?.cancel();
    textTask?.cancel();
    reader.hidden = true;
    document.body.classList.remove('reader-open');
    const previous = documentPdf;
    documentPdf = null;
    game = null;
    await previous?.destroy().catch(() => {});
    canvas.width = canvas.height = 0;
    layer.replaceChildren();
    element('reader-title').textContent = '';
    element('reader-subtitle').textContent = '';
    if (returnFocus?.isConnected && !returnFocus.closest('dialog') && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true });
    else document.getElementById('hero-main').focus({ preventScroll: true });
  }
  element('reader-close').onclick = close;
  element('page-prev').onclick = () => goToPage(pageNumber - 1);
  element('page-next').onclick = () => goToPage(pageNumber + 1);
  element('page-number').onchange = (event) => goToPage(event.target.value);
  element('zoom-out').onclick = () => setZoom(zoom - 0.25);
  element('zoom-in').onclick = () => setZoom(zoom + 0.25);
  element('zoom-fit').onclick = () => setZoom(1);
  document.addEventListener('keydown', (event) => {
    if (reader.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowLeft') goToPage(pageNumber - 1);
    if (event.key === 'ArrowRight') goToPage(pageNumber + 1);
  });
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    if (!reader.hidden) resizeTimer = setTimeout(requestRender, 180);
  });
  let touch = null;
  stage.addEventListener(
    'touchstart',
    (event) => {
      touch = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
    },
    { passive: true },
  );
  stage.addEventListener(
    'touchend',
    (event) => {
      if (!touch || !event.changedTouches.length || zoom !== 1) return;
      const dx = event.changedTouches[0].clientX - touch.x,
        dy = event.changedTouches[0].clientY - touch.y;
      if (Math.abs(dx) > 85 && Math.abs(dy) < 40) goToPage(pageNumber + (dx > 0 ? -1 : 1));
      touch = null;
    },
    { passive: true },
  );
  return {
    close,
    revokeMissing(games) {
      if (game && !games.some((item) => item.id === game.id)) void close();
      else if (game) {
        const latest = findDocument(
          games.find((item) => item.id === game.id),
          game.documentId,
        );
        if (!latest || latest.manual.sha256 !== game.manual.sha256) {
          void close();
          onError(Object.assign(new Error('O PDF foi atualizado. Reabra o documento.'), { status: 409 }));
        }
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
      nextGame = documentGame(nextGame, doc);
      if (!reader.hidden) await close();
      const sequence = ++openSequence;
      returnFocus = document.activeElement;
      document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
      document.body.classList.remove('modal-open');
      document.body.classList.add('reader-open');
      reader.hidden = false;
      game = nextGame;
      zoom = 1;
      pageNumber = 1;
      element('reader-title').textContent = game.title;
      element('pdf-page').hidden = true;
      status('Carregando o manual…');
      updateControls();
      element('reader-close').focus();
      try {
        const source = repository.getManualSource ? await repository.getManualSource(nextGame) : null;
        if (sequence !== openSequence) return;
        const pdf = source ? await loadRemotePdf(source) : await loadPdf(await repository.getManual(nextGame));
        if (sequence !== openSequence) {
          await pdf.destroy();
          return;
        }
        documentPdf = pdf;
        pageNumber = Math.max(1, Math.min(documentPdf.numPages, Number.isInteger(page) ? page : getProgress(game.documentId && game.documentId !== 'main' ? `${game.id}:${game.documentId}` : game.id)?.page || 1));
        element('pdf-page').hidden = false;
        updateControls();
        requestRender();
      } catch (error) {
        if (sequence !== openSequence) return;
        status(fileErrorMessage(error));
        onError(error);
      }
    },
  };
}
