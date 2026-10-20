import { selectedFields } from './research-client.js';
import { verifiedKnowledgeFields } from './knowledge-model.js';

// Apenas conhecimento já salvo e vinculado à versão atual do PDF. Pesquisar não
// dispara outra geração nem transfere aprovações de outra edição.
export function savedKnowledgeCandidate(record, game) {
  const knowledge = record?.knowledge;
  const hash = game.manual?.sha256;
  if (!knowledge || !hash || !Array.isArray(knowledge.sources)) return null;
  const fields = {},
    fieldOrigins = {},
    evidence = {};
  for (const [key, fact] of Object.entries(verifiedKnowledgeFields(knowledge, game))) {
    const source = knowledge.sources.find((source) => source.id === fact.sourceId && (Array.isArray(source.pages) || source.profileOnly));
    if (!source || !selectedFields({ fields: { [key]: fact.value } }, {}).length) continue;
    if (key === 'description') {
      const section = knowledge.sections?.find(
        (section) => section.topic === 'visao-geral' && section.review !== 'rejected' && section.text === fact.value && section.sourceId === source.id && (section.sourceHash || source.sourceHash) === source.sourceHash,
      );
      if (!section && !knowledge.profile?.description) continue;
      evidence[key] = { page: fact.page || section?.page, excerpt: fact.quote || section?.quote };
    }
    fields[key] = fact.value;
    fieldOrigins[key] = source.modelOnly ? 'gemini-model' : fact.generated || knowledge.profile?.[key] || key === 'description' ? (source.pages ? 'gemini' : 'gemini-public') : source.pages ? 'pdf' : source.catalogSource;
    evidence[key] = {
      ...evidence[key],
      excerpt: fact.excerpt || fact.quote || source.fieldEvidence?.[key]?.excerpt || evidence[key]?.excerpt,
      ...(fact.page ? { page: fact.page, evidenceId: fact.evidenceId } : {}),
      ...(source.pages
        ? { documentId: source.documentId || 'main', sourceHash: source.sourceHash }
        : {
            url: source.fieldEvidence?.[key]?.url || source.url,
            license: source.license,
            licenseUrl: source.licenseUrl,
            authorsUrl: source.authorsUrl,
            derivedFrom: source.independenceKey || 'wikimedia',
            editionUnconfirmed: source.editionConfirmed !== true,
            ...(source.fieldEvidence?.[key] ? { claim: source.fieldEvidence[key] } : {}),
          }),
      sourceId: source.id,
      ...(source.modelOnly ? { basis: 'model', verified: false, model: source.model } : {}),
    };
  }
  if (!Object.keys(fields).length) return null;
  return {
    source: 'gemini',
    id: game.id || `draft-${hash}`,
    manualHash: hash,
    identifiers: { manual: hash },
    fields,
    fieldOrigins,
    names: [{ value: game.title, language: game.language }],
    identityHints: (knowledge.identityHints || [])
      .filter((h) => knowledge.sources.some((s) => s.id === h.sourceId && s.sourceHash === h.sourceHash && s.pages?.some((p) => p.page === h.page && p.text.includes(h.value))))
      .map((h) => ({ value: h.value, language: h.language, origin: 'gemini-hint' })),
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
