import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleTopics, ruleTopicResults } from '../js/rule-topics.js';
import { usableKnowledge } from '../js/knowledge-model.js';
import { searchKnowledge } from '../js/rule-relevance.js';

const hash = 'a'.repeat(64);
const document = { id: 'main', name: 'Manual', language: 'pt-BR', manual: { sha256: hash, pages: 3 } };
const pageText = 'MANOBRA\nO herói pode se deslocar até três espaços e depois realizar uma ação.';
const context = () => ({ documents: [document], indexes: [{ document, index: { sourceHash: hash, language: 'pt-BR', pages: [{ page: 2, text: pageText }], headings: [{ title: 'MANOBRA', category: 'Mecânicas', page: 2 }] } }] });

test('assunto Gemini abre a seção que o originou sem pesquisar o rótulo genérico', () => {
  const game = { documents: { main: document } };
  const knowledge = usableKnowledge(
    {
      sources: [{ id: 'manual', documentId: 'main', sourceHash: hash, pages: [{ page: 2, text: pageText }] }],
      sections: [
        {
          id: 'movement',
          title: 'Manobra dos heróis',
          topic: 'mecanicas',
          text: 'Cada herói pode se deslocar antes de realizar outra ação.',
          sourceId: 'manual',
          documentId: 'main',
          sourceHash: hash,
          page: 2,
          quote: 'O herói pode se deslocar até três espaços',
        },
      ],
    },
    game,
  );
  assert.equal(searchKnowledge(knowledge, 'Mecânicas').length, 0, 'reproduz a falha antiga');
  const ctx = { ...context(), knowledge };
  const topic = ruleTopics(ctx).find((t) => t.title === 'Manobra dos heróis');
  assert(topic);
  assert.match(topic.sources[0], /Gemini · manual · p. 2/);
  const result = ruleTopicResults(ctx, topic.id)[0];
  assert.equal(result.title, 'Manobra dos heróis');
  assert.equal(result.sourceHash, hash);
  assert.equal(result.page, 2);
});

test('atalhos preservam títulos reais e páginas físicas; sumário e rodapés não viram assuntos', () => {
  const ctx = context();
  ctx.indexes[0].index.headings.push({ title: 'COMBATE', page: 2, printedPage: 10 }, { title: '2 Livro de Regras', page: 2 }, { title: 'maior, muito menos sobre quais ações tomar.', page: 2 });
  const topics = ruleTopics(ctx);
  assert.deepEqual(
    topics.map((t) => t.title),
    ['MANOBRA'],
  );
  const result = ruleTopicResults(ctx, topics[0].id)[0];
  assert.equal(result.page, 2);
  assert.equal(result.documentId, 'main');
  assert.match(result.text, /três espaços/);
  assert.equal(ruleTopicResults(ctx, 'assunto inexistente').length, 0);
});

test('documento substituído e cabeçalhos sem conteúdo pesquisável não criam botões', () => {
  const ctx = context();
  ctx.indexes[0].index.sourceHash = 'b'.repeat(64);
  assert.deepEqual(ruleTopics(ctx), []);
  ctx.indexes[0].index.sourceHash = hash;
  ctx.indexes[0].index.pages[0].text = '';
  assert.deepEqual(ruleTopics(ctx), []);
});

test('título antigo misturado não abre outro assunto da mesma página; small caps são apenas apresentação', () => {
  const ctx = context();
  ctx.indexes[0].index.pages[0].text = 'MANOBRA\nA visão geral da montagem está no início do manual. Mova até três espaços.';
  ctx.indexes[0].index.headings.push({ title: 'Visão Geral MontaGeM', page: 2 });
  assert.deepEqual(
    ruleTopics(ctx).map((t) => t.title),
    ['MANOBRA'],
  );
  ctx.indexes[0].index.headings[0].title = 'ManoBra';
  const topic = ruleTopics(ctx)[0];
  assert.equal(topic.title, 'Manobra');
  assert.equal(ruleTopicResults(ctx, topic.id)[0].title, 'Manobra');
  assert.match(ctx.indexes[0].index.pages[0].text, /^MANOBRA/);
});

test('título traduzido mantém o destino da página traduzida e a evidência original', () => {
  const ctx = context();
  const original = 'MOVEMENT\nMove up to three spaces.';
  ctx.indexes[0].document = { ...document, language: 'en' };
  ctx.indexes[0].index.language = 'en';
  ctx.indexes[0].index.headings = [{ page: 2, title: 'MOVEMENT', translation: { targetLanguage: 'pt-BR', sourceText: 'MOVEMENT', text: 'MOVIMENTO' } }];
  ctx.indexes[0].index.pages = [{ page: 2, text: original, translation: { targetLanguage: 'pt-BR', sourceText: original, text: 'MOVIMENTO\nMova até três espaços.' } }];
  const topic = ruleTopics(ctx)[0];
  assert.equal(topic.title, 'MOVIMENTO');
  const result = ruleTopicResults(ctx, topic.id)[0];
  assert.match(result.text, /três espaços/);
  assert.equal(result.originalText, original);
  assert.equal(result.page, 2);
});
