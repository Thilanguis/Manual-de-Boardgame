import { searchRules } from './guide-model.js';
let index = null,
  guide = null,
  currentHash = '';
self.onmessage = ({ data }) => {
  if (data.type === 'context') {
    ({ index, guide, currentHash } = data);
    return;
  }
  if (data.type === 'query') {
    try {
      self.postMessage({ id: data.id, results: searchRules(index, guide, data.query, { currentHash }) });
    } catch {
      self.postMessage({ id: data.id, error: 'Não foi possível pesquisar este índice. Analise novamente o PDF.' });
    }
  }
};
