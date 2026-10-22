import { searchRules, searchDocuments } from './guide-model.js';
import { searchKnowledge, rankRuleResults } from './rule-relevance.js';
import { ruleTopicResults } from './rule-topics.js';
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
      if (data.topicId) {
        self.postMessage({ id: data.id, query: data.query.trim(), results: ruleTopicResults({ indexes, documents, guide, knowledge }, data.topicId) });
        return;
      }
      const pdfResults = indexes.length ? searchDocuments(indexes, guide, data.query, documents) : searchRules(index, guide, data.query, { currentHash });
      self.postMessage({ id: data.id, query: data.query.trim(), results: rankRuleResults([...pdfResults, ...searchKnowledge(knowledge, data.query)]) });
    } catch {
      self.postMessage({ id: data.id, query: data.query.trim(), error: 'Não foi possível pesquisar este índice. Analise novamente o PDF.' });
    }
  }
};
