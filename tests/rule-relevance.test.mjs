import test from 'node:test';
import assert from 'node:assert/strict';
import { relevance, searchKnowledge } from '../js/rule-relevance.js';
test('busca local associa assuntos e perguntas sem chamar IA', () => {
  assert.ok(relevance('Como montar o jogo?', 'Preparação', 'Distribua as peças.'));
  assert.ok(relevance('Como ganhar?', 'Condições de vitória', 'Proteja a comunidade.'));
  assert.equal(relevance('combate', 'Preparação', 'Organize a mesa.'), 0);
  assert.ok(relevance('jogo', 'Manual', 'O jogo começa com a preparação.'));
  const knowledge = {
    sources: [{ id: 'public', url: 'https://pt.wikipedia.org/', license: 'CC BY-SA 4.0' }],
    sections: [
      { title: 'Preparação', text: 'Organize as peças.', sourceId: 'public', review: 'unreviewed' },
      { title: 'Preparação rejeitada', text: 'Texto removido.', sourceId: 'public', review: 'rejected' },
    ],
  };
  const result = searchKnowledge(knowledge, 'montar');
  assert.equal(result.length, 1);
  assert.match(result[0].source, /não confirmado/);
  assert.ok(result[0].sourceUrl);
});
