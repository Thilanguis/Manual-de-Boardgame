import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleTextLanguage } from '../js/rule-language.js';
import { searchRules } from '../js/guide-model.js';
import { ruleTopics, ruleTopicResults } from '../js/rule-topics.js';

const portuguese = 'Os jogadores escolhem cartas durante a partida. O jogador com mais pontos vence o jogo após a terceira rodada. Coloque o tabuleiro na preparação.';
test('índice desconhecido recupera português da página sem exigir tradução nem alterar o índice', () => {
  const index = { sourceHash: 'a', language: 'other', pages: [{ page: 2, text: 'CONTEÚDO\n' + portuguese, method: 'ocr-local' }], headings: [{ page: 2, title: 'CONTEÚDO' }] };
  const before = JSON.stringify(index);
  const result = searchRules(index, null, 'conteúdo', { currentHash: 'a' })[0];
  assert.equal(result.needsTranslation, false);
  assert.equal(result.language, 'pt-BR');
  assert.match(result.text, /jogadores escolhem cartas/);
  assert.equal(result.translated, false);
  assert.equal(JSON.stringify(index), before);
});

test('outro idioma e idioma realmente desconhecido continuam distintos; título não determina o idioma', () => {
  const english = 'The player places the cards on the board. Each round the players score points. During setup prepare the game pieces for victory.';
  assert.equal(ruleTextLanguage('other', english), 'en');
  assert.equal(ruleTextLanguage('en', portuguese), 'en', 'idioma confirmado continua prevalecendo');
  assert.equal(ruleTextLanguage('other', 'CONTEÚDO\nNigiri, maki, sushi rolls'), 'other');
  assert.equal(ruleTextLanguage('other', '□'.repeat(90) + portuguese), 'other');
});

test('assunto extenso da mesma página vira um cartão completo, sem perder passagens', () => {
  const text = 'CONTEÚDO\n' + Array.from({ length: 18 }, (_, i) => `Regra ${i + 1}: ${portuguese}`).join('\n\n');
  const document = { id: 'main', name: 'Manual', language: 'other', manual: { sha256: 'a', pages: 2 } };
  const index = { sourceHash: 'a', language: 'other', pages: [{ page: 2, text }], headings: [{ page: 2, title: 'CONTEÚDO' }] };
  assert(searchRules(index, null, 'conteúdo', { currentHash: 'a' }).length > 1);
  const context = { documents: [document], indexes: [{ document, index }] };
  const topic = ruleTopics(context).find((topic) => topic.title === 'CONTEÚDO');
  const results = ruleTopicResults(context, topic.id);
  assert.equal(results.length, 1);
  assert.match(results[0].text, /Regra 1:/);
  assert.match(results[0].text, /Regra 18:/);
  assert.equal(results[0].page, 2);
  assert.equal(results[0].needsTranslation, false);
});
