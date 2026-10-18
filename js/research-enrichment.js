import { selectedFields } from './research-client.js';
import { verifiedKnowledgeFields } from './knowledge-model.js';

// Apenas conhecimento já salvo e vinculado à versão atual do PDF. Pesquisar não
// dispara outra geração nem transfere aprovações de outra edição.
export function savedKnowledgeCandidate(record, game) {
  const knowledge = record?.knowledge;
  const hash = game.manual?.sha256;
  if (!knowledge || !hash || !Array.isArray(knowledge.sources)) return null;
  const fields = {},
    evidence = {};
  for (const [key, fact] of Object.entries(verifiedKnowledgeFields(knowledge, game))) {
    const source = knowledge.sources.find((source) => source.id === fact.sourceId && Array.isArray(source.pages));
    if (!source || !selectedFields({ fields: { [key]: fact.value } }, {}).length) continue;
    if (key === 'description') {
      const section = knowledge.sections?.find(
        (section) => section.topic === 'visao-geral' && section.review !== 'rejected' && section.text === fact.value && section.sourceId === source.id && (section.sourceHash || source.sourceHash) === source.sourceHash,
      );
      if (!section && !knowledge.profile?.description) continue;
      evidence[key] = { page: fact.page || section?.page, excerpt: fact.quote || section?.quote };
    }
    fields[key] = fact.value;
    evidence[key] = { ...evidence[key], ...(fact.page ? { page: fact.page, excerpt: fact.excerpt || fact.quote, evidenceId: fact.evidenceId } : {}), documentId: source.documentId || 'main', sourceHash: source.sourceHash, sourceId: source.id };
  }
  if (!Object.keys(fields).length) return null;
  return {
    source: 'gemini',
    id: game.id || `draft-${hash}`,
    manualHash: hash,
    identifiers: { manual: hash },
    fields,
    names: [{ value: game.title, language: game.language }],
    language: 'pt-BR',
    descriptionLanguage: 'pt-BR',
    edition: game.edition || '',
    kind: 'unknown',
    license: 'Sugestões geradas a partir do manual · conferir antes de usar',
    url: '',
    evidence,
    conflicts: [],
    requiresEditionReview: true,
  };
}
