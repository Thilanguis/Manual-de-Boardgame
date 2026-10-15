import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMetadata, titleCandidates } from '../js/recognition.js';
import { queryVariants, reviewedIdentity } from '../js/game-identities.js';
import { researchSummary, selectedFields } from '../js/research-client.js';

test('resumo sem cabeçalho rígido preserva contexto e não incorpora componentes ou QR code', () => {
  const result = extractMetadata('Controlando os exploradores, você e seus amigos devem proteger a ilha.\nCada jogador controla personagens e, trabalhando em equipe, todos vencem juntos.\nEscaneie este QR code\nComponentes\n14 cartas e 3 dados.');
  assert.match(result.description, /Controlando/);
  assert(!result.description.includes('QR'));
  assert.equal(result.gameType, 'Cooperativo');
  assert.equal(result.recommendedAge, null);
  assert.deepEqual(result.mechanics, []);
  assert.equal(result.sources.gameType.excerpt, 'trabalhando em equipe, todos');
});
test('objetivo inline, título composto e idade por extenso têm evidência; contagens não viram idade', () => {
  const result = extractMetadata('Visão geral e objetivo: Reúna tesouros e retorne para vencer a partida.\nPreparação\nJogo para pessoas a partir de 12 anos.\nUma das mecânicas é a construção de baralho.');
  assert.match(result.description, /Reúna tesouros/);
  assert.equal(result.recommendedAge, 12);
  assert.deepEqual(result.mechanics, ['Construção de baralho']);
  assert.equal(extractMetadata('14 cartas e 10 cubos.').recommendedAge, null);
});
test('alias verificado mantém subtítulo e não confunde outros jogos Senhor dos Anéis', () => {
  const identity = reviewedIdentity('O Senhor dos Anéis — Sina da Sociedade');
  assert.equal(identity.wikidata, 'Q137295527');
  assert.equal(reviewedIdentity('O Senhor dos Anéis: Duelo pela Terra-média'), null);
  assert.equal(reviewedIdentity('O Senhor dos Anéis: Jornadas na Terra-média'), null);
  const plan = queryVariants({ query: 'O Senhor dos Anéis: Sina da Sociedade', pdfLanguage: 'pt-BR' });
  assert(plan.some((p) => p.query === 'The Lord of the Rings: Fate of the Fellowship' && p.language === 'en'));
  assert.equal(new Set(plan.map((p) => p.language + ':' + p.query)).size, plan.length);
  assert.equal(titleCandidates({ metadataTitle: 'ZMGPSM0101_Rulebook_pt-BR_v1.0.indd', filename: 'manual.pdf' })[0].text, 'O Senhor dos Anéis: Sina da Sociedade');
});
test('originais explícitos são pesquisados sem inventar idioma; números de versões não são apagados', () => {
  const plan = queryVariants({ query: 'Título brasileiro: Subtítulo 2', pdfLanguage: 'pt-BR', alternateTitles: [{ value: 'Titre original précis', language: 'other' }] });
  assert(plan.some((p) => p.query === 'Titre original précis' && p.language === 'fr'));
  assert(plan.some((p) => p.query.includes('Subtítulo 2')));
});
test('ausência em uma fonte não se apresenta como pesquisa completa enquanto catálogos exigem token', () => {
  const sources = [
    { id: 'wikidata', enabled: true },
    { id: 'ludopedia', enabled: false },
    { id: 'bgg', enabled: false },
  ];
  const summary = researchSummary(sources, new Map([['wikidata', { status: 'done', candidates: [] }]]));
  assert.match(summary, /1 de 3/);
  assert.match(summary, /Pesquisa parcial/);
  assert.match(summary, /Ludopedia/);
  assert.match(summary, /sem correspondência nas consultas realizadas/);
  const partial = researchSummary(sources, new Map([['wikidata', { status: 'done', candidates: [], diagnostics: { complete: false } }]]));
  assert.match(partial, /resposta parcial/);
  assert.equal(selectedFields({ fields: { description: 'Texto externo' }, conflicts: [] }, { description: 'Trecho confiável do PDF' })[0].checked, false);
});

test('cidades não viram idade e faixas de expansões não são fundidas com jogo básico', () => {
  assert.equal(extractMetadata('Cada cidade 2 pontos de vitória.').recommendedAge, null);
  const result = extractMetadata('Com a expansão para 5 e 6 jogadores, uma partida inclui de 3 a 6 jogadores. O jogo de dados permite de 1 a 4 jogadores.');
  assert.equal(result.minPlayers, null);
  assert.equal(result.maxPlayers, null);
  assert.match(result.sources.players.source, /faixas diferentes/);
  assert.equal(extractMetadata('Idade: 10 anos').recommendedAge, 10);
  assert.equal(extractMetadata('Âge : 8 ans').recommendedAge, 8);
  assert.equal(titleCandidates({ lines: [{ text: 'Bem-vindo ao mundo de Catan!', height: 36 }] })[0].text, 'Catan!');
  assert.deepEqual(titleCandidates({ metadataTitle: '7DUME_Rules_BR.indd', filename: 'Manual.pdf', lines: [{ text: 'Símbolos de apoio para Daltônicos', height: 36 }] }), []);
});
