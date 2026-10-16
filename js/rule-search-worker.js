import { searchRules, searchDocuments } from './guide-model.js';
import { searchKnowledge } from './rule-relevance.js';
let indexes = [],
  documents = [],
  index = null,
  guide = null,
  knowledge = null,
  currentHash = '';
self.onmessage = ({ data }) => {
  if (data.type === 'context') {
    ({ index, guide, currentHash } = data);
    knowledge = data.knowledge || null;
    indexes = data.indexes || [];
    documents = data.documents || [];
    return;
  }
  if (data.type === 'query') {
    try {
      const pdfResults = indexes.length ? searchDocuments(indexes, guide, data.query, documents) : searchRules(index, guide, data.query, { currentHash });
      self.postMessage({ id: data.id, results: [...pdfResults, ...searchKnowledge(knowledge, data.query)].sort((a, b) => b.score - a.score).slice(0, 60) });
    } catch {
      self.postMessage({ id: data.id, error: 'Não foi possível pesquisar este índice. Analise novamente o PDF.' });
    }
  }
};
