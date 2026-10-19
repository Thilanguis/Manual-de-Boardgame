import { recognizePdfImages, COVER_OCR_VERSION } from './pdf-ocr.js';
import { ruleCategory } from './guide-model.js';
import { normalizeText } from './model.js';
import { textQuality, readablePage } from './text-quality.js';

export function ocrHeading(title) {
  if (title.length < 3 || title.length > 140 || !ruleCategory(title)) return false;
  const plain = normalizeText(title);
  if (/^(?:de|da|do|das|dos) /.test(plain)) return false;
  const capitalHeading = /[A-ZÀ-Ý]/.test(title) && title === title.toLocaleUpperCase() && plain.split(' ').length <= 8;
  const namedHeading =
    /^(?:\d+ )?(?:objetivo(?: da partida| do jogo)?|preparacao(?: da partida| do jogo)?|componentes|materiais|conteudo|turnos?|turno de jogo|estrutura do turno|realizar acoes|acoes(?: disponiveis)?|regras (?:especiais|importantes|gerais)|habilidades|combate|batalha|pontuacao|vitoria e derrota|fim (?:do jogo|da partida)|como completar objetivos|perguntas frequentes|duvidas frequentes|setup|preparation|mise en place|but du jeu|objectif|components|composants|turn sequence|game turn|actions|special rules|combat|scoring|game end|victory|defeat|fin de partie|victoire|defaite|capacites|pouvoirs|faq)$/.test(
      plain,
    );
  return capitalHeading || namedHeading;
}

export function pendingOcrPages(index, retry = false) {
  return index.pages.filter((page) => !readablePage(page) && (retry ? ['failed', 'low-confidence'].includes(page.ocrStatus) : !page.ocrStatus || (page.ocrStatus === 'done' && textQuality(page.text).corrupt))).map((page) => page.page);
}
export function ocrCoverage(index) {
  return { readable: index.pages.filter(readablePage).length, total: index.pageCount, pending: pendingOcrPages(index).length, failed: index.pages.filter((p) => ['failed', 'low-confidence'].includes(p.ocrStatus)).length };
}
export const needsCoverRecovery = (index) => !!index?.pages?.[0] && !readablePage(index.pages[0]) && (index.pages[0].coverOcrVersion || 0) < COVER_OCR_VERSION;
export function addOcrPage(index, page) {
  if (!Number.isInteger(page.page) || page.page < 1 || page.page > index.pageCount) throw new Error('Página OCR fora do manual.');
  const old = index.pages[page.page - 1];
  if (readablePage(old)) return index;
  const text = String(page.text || old.text || '').slice(0, 30000);
  const recovered = page.status === 'done' && readablePage({ text });
  index.pages[page.page - 1] = {
    ...old,
    originalText: old.originalText ?? old.text,
    page: page.page,
    text: recovered ? text : old.text,
    ocrStatus: page.status === 'done' && !recovered ? 'low-confidence' : page.status,
    confidence: page.confidence || 0,
    ...(page.coverOcrVersion ? { coverOcrVersion: page.coverOcrVersion } : {}),
    quality: textQuality(recovered ? text : old.text),
    ...(recovered ? { searchLayout: undefined, translation: undefined } : {}),
    method: recovered ? 'ocr-local' : old.method || 'ocr-local',
  };
  index.headings = index.headings.filter((heading) => heading.page !== page.page || heading.source !== 'PDF · OCR local; revisar');
  if (recovered)
    for (const line of text.split('\n')) {
      const title = line.trim(),
        category = ruleCategory(title);
      if (ocrHeading(title) && !index.headings.some((heading) => heading.page === page.page && normalizeText(heading.title) === normalizeText(title))) index.headings.push({ title, category, page: page.page, source: 'PDF · OCR local; revisar' });
    }
  index.headings.sort((a, b) => a.page - b.page);
  index.ocr = ocrCoverage(index);
  index.scanned = index.ocr.readable < index.pageCount;
  index.revision = (index.revision || 0) + 1;
  return index;
}
export async function extendOcrIndex(blob, game, index, { signal, onProgress = () => {}, checkpoint = async () => {}, recognize = recognizePdfImages, retry = false, allPages = true, coverRecovery = false } = {}) {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join('');
  signal?.throwIfAborted();
  if (index.sourceHash !== hash || hash !== game.manual.sha256 || index.gameId !== game.id) throw new Error('O PDF mudou. Analise o manual atual antes de continuar.');
  const planned = [...new Set([...pendingOcrPages(index, retry), ...(coverRecovery && needsCoverRecovery(index) ? [1] : [])])];
  let completed = 0;
  // Uma tentativa por página nesta execução, inclusive quando ela falha.
  for (let start = 0; start < planned.length; start += 3) {
    signal?.throwIfAborted();
    await recognize(blob, {
      pages: planned.slice(start, start + 3),
      language: game.language,
      signal,
      timeoutMs: 90000,
      onProgress: (message) => onProgress({ message, current: completed, total: planned.length }),
      continueOnError: true,
      onPage: async (page) => {
        signal?.throwIfAborted();
        addOcrPage(index, page);
        completed++;
        await checkpoint(index);
        onProgress({ message: `Leitura de imagens: ${completed} de ${planned.length} páginas.`, current: completed, total: planned.length });
      },
    });
    signal?.throwIfAborted();
    if (!allPages) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return index;
}
