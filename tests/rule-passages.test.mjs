import test from 'node:test';
import assert from 'node:assert/strict';
import { searchRules } from '../js/guide-model.js';
import { searchKnowledge, rankRuleResults, ruleMatch } from '../js/rule-relevance.js';
import { cleanRuleText, contextualExcerpt, duplicatePassage } from '../js/rule-passages.js';

test('Componentes usa sua seção, sem herdar o objetivo nem palavras de outros trechos da página', () => {
  const text = 'VISÃO GERAL E OBJETIVO\nAlcance os objetivos antes do oponente.\nCOMPONENTES\n• 12 cartas.\n• 8 fichas.\nPREPARAÇÃO\nColoque as cartas na mesa.';
  const index = {
    sourceHash: 'current',
    language: 'pt-BR',
    pages: [{ page: 1, text }],
    headings: [
      { page: 1, title: 'VISÃO GERAL E OBJETIVO' },
      { page: 1, title: 'COMPONENTES' },
    ],
  };
  const before = JSON.stringify(index);
  const result = searchRules(index, null, 'Componentes', { currentHash: 'current' })[0];
  assert.equal(result.title, 'COMPONENTES');
  assert.equal(result.matchType, 'direct');
  assert.match(result.text, /12 cartas/);
  assert.doesNotMatch(result.text, /objetivos|Coloque/);
  assert(index.pages[0].text.includes(result.originalText));
  assert.equal(result.page, 1);
  assert.equal(JSON.stringify(index), before, 'índice e evidências são imutáveis');
  assert.equal(ruleMatch('Componentes', 'Custos de cartas e peças', 'Pague uma moeda.').score, 0);
  assert.equal(ruleMatch('Componentes', 'Objetivo', 'Alcance a vitória.', 'componentes').score, 0, 'um tópico incorreto não torna a explicação relevante');
});

test('vitória não é sinônimo de fim de capítulo; perguntas PT/EN/FR correspondem ao assunto', () => {
  assert.equal(ruleMatch('Condições de vitória', 'Fim de um capítulo', 'Prepare o próximo capítulo.').score, 0);
  assert.equal(ruleMatch('Como ganhar?', 'Fim da partida', 'Alcance o objetivo.').matchType, 'direct');
  assert.equal(ruleMatch('Como funciona um turno?', 'Visão geral do turno', 'Revezem as ações.').matchType, 'direct');
  assert.equal(ruleMatch('Quanto custa jogar uma carta?', 'Custos de cartas', 'Pague duas moedas.').matchType, 'direct');
  assert.equal(ruleMatch('Comment préparer la partie?', 'PREPARATION', 'Placez les cartes.').matchType, 'direct');
  assert.equal(ruleMatch('How can I attack?', 'Combat', 'Spend one action.').matchType, 'direct');
});

test('prioridade de IA/correção só se aplica a respostas relevantes; cópias não se repetem', () => {
  const knowledge = {
    sources: [{ id: 'pdf', pages: [], sourceHash: 'current' }],
    sections: [
      { title: 'Objetivo', topic: 'objetivo', text: 'Reúna os componentes e alcance a vitória.', sourceId: 'pdf', sourceHash: 'current' },
      { title: 'Componentes', topic: 'componentes', text: 'O manual contém doze cartas e oito fichas.', sourceId: 'pdf', sourceHash: 'current', review: 'manual' },
    ],
  };
  const pdf = { title: 'Componentes', text: 'O manual contém doze cartas e oito fichas.', sourceHash: 'current', page: 2, ...ruleMatch('componentes', 'Componentes', '') };
  const result = rankRuleResults([pdf, ...searchKnowledge(knowledge, 'componentes')]);
  assert.equal(result[0].corrected, true);
  assert.equal(result[0].matchType, 'direct');
  assert.equal(result.length, 2);
  assert.equal(result[1].matchType, 'related');
  assert.equal(result[0].additionalReferences[0].page, 2);
});

test('formatação une linhas artificiais, mantém parágrafos/listas e não corta frases ou referências', () => {
  const raw = 'Gaste uma ação para\nabrir a porta.\n\n• Pegue 2 cartas.\n• Não descarte fichas.\n\n1. Pague o custo.\n2. Resolva a carta.\nVeja pág. 4 do manual.';
  const clean = cleanRuleText(raw);
  assert.match(clean, /Gaste uma ação para abrir a porta/);
  assert.match(clean, /\n\n• Pegue 2 cartas\.\n\n• Não descarte fichas/);
  const long = 'Consulte a regra. ' + 'Texto adicional completo sobre a preparação. '.repeat(20);
  const result = contextualExcerpt(long, '', 100);
  assert.equal(result.hasMore, true);
  assert.match(result.preview, /[.!?]$/);
  assert.equal(result.text, cleanRuleText(long));
  assert(!contextualExcerpt('Veja pág. 4 do manual. Depois jogue.', '', 30).preview.endsWith('pág.'));
});

test('deduplicação preserva diferenças de custo, negação, edição e ordem das instruções', () => {
  const text = 'O sobrevivente deve gastar uma ação e mover uma peça para o espaço adjacente antes de consultar a carta de referência.';
  assert(duplicatePassage({ text }, { text: text.replace(' uma ação', '\n uma ação') }));
  assert(!duplicatePassage({ text: 'Pague 2 moedas.' }, { text: 'Pague 3 moedas.' }));
  assert(!duplicatePassage({ text: 'Descarte uma carta.' }, { text: 'Não descarte uma carta.' }));
  assert(!duplicatePassage({ text, sourceHash: 'a' }, { text, sourceHash: 'b' }));
  assert(!duplicatePassage({ text }, { text: 'Antes de consultar a carta de referência, o sobrevivente deve mover uma peça para o espaço adjacente e gastar uma ação.' }));
});

test('título de sumário não transforma ocorrências distantes em respostas diretas', () => {
  const text = 'CONTEÚDO\nComponentes..............4\nPreparação...............6\nObjetivos................8';
  const result = searchRules({ sourceHash: 'a', pages: [{ page: 2, text }], headings: [{ page: 2, title: 'Preparação', printedPage: 6, source: 'Sumário impresso' }] }, null, 'preparação', { currentHash: 'a' });
  assert.equal(result[0].matchType, 'related');
});

test('manual estrangeiro com projeção pesquisa apenas a passagem; original completo não contamina relevância', () => {
  const text = 'OBJECTIVE\nReach the volcano before the enemy.\nCOMPONENTS\nThere are twelve cards and eight tokens.\nSETUP\nPlace the cards on the table.';
  const index = { sourceHash: 'current', language: 'en', pages: [{ page: 1, text, searchLayout: { version: 1, text, columns: 2 } }], headings: [] };
  const results = rankRuleResults(searchRules(index, null, 'Componentes', { currentHash: 'current' }));
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Componentes');
  assert.equal(results[0].needsTranslation, true);
  assert.equal(results[0].originalText, text);
  assert.doesNotMatch(results[0].searchText, /volcano|Place/);
});
