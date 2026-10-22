import { loadPdf, loadRemotePdf } from './pdf.js';
import { cachedIndex, indexCacheKey } from './index-cache.js';
import { documentGame } from './documents.js';
import { readingPunctuation } from './rule-passages.js';

export const RULE_LAYOUT_VERSION = 5;
function positionedRows(items) {
  const rows = [];
  for (const item of items) {
    const y = item.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) < 3);
    if (!row) rows.push((row = { y, height: 0, items: [] }));
    row.height = Math.max(row.height, item.height || Math.abs(item.transform[3]));
    row.items.push(item);
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => ({ ...r, items: r.items.sort((a, b) => a.transform[4] - b.transform[4]) }));
}
const rowText = (items) => readingPunctuation(items.map((i) => i.str.trim()).join(' '));

// Páginas mistas: uma introdução larga não pode esconder a separação das caixas
// ou das legendas mais abaixo. Só reordena regiões com um vão vertical comum.
function mixedColumnText(items, width, median) {
  const rows = positionedRows(items),
    pieces = [],
    headings = [],
    sideNotes = [];
  const minGap = Math.max(24, width * 0.07),
    maxLineGap = median * 2.7;
  const separator = (i) => /^(?:ou|or)$/i.test(i.str.trim()) && (i.height || Math.abs(i.transform[3])) >= median * 1.25 && Math.abs(i.transform[4] + i.width / 2 - width / 2) < width * 0.1;
  const split = (row) => {
    const chunks = row.items.filter((i) => !separator(i));
    const gaps = chunks
      .slice(1)
      .map((i, n) => ({ left: chunks[n].transform[4] + chunks[n].width, right: i.transform[4] }))
      .filter((g) => g.right - g.left >= minGap);
    return gaps.length === 1 ? gaps[0] : null;
  };
  const fits = (row, at) => row.items.every((i) => separator(i) || i.transform[4] + i.width <= at || i.transform[4] >= at);
  let found = false,
    needsPdf = false,
    tabular = false;
  for (let n = 0; n < rows.length; ) {
    const first = split(rows[n]);
    let last = n,
      paired = 1,
      lo = first?.left,
      hi = first?.right;
    if (first)
      for (let next = n + 1; next < rows.length && rows[next - 1].y - rows[next].y <= maxLineGap; next++) {
        const gap = split(rows[next]);
        if (gap && Math.min(hi, gap.right) - Math.max(lo, gap.left) >= minGap) {
          lo = Math.max(lo, gap.left);
          hi = Math.min(hi, gap.right);
          paired++;
          last = next;
        } else if (!gap && fits(rows[next], (lo + hi) / 2)) last = next;
        else break;
      }
    if (!first || paired < 2) {
      pieces.push({ start: n, end: n, text: rowText(rows[n].items) });
      n++;
      continue;
    }
    const at = (lo + hi) / 2;
    let start = n;
    while (start > 0 && rows[start - 1].y - rows[start].y <= maxLineGap && fits(rows[start - 1], at) && pieces.at(-1)?.start === start - 1) {
      pieces.pop();
      start--;
    }
    const region = rows.slice(start, last + 1);
    const side = (left) =>
      region
        .map((row) => rowText(row.items.filter((i) => !separator(i) && (left ? i.transform[4] < at : i.transform[4] >= at))))
        .filter(Boolean)
        .join('\n');
    const left = side(true),
      right = side(false);
    if (region[0].height >= median * 1.08)
      for (const isLeft of [true, false]) {
        const title = rowText(region[0].items.filter((i) => !separator(i) && (isLeft ? i.transform[4] < at : i.transform[4] >= at)));
        if (title && title.length <= 110 && !/[.,;:!?]$/.test(title)) headings.push(title);
      }
    const prose = Math.max(left.length, right.length) >= 70 && /[.,:!?]/.test(left + right);
    // Tabelas curtas mantêm cada associação na mesma linha: não juntar a coluna
    // dos rótulos e depois a de valores como se fossem dois parágrafos de regras.
    if (!prose) {
      needsPdf = true;
      tabular = true;
      pieces.push({ start, end: last, text: '\n' + region.map((row) => [rowText(row.items.filter((i) => i.transform[4] < at)), rowText(row.items.filter((i) => i.transform[4] >= at))].filter(Boolean).join('\t')).join('\n') + '\n' });
    } else {
      const conjunction = region.flatMap((r) => r.items).find(separator);
      const shortSide = left.length < right.length ? left : right;
      const lateral = shortSide.length < 40 && !/[.,:!?]/.test(shortSide) && !conjunction;
      if (lateral) sideNotes.push(shortSide.replace(/\s+/g, ' '));
      pieces.push({ start, end: last, text: '\n' + (lateral ? (left.length > right.length ? left : right) : [left, conjunction?.str.trim(), right].filter(Boolean).join('\n\n')) + '\n' });
      if (shortSide.length < 40) needsPdf = true;
    }
    found = true;
    n = last + 1;
  }
  return found ? { text: pieces.map((p) => p.text).join('\n'), needsPdf, headings, sideNotes, tabular } : null;
}
// Apenas margens recorrentes são suprimidas na projeção, nunca no índice fonte.
export function repeatedMargins(pages) {
  const counts = new Map();
  for (const page of pages) {
    const labels = new Set(
      page.items
        .filter((i) => i.transform && (i.transform[5] > page.height * 0.94 || i.transform[5] < page.height * 0.045))
        .map((i) => i.str?.trim())
        .filter((s) => s && s.length <= 100),
    );
    for (const label of labels) counts.set(label, (counts.get(label) || 0) + 1);
  }
  const recurring = new Set([...counts].filter(([, count]) => count >= Math.max(3, Math.ceil(pages.length * 0.5))).map(([label]) => label));
  return pages.map((page) => ({
    ...page,
    items: page.items.filter((i) => {
      if (!i.transform) return true;
      const margin = i.transform[5] > page.height * 0.94 || i.transform[5] < page.height * 0.045;
      return !margin || !(recurring.has(i.str?.trim()) || /^\d{1,3}$/.test(i.str?.trim() || ''));
    }),
  }));
}
export function columnLayout(items, width) {
  const allItems = items.filter((i) => i.str?.trim() && i.transform && i.width > 0);
  const sizes = allItems.map((i) => i.height || Math.abs(i.transform[3])).sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length * 0.9)] || 10;
  const microprint = allItems.filter((i) => (i.height || Math.abs(i.transform[3])) < bodySize * 0.5);
  // Cartas/diagramas embutidos têm microtexto em várias direções. Não converter
  // esses rótulos em parágrafos de regras; a página original permanece acessível.
  const spatial = microprint.length >= 20 && microprint.length > allItems.length * 0.45 && bodySize >= 7;
  const textItems = spatial ? allItems.filter((i) => !microprint.includes(i)) : allItems;
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
  if (spatial) gutter = null;
  const mixed = !gutter && !spatial ? mixedColumnText(textItems, width, median) : null;
  const groups = [];
  if (gutter) {
    // Títulos de largura inteira separam faixas; não são colados à coluna esquerda.
    const spanning = textItems.filter((i) => i.transform[4] < gutter - 10 && i.transform[4] + i.width > gutter + 10 && (i.height || Math.abs(i.transform[3])) >= median * 1.25).sort((a, b) => b.transform[5] - a.transform[5]);
    let top = Infinity;
    for (const boundary of [...spanning, null]) {
      const bottom = boundary ? boundary.transform[5] : -Infinity;
      const band = textItems.filter((i) => !spanning.includes(i) && i.transform[5] < top && i.transform[5] > bottom);
      groups.push(
        band.filter((i) => i.transform[4] < gutter),
        band.filter((i) => i.transform[4] >= gutter),
      );
      if (boundary) groups.push([boundary]);
      top = bottom;
    }
  } else groups.push(textItems);
  return {
    version: RULE_LAYOUT_VERSION,
    columns: gutter || mixed ? 2 : 1,
    needsPdf: spatial || !!mixed?.needsPdf,
    literalRows: spatial || !!mixed?.tabular,
    readingHeadings: mixed?.headings || [],
    readingSideNotes: mixed?.sideNotes || [],
    text:
      mixed?.text ??
      groups
        .map((group) =>
          positionedRows(group)
            .map((l) => rowText(l.items))
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
  const key = 'rule-layout-v5:' + indexCacheKey(scope || 'local', uid, view);
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
      const geometries = [],
        layouts = new Map();
      const flush = () => {
        for (const p of repeatedMargins(geometries)) layouts.set(p.page, columnLayout(p.items, p.width));
        geometries.length = 0;
      };
      for (const p of index.pages) {
        if (!valid()) return index;
        if (p.method === 'ocr-local' || !p.text.trim()) continue;
        const page = await pdf.getPage(p.page),
          viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        geometries.push({ page: p.page, items: content.items, width: viewport.width, height: viewport.height });
        if (geometries.length >= 8) flush();
        page.cleanup();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      flush();
      const pages = [];
      for (const p of index.pages) {
        if (!valid()) return index;
        let layout = p.searchLayout;
        if (layout?.version !== RULE_LAYOUT_VERSION) layout = layouts.get(p.page);
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
