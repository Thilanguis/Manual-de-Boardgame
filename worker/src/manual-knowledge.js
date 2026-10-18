import { ApiError } from './auth.js';
import { getDocument, requireProjectFile, driveToken } from './services.js';
import { gameDocuments } from '../../js/documents.js';
import { extractMetadata } from '../../js/recognition.js';

async function readLimited(stream, limit) {
  const reader = stream.getReader(),
    parts = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new ApiError(413, 'O índice é grande demais para gerar conhecimento nesta versão. A busca no PDF continua disponível.');
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(parts);
}

// O servidor lê somente índices já vinculados ao jogo. Nenhum texto arbitrário do cliente.
export async function collectManualKnowledge(game, env, identity, fetcher = fetch) {
  const sources = [],
    missing = [];
  let characters = 0;
  const documents = gameDocuments(game);
  if (!documents.length || documents.length > 12) throw new ApiError(422, 'Cadastre ao menos um manual válido.');
  for (const [position, document] of documents.entries()) {
    const record = await getDocument(env, `games/${game.id}/indexes/${document.id}`, identity.token, fetcher);
    if (!record?.fileId || record.sourceHash !== document.manual.sha256) {
      missing.push(document.id);
      continue;
    }
    const file = await requireProjectFile(env, record.fileId, { gameId: game.id, kind: 'documentIndex', documentId: document.id, sourceHash: document.manual.sha256 }, fetcher);
    if (file.mimeType !== 'application/gzip' || Number(file.size) > 8388608) throw new ApiError(422, 'O índice do manual tem formato ou tamanho inválido.');
    const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(record.fileId)}?alt=media`, { headers: { Authorization: `Bearer ${await driveToken(env, fetcher)}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok || !response.body) throw new ApiError(503, 'Não foi possível ler o índice salvo do manual.');
    const packed = await readLimited(response.body, 8388608);
    let index;
    try {
      index = JSON.parse(await (await readLimited(packed.stream().pipeThrough(new DecompressionStream('gzip')), 4000000)).text());
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(422, 'O índice salvo está inválido. Prepare novamente este documento.');
    }
    if (
      index.schemaVersion !== 1 ||
      index.gameId !== game.id ||
      (index.documentId || 'main') !== document.id ||
      index.sourceHash !== document.manual.sha256 ||
      !Array.isArray(index.pages) ||
      index.pageCount !== document.manual.pages ||
      index.pages.length !== index.pageCount ||
      index.pages.some((p, i) => p.page !== i + 1 || typeof p.text !== 'string')
    )
      throw new ApiError(409, 'O índice não corresponde à versão atual do manual.');
    if (index.analysisComplete === false || index.pages.some((p) => p.text.trim().length < 40 && !p.ocrStatus)) {
      missing.push(document.id);
      continue;
    }
    const pages = index.pages.map((p) => ({ page: p.page, text: p.text.trim() }));
    characters += pages.reduce((n, p) => n + p.text.length, 0);
    if (characters > 200000) throw new ApiError(413, 'Os manuais excedem o limite de texto da geração. Nenhuma página foi omitida silenciosamente.');
    const metadata = extractMetadata(pages.map((page) => page.text).join('\n'));
    const facts = Object.fromEntries(
      ['minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes', 'durationMinutes', 'recommendedAge', 'tags', 'mechanics', 'gameType']
        .filter((key) => metadata[key] != null && metadata[key] !== '' && (!Array.isArray(metadata[key]) || metadata[key].length))
        .map((key) => [key, metadata[key]]),
    );
    sources.push({
      id: `manual-${position + 1}`,
      name: document.name || 'Manual do jogo',
      language: document.language || game.language,
      license: 'Manual fornecido pelo proprietário',
      url: '',
      scope: 'edition-confirmed',
      fetchedAt: Date.now(),
      documentId: document.id,
      profileEligible: document.documentType !== 'expansao' && !(game.edition && document.edition && game.edition !== document.edition),
      documentType: document.documentType || 'principal',
      edition: document.edition || '',
      sourceHash: document.manual.sha256,
      pageCount: index.pageCount,
      pages,
      incompletePages: pages.filter((p) => p.text.length < 40).map((p) => p.page),
      facts,
    });
  }
  return { sources, missing, diagnostics: [{ source: 'manual', state: missing.length ? 'waiting' : 'ok', count: sources.length }] };
}

export function manualPassages(page, sourceId) {
  const passages = [];
  let start = 0;
  while (start < page.text.length) {
    let end = Math.min(start + 900, page.text.length);
    if (end < page.text.length) {
      const space = page.text.lastIndexOf(' ', end);
      if (space > end - 150) end = space;
    }
    passages.push({ id: `${sourceId}-p${page.page}-${passages.length + 1}`, text: page.text.slice(start, end) });
    start = end;
  }
  return passages;
}

export function synthesisSources(sources) {
  // IDs internos e hashes ficam no Acervo; o provedor recebe só evidência e páginas.
  return sources.map((source) => (source.pages ? { id: source.id, name: source.name, language: source.language, scope: source.scope, pages: source.pages.map((page) => ({ page: page.page, passages: manualPassages(page, source.id) })) } : source));
}
