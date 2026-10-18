import { linesFromItems } from './recognition.js';
import { loadPdf, loadRemotePdf } from './pdf.js';
import { cachedIndex, indexCacheKey } from './index-cache.js';
import { documentGame } from './documents.js';

export const RULE_LAYOUT_VERSION = 1;
export function columnLayout(items, width) {
  const textItems = items.filter((i) => i.str?.trim() && i.transform && i.width > 0);
  const heights = textItems.map((i) => i.height || Math.abs(i.transform[3])).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 10;
  const body = textItems.filter((i) => i.str.trim().length > 6 && (i.height || Math.abs(i.transform[3])) < median * 1.4 && i.width < width * 0.65);
  let gutter = null,
    run = [],
    best = [];
  for (let x = Math.floor(width * 0.35); x <= width * 0.65; x += 2) {
    const ink = body.filter((i) => i.transform[4] < x && i.transform[4] + i.width > x).length;
    if (ink <= 1) run.push(x);
    else {
      if (run.length > best.length) best = run;
      run = [];
    }
  }
  if (run.length > best.length) best = run;
  if (best.length * 2 >= Math.max(10, width * 0.018)) {
    const at = best[Math.floor(best.length / 2)];
    if (body.filter((i) => i.transform[4] + i.width < at).length > 12 && body.filter((i) => i.transform[4] > at).length > 12) gutter = at;
  }
  const groups = gutter ? [textItems.filter((i) => i.transform[4] < gutter), textItems.filter((i) => i.transform[4] >= gutter)] : [textItems];
  return {
    version: RULE_LAYOUT_VERSION,
    columns: groups.length,
    text: groups
      .map((group) =>
        linesFromItems(group)
          .map((l) => l.text)
          .join('\n'),
      )
      .join('\n\n'),
  };
}

// Índices antigos continuam intactos. Esta projeção privada é calculada uma vez,
// em sequência e sem renderizar imagens, OCR novo ou chamadas ao Gemini.
export async function readableIndex(repository, game, document, index, { scope, signal, permitted = () => true } = {}) {
  if (index.pages.every((p) => p.searchLayout?.version === RULE_LAYOUT_VERSION || p.method === 'ocr-local' || !p.text.trim())) return index;
  const view = documentGame(game, document),
    uid = repository.session.user?.uid;
  const key = 'rule-layout-v1:' + indexCacheKey(scope || 'local', uid, view);
  const valid = () => !signal?.aborted && permitted() && repository.session.canRead && repository.session.user?.uid === uid;
  if (!valid()) return index;
  const cached = await cachedIndex(key);
  if (!valid()) return index;
  if (cached?.sourceHash === index.sourceHash && cached.documentId === document.id && cached.pages.length === index.pages.length && cached.pages.every((p, i) => p.originalText === index.pages[i].text)) {
    return { ...index, pages: index.pages.map((p, i) => ({ ...p, ...(cached.pages[i].layout ? { searchLayout: cached.pages[i].layout } : {}) })) };
  }
  let pdf;
  try {
    if (repository.getManualSource) {
      const source = await repository.getManualSource(view);
      if (!valid()) return index;
      if (source) pdf = await loadRemotePdf(source, { signal });
    }
    if (!pdf) {
      const blob = await repository.getManual?.(view, { signal });
      if (!valid() || !blob) return index;
      pdf = await loadPdf(blob);
    }
    const stop = () => void pdf.destroy();
    signal?.addEventListener('abort', stop, { once: true });
    try {
      const pages = [];
      for (const p of index.pages) {
        if (!valid()) return index;
        let layout = p.searchLayout;
        if (!layout && p.method !== 'ocr-local' && p.text.trim()) {
          const page = await pdf.getPage(p.page);
          const content = await page.getTextContent();
          layout = columnLayout(content.items, page.getViewport({ scale: 1 }).width);
          page.cleanup();
        }
        pages.push({ ...p, ...(layout ? { searchLayout: layout } : {}) });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (!valid()) return index;
      await cachedIndex(key, { sourceHash: index.sourceHash, documentId: document.id, pages: pages.map((p) => ({ originalText: p.text, layout: p.searchLayout || null })) });
      return { ...index, pages };
    } finally {
      signal?.removeEventListener('abort', stop);
    }
  } finally {
    if (pdf) await pdf.destroy();
  }
}
