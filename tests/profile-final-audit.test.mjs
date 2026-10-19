import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMetadata } from '../js/recognition.js';
import { pendingOcrPages } from '../js/pdf-knowledge.js';
import { portugueseCandidate } from '../js/catalog-language.js';
import { discoveryQueries } from '../js/game-identities.js';
import * as profile from '../js/profile-facts.js';
import { textQuality } from '../js/text-quality.js';
import { recontextualizeDraft } from '../js/draft-reuse.js';
import { queryVariants, titleMatches } from '../js/game-identities.js';
import { addOcrPage, extendOcrIndex } from '../js/pdf-knowledge.js';
import { createTextTranslator } from '../js/translation.js';
import { manualPassages, synthesisSources } from '../worker/src/manual-knowledge.js';
import { hasStructuredProfile } from '../js/knowledge-model.js';

const broken = 'Descent: Lendas da Escuridão é um jogo ' + '□'.repeat(60) + ' para um a quatro jogadores. ' + '□'.repeat(50);
test('descrição corrompida não vira sinopse; jogadores legíveis são preservados', () => {
  const result = extractMetadata(broken);
  assert.equal(result.description, '');
  assert.equal(result.minPlayers, 1);
  assert.equal(result.maxPlayers, 4);
});
test('índice longo com glifos inválidos solicita OCR; página válida permanece intacta', () => {
  assert.deepEqual(
    pendingOcrPages({
      pages: [
        { page: 1, text: broken, extracted: true },
        { page: 2, text: 'Preparação do jogo. Organize as cartas e distribua os componentes aos jogadores.' },
      ],
    }),
    [1],
  );
});
test('corrupção não entra na fila de tradução', () => {
  const next = portugueseCandidate({ source: 'pdf', id: 'x', language: 'other', fields: { description: broken, minPlayers: 1, maxPlayers: 4 } });
  assert.equal(next.pendingTranslations.length, 0);
  assert.equal(next.fields.description, undefined);
});
test('descoberta por nome da franquia funciona sem dois-pontos', () => {
  assert.deepEqual(discoveryQueries('Descent Lendas da Escuridão'), ['Descent']);
});
test('validação da ficha informa campos retornados, rejeitados e ausentes', () => {
  assert.equal(typeof profile.inspectProfile, 'function');
  const result = profile.inspectProfile({ recommendedAge: { value: 14, sourceId: 'inexistente' } }, []);
  assert.equal(result.analysis.returned, 1);
  assert.equal(result.analysis.valid, 0);
  assert.equal(result.analysis.rejected[0].key, 'recommendedAge');
  assert.equal(result.analysis.rejected[0].reason, 'source');
});
test('qualidade não rejeita alfabetos válidos nem marcadores isolados', () => {
  for (const value of [
    '日本語の説明書では、プレイヤーは協力して目的を達成します。カードを準備して順番に行動します。'.repeat(2),
    'Игроки совместно выполняют действия и достигают цели игры. Подготовьте карты и жетоны.',
    'ضع البطاقات على الطاولة ثم تعاون مع اللاعبين لتحقيق هدف اللعبة.',
    '□ Opção de preparação: distribua as cartas aos participantes e organize o tabuleiro.',
  ])
    assert.equal(textQuality(value).readable, true);
  assert.equal(textQuality('Introdução ' + '\uFFFD'.repeat(30)).corrupt, true);
  assert.equal(textQuality('Introdução ' + '\uE123'.repeat(30)).corrupt, true);
});
test('OCR recupera somente a página corrompida, conserva original e não repete na retomada', async () => {
  const blob = new Blob(['fixture local']);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())).toString('hex');
  const index = {
    gameId: 'x',
    sourceHash: hash,
    pageCount: 2,
    headings: [],
    pages: [
      { page: 1, text: broken, extracted: true, searchLayout: { invalid: true } },
      { page: 2, text: 'Preparação do jogo. Organize as cartas e distribua os componentes aos jogadores.' },
    ],
  };
  const original = structuredClone(index.pages[1]);
  let calls = 0;
  const options = {
    recognize: async (_, task) => {
      calls++;
      assert.deepEqual(task.pages, [1]);
      await task.onPage({ page: 1, status: 'done', text: 'Descent é um jogo cooperativo para um a quatro jogadores que exploram Terrinoth.', confidence: 95 });
    },
  };
  await extendOcrIndex(blob, { id: 'x', manual: { sha256: hash } }, index, options);
  assert.equal(index.pages[0].originalText, broken);
  assert.equal(index.pages[0].searchLayout, undefined);
  assert.equal(index.pages[0].ocrStatus, 'done');
  assert.deepEqual(index.pages[1], original);
  await extendOcrIndex(blob, { id: 'x', manual: { sha256: hash } }, index, options);
  assert.equal(calls, 1);
});
test('tradução e payload Gemini não recebem passagem corrompida', async () => {
  let calls = 0;
  const translator = createTextTranslator({
    provider: {
      create() {
        calls++;
      },
    },
  });
  await assert.rejects(translator.translate(broken, { sourceLanguage: 'en' }), /ilegível/);
  assert.equal(calls, 0);
  const sources = synthesisSources([{ id: 'manual', pages: [{ page: 1, text: broken }] }]);
  assert.deepEqual(sources[0].pages[0].passages, []);
  assert.deepEqual(manualPassages({ page: 1, text: broken }, 'manual'), []);
});
test('cache por hash aceita correção comprovada ou pontuação; rejeita outra obra/edição', () => {
  const hash = 'a'.repeat(64),
    sources = [{ id: 'm', documentId: 'main', sourceHash: hash, pages: [{ page: 1, text: 'Descent: Lendas da Escuridão' }] }];
  const record = { status: 'ready', knowledge: { title: 'Descent: Lendas da Escuridão', edition: '', sources, profile: {} } };
  const documents = [{ id: 'new-id', manual: { sha256: hash } }];
  assert.equal(recontextualizeDraft(record, { title: 'Descent Lendas da Escuridão' }, documents).knowledge.sources[0].documentId, 'new-id');
  for (const game of [{ title: 'Outro jogo' }, { title: record.knowledge.title, edition: 'Outra edição' }]) assert.equal(recontextualizeDraft(record, game, documents).knowledge, null);
  assert.equal(recontextualizeDraft(record, { title: record.knowledge.title }, [{ id: 'main', manual: { sha256: 'b'.repeat(64) } }]).knowledge, null);
  const corrected = structuredClone(record);
  corrected.knowledge.title = 'Nome do arquivo';
  corrected.knowledge.profile.title = { value: record.knowledge.title, sourceId: 'm', page: 1, quote: sources[0].pages[0].text };
  assert.equal(recontextualizeDraft(corrected, { title: record.knowledge.title }, documents).knowledge.title, record.knowledge.title);
});
test('preferência PT continua EN/FR; alias Gemini é pista e não confirma identidade', () => {
  const input = { query: 'Descent Lendas da Escuridão', preferredLanguage: 'pt-BR', alternateTitles: [{ value: 'Descent: Legends of the Dark', language: 'en', origin: 'gemini-hint' }] };
  assert.deepEqual([...new Set(queryVariants(input).map((p) => p.language))].sort(), ['en', 'fr', 'pt']);
  assert(queryVariants(input).some((p) => p.query.includes('Legends')));
  assert.equal(titleMatches({ names: [{ value: 'Descent: Legends of the Dark' }] }, input), false);
});
test('ficha vazia do contrato antigo não bloqueia atualização explícita; contrato novo vazio é reutilizável', () => {
  const hash = 'a'.repeat(64),
    game = { title: 'Jogo', manual: { sha256: hash, pages: 1 } };
  const knowledge = { title: 'Jogo', sources: [{ id: 'm', documentId: 'main', sourceHash: hash, pages: [{ page: 1, text: 'Manual sem informações da ficha.' }] }], profile: {}, profileAnalysis: { version: 1, complete: true } };
  assert.equal(hasStructuredProfile(knowledge, game), false);
  knowledge.profileAnalysis.version = 2;
  assert.equal(hasStructuredProfile(knowledge, game), true);
});
