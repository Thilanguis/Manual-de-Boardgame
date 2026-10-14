import { loadPdf } from './pdf.js';
import { linesFromItems } from './recognition.js';
import { normalizeText } from './model.js';
import { ruleCategory } from './guide-model.js';
const yieldUI = () => new Promise((resolve) => setTimeout(resolve, 0));
export function detectHeadings(lines, page, outline = []) {
  const heights = lines
      .map((l) => l.height)
      .filter((h) => h > 0)
      .sort((a, b) => a - b),
    median = heights[Math.floor(heights.length / 2)] || 10;
  return lines
    .filter(
      (l) => l.text.length >= 3 && l.text.length <= 140 && !/^\d+$/.test(l.text) && (l.height >= median * 1.28 || (ruleCategory(l.text) && l.text.split(/\s+/).length <= 8) || outline.some((o) => normalizeText(o.title) === normalizeText(l.text))),
    )
    .map((l) => ({ title: l.text, page, category: ruleCategory(l.text), source: 'Título detectado; conferir no PDF' }));
}
export async function analyzePdf(blob, game, { signal, onProgress = () => {} } = {}) {
  signal?.throwIfAborted();
  onProgress({ message: 'Conferindo a versão do PDF…', current: 0, total: game.manual.pages });
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join('');
  signal?.throwIfAborted();
  if (hash !== game.manual.sha256) throw new Error('O PDF mudou durante a análise. Reabra o jogo para usar a versão atual.');
  onProgress({ message: 'Abrindo o documento completo…', current: 0, total: game.manual.pages });
  const pdf = await loadPdf(blob),
    pages = [],
    headings = [],
    outline = [];
  const cancel = () => pdf.destroy().catch(() => {});
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    async function bookmarks(items) {
      for (const item of items || []) {
        signal?.throwIfAborted();
        try {
          const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
          if (dest?.[0] !== undefined) {
            const page = typeof dest[0] === 'number' ? dest[0] + 1 : (await pdf.getPageIndex(dest[0])) + 1;
            if (page >= 1 && page <= pdf.numPages) outline.push({ title: String(item.title).slice(0, 140), page, category: ruleCategory(item.title), source: 'Bookmark do PDF' });
          }
        } catch {
          signal?.throwIfAborted();
        }
        await bookmarks(item.items);
      }
    }
    await bookmarks(await pdf.getOutline());
    let textBytes = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      signal?.throwIfAborted();
      onProgress({ message: `Analisando página ${number} de ${pdf.numPages}…`, current: number - 1, total: pdf.numPages });
      const page = await pdf.getPage(number),
        content = await page.getTextContent(),
        lines = linesFromItems(content.items),
        text = lines.map((l) => l.text).join('\n');
      textBytes += new TextEncoder().encode(text).length;
      if (textBytes > 20000000) throw new Error('O texto ultrapassa o limite de 20 MB desta versão. Nenhum índice parcial será publicado.');
      pages.push({ page: number, text });
      headings.push(...detectHeadings(lines, number, outline));
      // Sumários impressos só oferecem referências quando a página física é inequívoca.
      for (const l of lines) {
        const match = /^(.{3,100}?)\s*\.{2,}\s*(\d{1,5})$/.exec(l.text);
        if (match && Number(match[2]) <= pdf.numPages) headings.push({ title: match[1].trim(), page: number, printedPage: Number(match[2]), category: ruleCategory(match[1]), source: 'Sumário impresso; página física a confirmar' });
      }
      page.cleanup();
      await yieldUI();
    }
    signal?.throwIfAborted();
    const seen = new Set(),
      structured = [...outline, ...headings].sort((a, b) => a.page - b.page).filter((h) => !seen.has(`${h.page}:${normalizeText(h.title)}`) && seen.add(`${h.page}:${normalizeText(h.title)}`));
    onProgress({ message: 'Análise concluída.', current: pdf.numPages, total: pdf.numPages });
    return { schemaVersion: 1, gameId: game.id, sourceHash: game.manual.sha256, pageCount: pdf.numPages, pages, headings: structured, scanned: pages.filter((p) => p.text.trim().length > 40).length < Math.max(1, pdf.numPages * 0.2) };
  } finally {
    signal?.removeEventListener('abort', cancel);
    await pdf.destroy().catch(() => {});
  }
}
export function suggestedSections(index) {
  return index.headings
    .filter((h) => !h.printedPage)
    .slice(0, 60)
    .map((h, i, list) => {
      const next = list[i + 1],
        page = index.pages[h.page - 1];
      const begin = page.text.indexOf(h.title),
        end = next?.page === h.page ? page.text.indexOf(next.title, Math.max(0, begin + h.title.length)) : -1;
      const excerpt = page.text
        .slice(Math.max(0, begin), end >= 0 ? end : undefined)
        .slice(0, 5000)
        .trim();
      return { id: crypto.randomUUID(), title: h.title, text: excerpt, page: h.page, type: 'texto', reviewed: false, imageId: '', caption: '', source: h.source };
    });
}
export async function packIndex(index) {
  const blob = new Blob([JSON.stringify(index)], { type: 'application/json' });
  if (blob.size > 22000000) throw new Error('Índice muito grande para persistir nesta versão.');
  const compressed = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  if (compressed.size > 8 * 1024 * 1024) throw new Error('Índice comprimido maior que 8 MB.');
  return new Blob([compressed], { type: 'application/gzip' });
}
export async function unpackIndex(blob, game) {
  let size = 0;
  const stream = blob
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          size += chunk.length;
          if (size > 22000000) throw new Error('Índice excede o limite de leitura.');
          controller.enqueue(chunk);
        },
      }),
    );
  const data = JSON.parse(await new Response(stream).text());
  if (
    data.schemaVersion !== 1 ||
    data.gameId !== game.id ||
    data.sourceHash !== game.manual.sha256 ||
    !Array.isArray(data.pages) ||
    !Array.isArray(data.headings) ||
    data.pages.length !== data.pageCount ||
    data.pages.some((p, i) => p.page !== i + 1 || typeof p.text !== 'string')
  )
    throw new Error('O índice não corresponde ao manual atual. Analise novamente o PDF.');
  return data;
}
