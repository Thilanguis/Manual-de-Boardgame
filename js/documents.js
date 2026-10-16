export const DOCUMENT_TYPES = { principal: 'Manual de regras', complemento: 'Complemento', referencia: 'Referência', solo: 'Modo solo', faq: 'Perguntas frequentes', errata: 'Errata', expansao: 'Expansão' };
export function gameDocuments(game) {
  if (!game) return [];
  if (game.documents && Object.keys(game.documents).length) return Object.values(game.documents);
  return game.manual ? [{ id: 'main', name: String(game.manual.name || 'Manual principal').slice(0, 160), documentType: 'principal', language: game.language || 'pt-BR', edition: game.edition || '', manual: game.manual }] : [];
}
export const primaryDocumentId = (game) => game.primaryDocumentId || 'main';
export const documentGame = (game, document) => ({ ...game, manual: document.manual, language: document.language, documentId: document.id });
export function findDocument(game, id = primaryDocumentId(game)) {
  return gameDocuments(game).find((doc) => doc.id === id);
}
export function documentKind(document) {
  return document.manual.path?.includes('/documents/') ? 'document' : 'manual';
}
export function withDocument(game, document, { primary = false } = {}) {
  const documents = Object.fromEntries(gameDocuments(game).map((doc) => [doc.id, doc]));
  documents[document.id] = document;
  if (Object.keys(documents).length > 12) throw new Error('Use até 12 documentos por jogo.');
  const primaryDocument = primary ? document : documents[primaryDocumentId(game)];
  return { ...game, documents, documentChanges: !game.documents && document.id !== 'main' ? ['main', document.id] : [document.id], primaryDocumentId: primaryDocument.id, manual: primaryDocument.manual, language: primaryDocument.language };
}
export function withoutDocument(game, id) {
  if (gameDocuments(game).length < 2) throw new Error('Mantenha pelo menos um manual no jogo.');
  if (id === primaryDocumentId(game)) throw new Error('Escolha outro manual principal antes de remover este documento.');
  const documents = Object.fromEntries(
    gameDocuments(game)
      .filter((doc) => doc.id !== id)
      .map((doc) => [doc.id, doc]),
  );
  return { ...game, documents, documentChanges: [], primaryDocumentId: primaryDocumentId(game) };
}
