import { normalizeText } from './model.js';
import { findDocument } from './documents.js';

export const KNOWLEDGE_TOPICS = {
  'visao-geral': 'Visão geral',
  objetivo: 'Objetivo',
  preparacao: 'Preparação',
  componentes: 'Componentes',
  turnos: 'Turnos',
  acoes: 'Ações',
  combate: 'Combate',
  movimento: 'Movimento',
  pontuacao: 'Pontuação',
  vitoria: 'Vitória',
  mecanicas: 'Mecânicas',
  conceitos: 'Conceitos',
  estrategias: 'Estratégias',
  perguntas: 'Dúvidas frequentes',
};

// Uma explicação validada é utilizável sem aprovação. A revisão registra apenas
// correções posteriores; nunca autoriza misturar documentos ou versões.
export function usableKnowledge(knowledge, game) {
  if (!knowledge) return null;
  const sources = knowledge.sources || [];
  const sections = (knowledge.sections || []).filter((section) => {
    if (section.review === 'rejected' || !section.text?.trim()) return false;
    const source = sources.find((source) => source.id === section.sourceId);
    if (!source || !section.quote || !normalizeText(section.quote)) return false;
    if (source.pages) {
      const document = findDocument(game, section.documentId || source.documentId || 'main');
      const page = source.pages.find((page) => page.page === section.page);
      return !!document && (source.documentId || 'main') === document.id && source.sourceHash === document.manual.sha256 && (section.sourceHash || source.sourceHash) === document.manual.sha256 && Number.isInteger(section.page) && section.page >= 1 && section.page <= document.manual.pages && !!page && normalizeText(page.text).includes(normalizeText(section.quote));
    }
    return normalizeText(JSON.stringify(source.facts || {})).includes(normalizeText(section.quote));
  });
  return { ...knowledge, sources, sections };
}

export function knowledgeSummary(record, game) {
  const knowledge = usableKnowledge(record?.knowledge, game);
  return {
    sections: knowledge?.sections || [],
    documents: (knowledge?.sources || []).filter((source) => source.pages && findDocument(game, source.documentId || 'main')?.manual.sha256 === source.sourceHash),
    analyzedAt: knowledge?.analyzedAt || knowledge?.generatedAt || record?.analyzedAt || 0,
    limitations: [...new Set([...(knowledge?.unconfirmed || []), ...(knowledge?.sources || []).flatMap((source) => (source.incompletePages?.length ? [`${source.name}: páginas ${source.incompletePages.join(', ')} sem texto legível.`] : []))])],
  };
}

export function verifiedKnowledgeFields(knowledge, game) {
  const usable = usableKnowledge(knowledge, game);
  if (!usable) return {};
  return Object.fromEntries(Object.entries(knowledge.fields || {}).filter(([key, fact]) => {
    const source = usable.sources.find((source) => source.id === fact.sourceId);
    if (!source) return false;
    if (source.pages && findDocument(game, source.documentId || 'main')?.manual.sha256 !== source.sourceHash) return false;
    if (key === 'description') return usable.sections.some((section) => section.topic === 'visao-geral' && section.sourceId === fact.sourceId && section.text === fact.value);
    const original = source.facts?.[key] ?? (['minDurationMinutes', 'maxDurationMinutes'].includes(key) ? source.facts?.durationMinutes : undefined);
    return original !== undefined && JSON.stringify(original) === JSON.stringify(fact.value);
  }));
}

export function emptyKnowledgeFields(game, fields) {
  const result = {};
  for (const [key, fact] of Object.entries(fields || {})) {
    const value = game[key],
      originKey = ['minPlayers', 'maxPlayers'].includes(key) ? 'players' : ['minDurationMinutes', 'maxDurationMinutes'].includes(key) ? 'duration' : key;
    const origin = game.sources?.[originKey];
    if (origin?.confirmedAt || /conferido|corrigido|ajustado por voc/i.test(origin?.source || '')) continue;
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) result[key] = fact.value;
  }
  return result;
}
