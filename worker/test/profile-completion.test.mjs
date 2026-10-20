import test from 'node:test';
import assert from 'node:assert/strict';
import { completeProfileFromModel } from '../src/profile-completion.js';
import { inspectProfile, profileDefinitions, modelProfileFields } from '../../js/profile-facts.js';
import { knowledgeFields, synthesizePublicKnowledge, validateSynthesis } from '../src/game-knowledge.js';
import { savedKnowledgeCandidate } from '../../js/research-enrichment.js';
import { consolidateMetadata, metadataUpdates } from '../../js/metadata-consolidation.js';
import { knowledgeFixture } from '../../tests/knowledge-fixture.mjs';
import { searchKnowledge } from '../../js/rule-relevance.js';
import { draftKnowledgeEndpoint, reusableDraftKnowledge } from '../src/draft-knowledge.js';
import { resetCatalogCache } from '../src/catalog/io.js';

const game = { id: 'draft', title: 'Sushi Go Party!', edition: '', manual: { sha256: 'e'.repeat(64), pages: 1 } };
const source = { id: 'manual', documentId: 'main', sourceHash: game.manual.sha256, profileEligible: true, language: 'pt-BR', pages: [{ page: 1, text: '' }], facts: {} };
const values = {
  description: 'Escolha cartas e passe a mão restante, reunindo combinações para marcar mais pontos.',
  minPlayers: 2,
  maxPlayers: 8,
  minDurationMinutes: 20,
  maxDurationMinutes: 20,
  recommendedAge: 8,
  tags: ['Jogo de cartas'],
  mechanics: ['Seleção de cartas', 'Coleção de conjuntos'],
  gameType: 'Competitivo',
};
const raw = (fields = values) => ({ requestedTitle: game.title, requestedEdition: '', recognized: true, fields });

test('tipo genérico de catálogo não ocupa o complemento específico do Gemini', async () => {
  const catalog = { id: 'catalog', profileOnly: true, profileEligible: true, facts: { gameType: 'Jogo de tabuleiro' } };
  const specific = 'Cartas · competitivo';
  assert.equal(knowledgeFields({ sources: [catalog], sections: [], profile: {} }).gameType, undefined);
  const completion = completeProfileFromModel(raw({ gameType: specific }), game, [source, catalog]);
  assert.equal(completion.fields.gameType.value, specific);
  assert.equal(completeProfileFromModel(raw({ gameType: 'Jogo de tabuleiro' }), game, [source]).fields.gameType, undefined);
  const fixture = knowledgeFixture();
  fixture.faults.metadata = Object.fromEntries(Object.keys(profileDefinitions).map((k) => [k, null]));
  fixture.faults.sections = [];
  fixture.faults.modelProfile = raw({ gameType: specific });
  const knowledge = await synthesizePublicKnowledge(game, [source, catalog], fixture.env, (url, options) => fixture.fetch(url, options), { completeProfile: true });
  assert.equal(fixture.calls.length, 1, 'mesma geração da ficha, sem nova chamada');
  assert.equal(knowledge.profile.gameType.value, specific);
  assert.equal(knowledge.profileAnalysis.gameTypeProtocol, 1);
  assert.match(JSON.stringify(fixture.calls[0]), /Gestão de recursos/);
  assert.match(JSON.stringify(fixture.calls[0]), /não responda apenas/);
});
const recordFrom = (completion, sources = [source]) => {
  const knowledge = { title: game.title, edition: '', profile: completion.fields, sources: [...sources, ...(completion.source ? [completion.source] : [])], sections: [] };
  return { status: 'ready', knowledge: { ...knowledge, fields: knowledgeFields(knowledge) } };
};

test('conhecimento do modelo completa nove campos, com origem explícita e sem páginas/URLs/citações inventadas', () => {
  const completion = completeProfileFromModel(raw(), game, [source], {}, 'fixture-model');
  assert.deepEqual(completion.analysis.filled.sort(), [...modelProfileFields].sort());
  const record = recordFrom(completion),
    candidate = savedKnowledgeCandidate(record, game);
  assert.deepEqual(candidate.fields, values);
  for (const key of modelProfileFields) {
    assert.equal(candidate.fieldOrigins[key], 'gemini-model');
    assert.equal(candidate.evidence[key].verified, false);
    assert.equal(candidate.evidence[key].page, undefined);
    assert.equal(candidate.evidence[key].url, '');
    assert.equal(completion.fields[key].quote, undefined);
  }
  assert.equal(completion.fields.title, undefined);
  assert.equal(completion.fields.edition, undefined);
  assert.deepEqual(searchKnowledge(record.knowledge, 'duração'), [], 'a ficha não vira explicação de regras');
});

test('fontes e metadata documentada têm prioridade; modelo não desempata fontes que se contradizem', () => {
  const backed = { id: 'catalog', profileOnly: true, profileEligible: true, facts: { minDurationMinutes: 30, maxDurationMinutes: 30, tags: ['Família'] } };
  const completion = completeProfileFromModel(raw(), game, [source, backed, { ...backed, id: 'other', facts: { minDurationMinutes: 45, maxDurationMinutes: 45 } }], { mechanics: { value: ['Mecânica documentada'] } });
  assert.equal(completion.fields.minDurationMinutes, undefined);
  assert.equal(completion.fields.maxDurationMinutes, undefined);
  assert.equal(completion.fields.tags, undefined);
  assert.equal(completion.fields.mechanics, undefined);
  assert.equal(completion.fields.recommendedAge.value, 8);
});

test('duração fixa única repete os dois campos; faixas incompletas, valores absurdos e texto corrompido não entram', () => {
  const completion = completeProfileFromModel(raw({ durationMinutes: 20, minPlayers: 8, maxPlayers: 2, recommendedAge: 999, tags: ['□□□'], gameType: 'Competitivo' }), game, [source]);
  assert.equal(completion.fields.minDurationMinutes.value, 20);
  assert.equal(completion.fields.maxDurationMinutes.value, 20);
  assert.equal(completion.fields.minPlayers, undefined);
  assert.equal(completion.fields.maxPlayers, undefined);
  assert.equal(completion.fields.recommendedAge, undefined);
  assert.equal(completion.fields.tags, undefined);
  assert.equal(completeProfileFromModel(raw({ minDurationMinutes: 20 }), game, [source]).fields.minDurationMinutes, undefined);
});

test('nome/edição modificados e jogo não reconhecido descartam o complemento do modelo', () => {
  for (const input of [
    { ...raw(), requestedTitle: 'Sushi Go' },
    { ...raw(), requestedEdition: 'Outra edição' },
    { ...raw(), recognized: false },
  ])
    assert.equal(completeProfileFromModel(input, game, [source]).source, null);
});

test('revalidação preserva a marca não verificada e rejeita alteração das afirmações salvas', () => {
  const completion = completeProfileFromModel(raw(), game, [source]);
  const fields = inspectProfile({ ...completion.fields, recommendedAge: { ...completion.fields.recommendedAge, verified: true, page: 42, quote: 'citação falsa' } }, [completion.source]).fields;
  assert.equal(fields.recommendedAge.verified, false);
  assert.equal(fields.recommendedAge.page, undefined);
  assert.equal(fields.recommendedAge.quote, undefined);
  assert.equal(inspectProfile({ ...completion.fields, recommendedAge: { ...completion.fields.recommendedAge, value: 99 } }, [completion.source]).fields.recommendedAge, undefined);
});

test('consolidação preenche lacunas sem conflito com o PDF e preserva campos existentes ou corrigidos', () => {
  const candidate = savedKnowledgeCandidate(recordFrom(completeProfileFromModel(raw(), game, [source])), game);
  const pdf = {
    source: 'pdf',
    id: 'pdf',
    manualHash: game.manual.sha256,
    fields: { minDurationMinutes: 30, maxDurationMinutes: 30 },
    evidence: { minDurationMinutes: { page: 1, excerpt: 'Duração: 30 minutos' }, maxDurationMinutes: { page: 1, excerpt: 'Duração: 30 minutos' } },
    language: 'pt-BR',
  };
  const model = consolidateMetadata(game, [candidate, pdf]);
  assert.equal(model.fields.minDurationMinutes, 30);
  assert.equal(model.alternatives.minDurationMinutes.length, 1);
  assert.notEqual(model.consistency.minDurationMinutes, 'conflict');
  const memoryOnly = consolidateMetadata(game, [candidate]);
  assert.equal(metadataUpdates(memoryOnly, { ...game, recommendedAge: 10 }).recommendedAge, undefined);
  assert.equal(metadataUpdates(memoryOnly, { ...game, description: 'Descrição já existente.' }).description, undefined);
  const previous = { ...game, minDurationMinutes: 20, maxDurationMinutes: 20, sources: { duration: { basis: 'model', verified: false, source: 'Gemini · conhecimento do modelo' } } };
  assert.equal(metadataUpdates(model, previous).minDurationMinutes, 30, 'fonte nova substitui sugestão automática não verificada');
  previous.sources.duration.confirmedAt = Date.now();
  assert.equal(metadataUpdates(model, previous).minDurationMinutes, undefined, 'confirmação humana tem prioridade');
});

test('uma chamada por nome prepara ficha sem texto legível, preservando separação entre memória e regras', async () => {
  const fixture = knowledgeFixture();
  fixture.faults.metadata = Object.fromEntries(Object.keys(profileDefinitions).map((k) => [k, null]));
  fixture.faults.sections = [];
  fixture.faults.modelProfile = raw();
  const knowledge = await synthesizePublicKnowledge(game, [source], fixture.env, (url, options) => fixture.fetch(url, options), { completeProfile: true });
  assert.equal(fixture.calls.length, 1);
  assert.equal(knowledge.profile.minDurationMinutes.value, 20);
  assert.equal(knowledge.profileAnalysis.modelCompletion.filled.length, 9);
  assert.equal(knowledge.sections.length, 0);
  assert(knowledge.unconfirmed.some((s) => s.includes('nenhuma explicação de regras')));
  const schema = fixture.calls[0].generationConfig.responseSchema;
  assert(schema.required.includes('modelProfile'));
  assert.deepEqual(schema.properties.modelProfile.properties.fields.required, modelProfileFields);
  assert.equal(fixture.calls[0].tools, undefined, 'sem Google Search Grounding');
  const modelSource = knowledge.sources.find((s) => s.modelOnly);
  const invalidRules = { language: 'pt-BR', sections: [{ topic: 'visao-geral', title: 'Regra da memória', text: 'Uma regra inventada.', sourceId: modelSource.id, quote: 'Uma regra inventada.' }], unconfirmed: [] };
  assert.equal(validateSynthesis(invalidRules, [modelSource], { allowEmpty: true }).sections.length, 0);
  await assert.rejects(
    synthesizePublicKnowledge(game, [source], fixture.env, (url, options) => fixture.fetch(url, options)),
    (e) => e.status === 422,
    'modo de regras isolado continua exigindo manual legível',
  );
});

test('cadastro sem texto: complemento é salvo, reutilizado e adotado sem inventar regras ou permitir geração ao leitor', async () => {
  resetCatalogCache();
  const fixture = knowledgeFixture();
  fixture.faults.sections = [];
  fixture.faults.metadata = Object.fromEntries(Object.keys(profileDefinitions).map((key) => [key, null]));
  fixture.faults.modelProfile = raw();
  const env = { ...fixture.env, FIREBASE_PROJECT_ID: 'demo-acervo', OWNER_UID: 'owner', ALLOW_MANUAL_AI: 'true' };
  const who = { uid: 'owner', token: 'fixture', profile: { uid: 'owner', status: 'approved', role: 'superadmin' } };
  const data = { title: game.title, edition: '', includePublic: true, retry: true, requestId: crypto.randomUUID(), documents: [{ id: 'main', hash: game.manual.sha256, name: 'manual.pdf', language: 'pt-BR', pages: [{ page: 1, text: '' }] }] };
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('firestore.googleapis.com')) {
      assert.match(String(url), /\/users\/owner$/);
      return Response.json({ fields: { uid: { stringValue: 'owner' }, status: { stringValue: 'approved' }, role: { stringValue: 'superadmin' } } });
    }
    if (String(url).includes('wikidata.org')) return Response.json({ search: [] });
    if (String(url).includes('wikipedia.org')) return Response.json({ query: { pages: [] } });
    const result = await fixture.fetch(url, options);
    if (result) return result;
    assert.fail('Destino não simulado: ' + url);
  };
  const run = (input, identity = who) => draftKnowledgeEndpoint(new Request('https://fixture.test/draft', { method: 'POST' }), env, identity, input);
  try {
    const record = await (await run(data)).json();
    assert.equal(record.status, 'ready');
    assert.equal(record.knowledge.sections.length, 0);
    assert.equal(record.knowledge.fields.minDurationMinutes.value, 20);
    await run({ ...data, requestId: crypto.randomUUID() });
    assert.equal(fixture.calls.length, 1, 'reabrir/completar novamente não repete a geração');
    const adopted = await reusableDraftKnowledge({ ...game, id: 'saved', createdBy: 'owner' }, [source], env);
    assert(adopted);
    assert.equal(adopted.profile.minDurationMinutes.verified, false);
    assert.equal(adopted.sections.length, 0);
    await assert.rejects(run(data, { uid: 'reader', profile: { uid: 'reader', role: 'user', status: 'approved' } }), (e) => e.status === 403);
    assert.equal(fixture.calls.length, 1);
  } finally {
    globalThis.fetch = previous;
    resetCatalogCache();
  }
});
