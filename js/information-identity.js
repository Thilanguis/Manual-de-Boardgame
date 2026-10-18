import { normalizeText } from './model.js';
import { gameDocuments, primaryDocumentId } from './documents.js';

export function informationIdentity(game, uid = '', documents = gameDocuments(game)) {
  return JSON.stringify([uid, game?.id || '', normalizeText(game?.title || ''), game?.edition || '', game?.manual?.sha256 || '', documents.map((d) => [d.id, d.manual?.sha256 || '', d.manual?.driveFileId || ''])]);
}

export function knowledgeMatchesIdentity(knowledge, game) {
  const primary = gameDocuments(game).find((d) => d.id === primaryDocumentId(game));
  if (primary && primary.manual?.sha256 !== game.manual?.sha256) return false;
  return !knowledge || ((!knowledge.title || normalizeText(knowledge.title) === normalizeText(game.title)) && (knowledge.edition === undefined || knowledge.edition === (game.edition || '')));
}
