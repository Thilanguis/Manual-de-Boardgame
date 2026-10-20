import { normalizeText } from './model.js';
import { findDocument, gameDocuments } from './documents.js';
import { validateProfile, profileCoverageComplete, profileSourceMatches } from './profile-facts.js';
import { knowledgeMatchesIdentity } from './information-identity.js';

export function hasStructuredProfile(knowledge, game) {
  if (!knowledge || !knowledgeMatchesIdentity(knowledge, game)) return false;
  if (!Array.isArray(knowledge.sources)) return false;
  const sources = knowledge.sources.filter((s) => s && profileSourceMatches(s, gameDocuments(game)) && (!s.pages || findDocument(game, s.documentId || 'main')?.manual.sha256 === s.sourceHash));
  if (!sources.length) return false;
  if (Object.keys(validateProfile(knowledge.profile, sources)).length) return true;
  // Uma análise nova pode concluir legitimamente que nenhum campo foi encontrado.
  // Só um marcador do servidor distingue esse caso de um profile legado vazio.
  return knowledge.profileAnalysis?.version >= 2 && knowledge.profileAnalysis.complete === true && !!knowledge.profile && Object.keys(knowledge.profile).length === 0 && sources.length === knowledge.sources.length;
}
export const hasCompleteProfile = (knowledge, game) => profileCoverageComplete(knowledge) && hasStructuredProfile(knowledge, game);

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
    if (source.profileOnly) return false;
    if (source.pages) {
      const document = findDocument(game, section.documentId || source.documentId || 'main');
      const page = source.pages.find((page) => page.page === section.page);
      return (
        !!document &&
        (source.documentId || 'main') === document.id &&
        source.sourceHash === document.manual.sha256 &&
        (section.sourceHash || source.sourceHash) === document.manual.sha256 &&
        Number.isInteger(section.page) &&
        section.page >= 1 &&
        section.page <= document.manual.pages &&
        !!page &&
        normalizeText(page.text).includes(normalizeText(section.quote))
      );
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
  if (!knowledgeMatchesIdentity(knowledge, game)) return {};
  const usable = usableKnowledge(knowledge, game);
  if (!usable) return {};
  const verifiedProfile = validateProfile(knowledge.profile, usable.sources);
  const canUse = ([key, fact]) => {
    const source = usable.sources.find((source) => source.id === fact.sourceId);
    if (!source) return false;
    if (!profileSourceMatches(source, gameDocuments(game))) return false;
    if (source.profileEligible === false || (source.profileOnly && source.profileSpecificEligible === false && /Players$|DurationMinutes$|^recommendedAge$|^edition$/.test(key))) return false;
    if (source.pages && findDocument(game, source.documentId || 'main')?.manual.sha256 !== source.sourceHash) return false;
    if (verifiedProfile[key] && JSON.stringify(verifiedProfile[key].value) === JSON.stringify(fact.value)) return true;
    if (key === 'description') return usable.sections.some((section) => section.topic === 'visao-geral' && section.sourceId === fact.sourceId && section.text === fact.value);
    const original = source.facts?.[key] ?? (['minDurationMinutes', 'maxDurationMinutes'].includes(key) ? source.facts?.durationMinutes : undefined);
    return original !== undefined && JSON.stringify(original) === JSON.stringify(fact.value);
  };
  const fields = Object.fromEntries(Object.entries(knowledge.fields || {}).filter(canUse));
  // fields é uma projeção derivada que pode estar ausente/obsoleta no cache.
  // O resumo estruturado já validado continua utilizável na identidade atual.
  if (!fields.description && verifiedProfile.description && canUse(['description', verifiedProfile.description])) fields.description = verifiedProfile.description;
  return fields;
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
