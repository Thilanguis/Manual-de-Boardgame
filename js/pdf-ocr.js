import { loadPdf } from './pdf.js';
import { extractMetadata } from './recognition.js';

// PDF e imagens ficam no dispositivo. Somente código/modelos públicos são baixados.
export async function recognizePdfImages(blob, { language = 'pt-BR', signal, onProgress = () => {}, pages = [1, 2, 3], timeoutMs = 18000, onPage = async () => {}, continueOnError = false } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs),
    combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let worker, pdf, renderTask, abort;
  const job = (async () => {
    try {
      const { default: Tesseract } = await import('../vendor/tesseract/tesseract.esm.min.js');
      const createWorker = Tesseract.createWorker;
      combined.throwIfAborted();
      onProgress('Preparando leitura local de imagens…');
      worker = await createWorker(language === 'fr' ? 'fra' : language === 'en' ? 'eng' : 'por', 1, {
        workerPath: new URL('../vendor/tesseract/worker.min.js', import.meta.url).href,
        corePath: new URL('../vendor/tesseract/core/', import.meta.url).href,
        langPath: new URL('../vendor/tesseract/lang/', import.meta.url).href,
        legacyCore: false,
        legacyLang: false,
        workerBlobURL: false,
        logger: () => {},
      });
      await worker.setParameters({ tessedit_pageseg_mode: '3' });
      combined.throwIfAborted();
      pdf = await loadPdf(blob);
      const evidence = [];
      for (const number of [...new Set(pages)].filter((p) => Number.isInteger(p) && p >= 1 && p <= pdf.numPages).slice(0, 3)) {
        combined.throwIfAborted();
        onProgress(`Lendo a página ${number} como imagem neste dispositivo…`);
        const page = await pdf.getPage(number),
          original = page.getViewport({ scale: 1 }),
          viewport = page.getViewport({ scale: Math.min(1800 / original.width, 2600 / original.height) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        try {
          renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#fff' });
          await renderTask.promise;
          const { data } = await worker.recognize(canvas);
          combined.throwIfAborted();
          const usable = data.confidence >= 50 && data.text.trim().length >= 40;
          if (usable) evidence.push({ page: number, text: data.text.slice(0, 30000), confidence: Math.round(data.confidence) });
          await onPage({ page: number, text: usable ? data.text.slice(0, 30000) : '', confidence: Math.round(data.confidence), status: usable ? 'done' : 'low-confidence' });
          onProgress(`Página ${number} lida; ${evidence.length} página(s) com texto utilizável.`);
        } catch (error) {
          combined.throwIfAborted();
          if (!continueOnError) throw error;
          await onPage({ page: number, text: '', status: 'failed', confidence: 0 });
        } finally {
          canvas.width = canvas.height = 0;
        }
      }
      const combinedText = evidence.map((p) => p.text).join('\n\f\n'),
        metadata = extractMetadata(combinedText);
      for (const value of Object.values(metadata.sources)) {
        const found = evidence.find((p) =>
          p.text
            .replace(/[‐‑–—]/g, '-')
            .replace(/\s+/g, ' ')
            .includes(String(value.excerpt).replace(/\s+/g, ' ')),
        );
        value.source = 'PDF · OCR local · confirmar com a página';
        if (found) value.page = found.page;
      }
      return { metadata, evidence, pages: evidence.map(({ page, confidence }) => ({ page, confidence })), characters: combinedText.length };
    } finally {
      void worker?.terminate().catch(() => {});
      void pdf?.destroy().catch(() => {});
    }
  })();
  try {
    return await Promise.race([
      job,
      new Promise((_, reject) => {
        abort = () => {
          renderTask?.cancel();
          void worker?.terminate().catch(() => {});
          reject(combined.reason);
        };
        if (combined.aborted) abort();
        else combined.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } catch (error) {
    if (timeout.aborted) throw new Error(continueOnError ? 'A leitura atingiu o prazo. As páginas concluídas foram guardadas; continue para ler as restantes.' : 'A leitura local atingiu o prazo. Nenhum dado foi aplicado; você pode tentar novamente ou preencher pelo PDF.');
    throw error;
  } finally {
    if (abort) combined.removeEventListener('abort', abort);
    void worker?.terminate().catch(() => {});
    void pdf?.destroy().catch(() => {});
  }
}
