import { gameDocuments } from './documents.js';
export const RULE_ASSISTANT_PROTOCOL = 1;
// Limites técnicos de cada requisição, sem cota de uso ou teto de perguntas.
// historyTurns limita somente o histórico guardado, não a duração da conversa.
export const RULE_ASSISTANT_LIMITS = Object.freeze({ question: 1000, context: 24000, passages: 12, historyTurns: 4, timeoutMs: 30000, outputTokens: 2048 });
export function assistantIdentity(game) {
  return JSON.stringify([
    game.id,
    game.title,
    game.edition || '',
    gameDocuments(game)
      .map((d) => [d.id, d.manual.sha256, d.edition || '', d.documentType || 'principal'])
      .sort((a, b) => a[0].localeCompare(b[0])),
  ]);
}
export const compatibleRuleDocument = (game, document, selected) => {
  if (document.edition && (selected.edition || game.edition) && document.edition !== (selected.edition || game.edition)) return false;
  if (document.documentType === 'expansao' || selected.documentType === 'expansao') return document.id === selected.id;
  return true;
};
