import { gameDocuments } from './documents.js';
export const RULE_ASSISTANT_PROTOCOL = 1;
// Orçamento exclusivo das perguntas. Não altera limites da ficha/manuais.
export const RULE_ASSISTANT_LIMITS = Object.freeze({ perUserDay: 10, perAppDay: 30, concurrent: 2, question: 1000, context: 24000, passages: 12, turns: 4, timeoutMs: 30000, outputTokens: 2048 });
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
