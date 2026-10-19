import test from 'node:test';
import assert from 'node:assert/strict';
import { createInformationFlow } from '../js/information-flow.js';
import { inspectProfile } from '../js/profile-facts.js';
import { savedKnowledgeCandidate } from '../js/research-enrichment.js';
import { consolidateMetadata, metadataUpdates } from '../js/metadata-consolidation.js';
import { usableKnowledge } from '../js/knowledge-model.js';
const hash = 'a'.repeat(64);
const manual = { id: 'manual-1', documentId: 'main', sourceHash: hash, scope: 'edition-confirmed', pages: [{ page: 1, text: 'Escolha cartas e passe a mão restante aos jogadores. Quem tiver mais pontos vence.' }] };
const pub = {
  id: 'public-1',
  profileOnly: true,
  scope: 'work-metadata',
  profileEligible: true,
  profileSpecificEligible: true,
  contextManualHashes: [hash],
  catalogSource: 'wikidata',
  language: 'en',
  url: 'https://www.wikidata.org/wiki/Q123',
  license: 'CC0',
  independenceKey: 'wikimedia',
  facts: { recommendedAge: 8, minDurationMinutes: 20, maxDurationMinutes: 20 },
};
const fact = (value) => ({ value, sourceId: pub.id, quote: JSON.stringify(pub.facts) });
const game = { title: 'Teste', manual: { sha256: hash, pages: 1 } };
function record() {
  const profile = inspectProfile({ recommendedAge: fact(8), minDurationMinutes: fact(20), maxDurationMinutes: fact(20) }, [manual, pub]).fields;
  return { status: 'ready', knowledge: { title: game.title, sources: [manual, pub], profile, fields: profile, sections: [] } };
}
test('ficha pública validada chega à consolidação com fonte, sem virar evidência do PDF', () => {
  const candidate = savedKnowledgeCandidate(record(), game),
    model = consolidateMetadata(game, [candidate]);
  assert.equal(model.fields.recommendedAge, 8);
  assert.equal(model.fields.minDurationMinutes, 20);
  assert.equal(model.fields.maxDurationMinutes, 20);
  assert.equal(model.fieldSources.recommendedAge.source, 'gemini-public');
  assert.equal(model.fieldSources.recommendedAge.url, pub.url);
  assert.equal(model.fieldSources.recommendedAge.independenceKey, 'wikimedia');
  assert.equal(model.fieldSources.recommendedAge.evidence.page, undefined);
});
test('fatos públicos ligados à análise não migram para outro PDF de mesmo título', () => {
  const candidate = savedKnowledgeCandidate(record(), { ...game, manual: { sha256: 'b'.repeat(64), pages: 1 } });
  assert.equal(candidate, null);
});
test('fonte pública de edição incompatível não reaparece pelo fallback de campos', () => {
  const value = record();
  value.knowledge.sources = [manual, { ...pub, profileSpecificEligible: false }];
  assert.equal(savedKnowledgeCandidate(value, game), null);
});
test('duração fixa estruturada recupera o limite omitido da resposta Gemini', () => {
  const result = inspectProfile({ minDurationMinutes: fact(20) }, [pub]);
  assert.equal(result.fields.minDurationMinutes.value, 20);
  assert.equal(result.fields.maxDurationMinutes.value, 20);
});
test('fonte reservada à ficha não fornece uma seção de regras', () => {
  const value = record().knowledge;
  value.sections = [{ sourceId: pub.id, text: 'Regra inventada', quote: JSON.stringify(pub.facts), topic: 'acoes' }];
  assert.equal(usableKnowledge(value, game).sections.length, 0);
});
test('resumo validado do Gemini prevalece sobre rótulo curto do catálogo e texto automático, preservando revisão manual', () => {
  const ai = {
    source: 'gemini',
    id: 'ai',
    manualHash: hash,
    fields: { description: 'Escolha cartas e passe a mão, formando conjuntos para marcar pontos.' },
    evidence: { description: { page: 1, sourceHash: hash, excerpt: manual.pages[0].text } },
    names: [{ value: game.title, language: 'pt-BR' }],
    language: 'pt-BR',
    edition: '',
    kind: 'unknown',
  };
  const catalog = { source: 'wikidata', id: 'Q123', fields: { description: 'jogo de cartas' }, names: [{ value: game.title, language: 'pt-BR' }], language: 'pt-BR', license: 'CC0', kind: 'unknown' };
  const model = consolidateMetadata(game, [ai, catalog]);
  assert.equal(model.fields.description, ai.fields.description);
  assert.equal(metadataUpdates(model, { ...game, description: 'Texto automático', sources: { description: { source: 'PDF · objetivo' } } }).description, ai.fields.description);
  assert.equal(metadataUpdates(model, { ...game, description: 'Meu resumo', sources: { description: { source: 'Conferido e ajustado por você' } } }).description, undefined);
});
test('completar repassa pesquisa conjunta tanto ao rascunho quanto à atualização salva', async () => {
  let current = { ...game },
    options;
  const repo = {
    session: { user: { uid: 'owner' }, storageStatus: { profileMetadataProtocol: 2, knowledgeConfigured: true, manualAiEnabled: true } },
    generateKnowledge: async (g, o) => {
      options = o;
      return { status: 'running' };
    },
  };
  const flow = createInformationFlow({
    getRepository: () => repo,
    getCurrent: () => current,
    canUse: () => true,
    draftProfile: {
      cancel() {},
      async prepare(o) {
        options = o;
      },
    },
    onRecord() {},
    onStatus() {},
    observe(r, g, c) {
      return { refresh: async () => c.onRecord(null), update: c.onRecord, close() {} };
    },
  });
  await flow.complete({ includePublic: true });
  assert.equal(options.includePublic, true);
  assert.equal(options.retry, true);
  flow.stop();
  current = { ...game, id: 'saved' };
  await flow.complete({ includePublic: true });
  assert.equal(options.includePublic, true);
  assert.equal(options.expectedIdentity.title, game.title);
  flow.stop();
});
