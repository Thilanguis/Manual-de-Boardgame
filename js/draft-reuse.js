import { normalizeText } from './model.js';
import { validateProfile } from './profile-facts.js';
import { currentKnowledgeStatus } from './knowledge-status.js';

// O hash permite reaproveitar evidências; não prova que um título/edição novo
// corresponde ao contexto analisado. Mudanças de IDs locais são permitidas.
export function recontextualizeDraft(record, game, documents) {
  record = currentKnowledgeStatus(record);
  const knowledge = record?.knowledge;
  if (!knowledge) return record;
  const hashes = documents.map((d) => d.manual?.sha256 || d.sourceHash).sort();
  const sources = (knowledge.sources || []).filter((s) => s.pages);
  const sameHashes = JSON.stringify(hashes) === JSON.stringify(sources.map((s) => s.sourceHash).sort());
  const primary = documents.find((d) => d.id === (game.primaryDocumentId || 'main')) || documents[0];
  const primaryHash = game.manual?.sha256 || primary?.manual?.sha256 || primary?.sourceHash;
  const samePrimary = !sources.length || (sources.find((s) => s.documentId === 'main') || sources[0]).sourceHash === primaryHash;
  const sameRoles = sources.every((s) => {
    const d = documents.find((d) => (d.manual?.sha256 || d.sourceHash) === s.sourceHash);
    return !s.documentType || (s.documentType || 'principal') === (d?.documentType || 'principal');
  });
  const publicSources = (knowledge.sources || []).filter((s) => s.profileOnly);
  const profile = validateProfile(knowledge.profile, [...sources, ...publicSources]);
  const proven = (key, value) => !!profile[key] && normalizeText(profile[key].value) === normalizeText(value);
  const title = !knowledge.title || normalizeText(knowledge.title) === normalizeText(game.title) || proven('title', game.title);
  const edition = knowledge.edition === undefined || (knowledge.edition || '') === (game.edition || '') || (!knowledge.edition && proven('edition', game.edition));
  if (!sameHashes || !samePrimary || !sameRoles || !title || !edition)
    return {
      status: 'identity_changed',
      knowledge: null,
      analysisOrigin: 'cache',
      message: 'A análise salva corresponde a outra identificação. Use Completar informações para analisar o nome, a edição e os PDFs atuais. Isso poderá consumir uma nova geração; nenhuma foi iniciada ao abrir.',
    };
  const bind = (item) => ({ ...item, documentId: documents.find((d) => (d.manual?.sha256 || d.sourceHash) === item.sourceHash)?.id || item.documentId });
  return {
    ...record,
    knowledge: {
      ...knowledge,
      title: game.title,
      edition: game.edition || '',
      sources: [...sources.map(bind), ...publicSources],
      sections: (knowledge.sections || []).map(bind),
      profile: Object.fromEntries(Object.entries(knowledge.profile || {}).map(([key, field]) => [key, bind(field)])),
    },
  };
}
