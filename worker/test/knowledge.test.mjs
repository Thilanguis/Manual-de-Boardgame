import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeStore, KNOWLEDGE_MODEL, knowledgeKey, knowledgeFields, validateSynthesis, synthesizePublicKnowledge, collectPublicKnowledge, preserveKnowledgeCorrections } from '../src/game-knowledge.js';
import { knowledgeFixture } from '../../tests/knowledge-fixture.mjs';
import { resetCatalogCache } from '../src/catalog/io.js';

const source = { id: 'source1', url: 'https://pt.wikipedia.org/?curid=1', name: 'Autores da Wikipédia', language: 'pt', license: 'CC BY-SA 4.0', facts: { description: 'Um jogo cooperativo em que a equipe precisa proteger a comunidade.' } };
const synthesis = () => ({
  language: 'pt-BR',
  sections: [{ topic: 'visao-geral', title: 'Visão geral', text: 'A equipe coopera para proteger a comunidade.', sourceId: 'source1', quote: 'jogo cooperativo' }],
  unconfirmed: ['A preparação desta edição não foi confirmada.'],
});
function memoryStorage() {
  const map = new Map();
  let chain = Promise.resolve();
  const store = { get: async (key) => structuredClone(map.get(key)), put: async (key, value) => map.set(key, structuredClone(value)) };
  store.transaction = (fn) => {
    const task = chain.then(() => fn(store));
    chain = task.catch(() => {});
    return task;
  };
  return store;
}
const operation = (store, path, data) => new KnowledgeStore({ storage: store }).fetch(new Request(`https://internal${path}`, data ? { method: 'POST', body: JSON.stringify({ key: 'game1', ...data }) } : undefined));

test('correções têm prioridade por referência sem eliminar outros assuntos da mesma categoria', () => {
  const manual = { id: 'manual-1', documentId: 'main', sourceHash: 'a'.repeat(64), pages: [{ page: 1, text: 'Evidência da primeira ação.' }] };
  const corrected = { id: 'saved', topic: 'acoes', documentId: 'main', sourceHash: manual.sourceHash, sourceId: manual.id, page: 1, quote: 'Evidência da primeira ação.', text: 'Correção do administrador', review: 'manual' };
  const previous = { sections: [corrected], sources: [manual] };
  const next = {
    sections: [
      { ...corrected, text: 'Tentativa de substituir correção', review: 'unreviewed' },
      { ...corrected, id: 'another', page: 2, quote: 'Outra evidência', text: 'Outra ação válida', review: 'unreviewed' },
    ],
    sources: [manual],
  };
  const result = preserveKnowledgeCorrections(next, previous);
  assert.deepEqual(
    result.sections.map((section) => section.text),
    ['Correção do administrador', 'Outra ação válida'],
  );
  assert.equal(preserveKnowledgeCorrections(next, previous, [{ id: 'main', hash: 'b'.repeat(64) }]).sections[0].review, 'unreviewed', 'não transporta correção para outra versão do PDF');
});

test('ao adicionar um PDF, correções dos documentos inalterados acompanham o novo contexto', async () => {
  const store = memoryStorage(),
    hash = 'a'.repeat(64);
  const prior = {
    sections: [{ id: 'old', sourceId: 'manual', sourceHash: hash, documentId: 'main', topic: 'acoes', page: 1, quote: 'Fonte da regra', text: 'Correção preservada', review: 'manual' }],
    sources: [{ id: 'manual', sourceHash: hash, documentId: 'main', pages: [{ page: 1, text: 'Fonte da regra' }] }],
  };
  await store.put('job:prior', { knowledge: prior, status: 'ready' });
  await store.put('latest:game', 'job:prior');
  const { record } = await (await operation(store, '/claim', { requestId: 'new' })).json();
  await operation(store, '/finish', {
    lease: record.lease,
    gameId: 'game',
    documents: [
      { id: 'main', hash },
      { id: 'extra', hash: 'b'.repeat(64) },
    ],
    status: 'ready',
    knowledge: { sections: [], sources: [] },
  });
  const restored = await (await operation(store, '/?key=game1')).json();
  assert.equal(restored.knowledge.sections[0].text, 'Correção preservada');
  assert.equal(await store.get('latest:game'), 'job:game1');
});
test('conhecimento exige evidência literal de uma fonte consultada e saída em PT-BR', () => {
  const good = validateSynthesis(synthesis(), [source]);
  assert.equal(good.sections.length, 1);
  assert.equal(good.sections[0].review, 'unreviewed');
  for (const mutation of [(s) => (s.language = 'en'), (s) => (s.sections[0].sourceId = 'inventada'), (s) => (s.sections[0].quote = 'A regra inventada não está na fonte')]) {
    const input = synthesis();
    mutation(input);
    assert.throws(() => validateSynthesis(input, [source]));
  }
});

test('regra específica sem edição confirmada não entra no conhecimento geral', () => {
  const input = synthesis();
  input.sections.push({ ...input.sections[0], topic: 'preparacao', title: 'Preparação' });
  const result = validateSynthesis(input, [{ ...source, scope: 'edition-unconfirmed' }]);
  assert.equal(result.sections.length, 1);
  assert.match(result.unconfirmed.join(' '), /edição/);
  const confirmed = validateSynthesis(input, [{ ...source, scope: 'edition-confirmed' }]);
  assert.equal(confirmed.sections.length, 2);
});
test('identidade do conhecimento distingue título, edição e hash quando a edição é desconhecida', async () => {
  const game = { id: 'one', title: 'Catan', manual: { sha256: 'a'.repeat(64) } };
  assert.notEqual(await knowledgeKey(game), await knowledgeKey({ ...game, manual: { sha256: 'b'.repeat(64) } }));
  assert.notEqual(await knowledgeKey({ ...game, edition: '1995' }), await knowledgeKey({ ...game, edition: '2025' }));
  assert.equal(await knowledgeKey({ ...game, edition: '2025' }), await knowledgeKey({ ...game, edition: '2025', manual: { sha256: 'b'.repeat(64) } }));
});
test('síntese não envia PDF, OCR, perfil, UID, tokens nem usa ferramentas ou grounding', async () => {
  const game = { id: 'private-id', title: 'Ilha Privada', edition: '', manual: { text: 'SEGREDO_PDF' }, profile: { email: 'privado@example.test' }, ocr: 'SEGREDO_OCR' };
  const result = await synthesizePublicKnowledge(game, [source], { GEMINI_API_KEY: 'SERVER_SECRET' }, async (url, options) => {
    assert.ok(url.endsWith(`${KNOWLEDGE_MODEL}:generateContent`));
    assert.equal(options.headers['x-goog-api-key'], 'SERVER_SECRET');
    for (const secret of ['SEGREDO_PDF', 'SEGREDO_OCR', 'private-id', 'privado@example.test', 'SERVER_SECRET']) assert.ok(!options.body.includes(secret));
    const input = JSON.parse(options.body);
    assert.equal(input.tools, undefined);
    assert.equal(input.cachedContent, undefined);
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(synthesis()) }] } }] });
  });
  assert.equal(result.model, KNOWLEDGE_MODEL);
  assert.equal(result.sources[0].license, source.license);
  assert.equal(result.sections[0].review, 'unreviewed');
});
test('falhas, quota e saída inválida não produzem conhecimento falso nem fallback pago', async () => {
  for (const status of [429, 403, 500])
    await assert.rejects(
      synthesizePublicKnowledge({ title: 'Catan' }, [source], { GEMINI_API_KEY: 'x' }, async () => new Response(null, { status })),
      (e) => e.status === (status === 429 ? 429 : 502),
    );
  await assert.rejects(
    synthesizePublicKnowledge({ title: 'Catan' }, [source], { GEMINI_API_KEY: 'x' }, async () => {
      throw new Error('rede');
    }),
    (e) => e.status === 504,
  );
  await assert.rejects(synthesizePublicKnowledge({ title: 'Catan' }, [source], { GEMINI_API_KEY: 'x' }, async () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }] })));
  await assert.rejects(synthesizePublicKnowledge({ title: 'Catan' }, [], { GEMINI_API_KEY: 'x' }, () => assert.fail('Sem fonte não chama o provedor.')));
  await assert.rejects(synthesizePublicKnowledge({ title: 'Catan' }, [source], { GEMINI_API_KEY: 'x', GEMINI_MODEL: 'paid-pro' }, () => assert.fail('Não usa modelo diferente.')));
});
test('lease e deduplicação persistem entre instâncias, abas, concorrência e recarga', async () => {
  const store = memoryStorage();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => operation(store, '/claim', { requestId: `request-${i}` }).then((r) => r.json())));
  assert.equal(results.filter((r) => r.claimed).length, 1);
  const running = results.find((r) => r.claimed).record;
  const knowledge = { sections: validateSynthesis(synthesis(), [source]).sections, sources: [source] };
  await operation(store, '/finish', { lease: running.lease, status: 'ready', knowledge });
  for (let i = 0; i < 5; i++) assert.equal((await (await operation(store, '/claim', { requestId: `refresh-${i}` })).json()).claimed, false);
  const value = await (await operation(store, '/?key=game1')).json();
  assert.equal(value.status, 'ready');
  assert.equal((await store.get('quota')).count, 1);
});
test('sem chave, falha de geração e término incerto não causam tentativas automáticas', async () => {
  const store = memoryStorage();
  await operation(store, '/pending', {});
  await operation(store, '/pending', {});
  assert.equal(await store.get('quota'), undefined);
  const claim = await (await operation(store, '/claim', { requestId: 'a' })).json();
  await operation(store, '/finish', { lease: claim.record.lease, status: 'attention', message: 'Rede indisponível' });
  assert.equal((await (await operation(store, '/claim', { requestId: 'b' })).json()).claimed, false);
  assert.equal((await store.get('quota')).count, 1);
});
test('revisão usa versão, preserva correções e rejeições na atualização solicitada', async () => {
  const store = memoryStorage();
  const first = await (await operation(store, '/claim', { requestId: 'a' })).json();
  const knowledge = { sections: validateSynthesis(synthesis(), [source]).sections, sources: [source] };
  await operation(store, '/finish', { lease: first.record.lease, status: 'ready', knowledge });
  const reviewed = await (await operation(store, '/review', { revision: 1, sections: [{ id: knowledge.sections[0].id, text: 'Meu texto revisado', review: 'accepted' }] })).json();
  assert.equal(reviewed.knowledge.sections[0].review, 'manual');
  assert.equal((await operation(store, '/review', { revision: 1, sections: [] })).status, 409);
  const fresh = await (await operation(store, '/claim', { requestId: 'b', force: true })).json();
  assert.equal(fresh.claimed, true);
  await operation(store, '/finish', { lease: fresh.record.lease, status: 'ready', knowledge: { sections: validateSynthesis(synthesis(), [source]).sections, sources: [source] } });
  const value = await (await operation(store, '/?key=game1')).json();
  assert.equal(value.knowledge.sections[0].text, 'Meu texto revisado');
  assert.equal((await (await operation(store, '/claim', { requestId: 'b', force: true })).json()).claimed, false, 'Retry da mesma atualização é idempotente.');
  assert.equal((await (await operation(store, '/claim', { requestId: 'a', force: true })).json()).claimed, false, 'Uma resposta perdida anterior não gera de novo após outra atualização.');
});
test('cota persistente global limita novas gerações, inclusive em outros jogos', async () => {
  const store = memoryStorage();
  for (const key of ['a', 'b']) assert.equal((await (await operation(store, '/claim', { key, requestId: key })).json()).claimed, true);
  const denied = await operation(store, '/claim', { key: 'c', requestId: 'c' });
  assert.equal(denied.status, 429);
  const record = await denied.json();
  assert.equal(record.reason, 'app-rate-limit');
  assert.equal(record.quotaScope, 'minute');
  assert(record.retryAt > Date.now() && record.retryAt <= Date.now() + 60000);
  assert.equal((await store.get('quota')).count, 2);
});

test('limite diário informa a próxima virada UTC e preserva conhecimento existente', async () => {
  const store = memoryStorage();
  const day = new Date().toISOString().slice(0, 10);
  const knowledge = { sections: [{ text: 'Texto já revisado' }] };
  await store.put('quota', { day, count: 5, recent: [] });
  await store.put('job:game1', { status: 'ready', knowledge, revision: 3 });
  const response = await operation(store, '/claim', { requestId: 'limited', force: true });
  const record = await response.json();
  assert.equal(response.status, 429);
  assert.equal(record.quotaScope, 'day');
  assert.equal(record.retryAt, Date.parse(`${day}T00:00:00Z`) + 86400000);
  assert.deepEqual(record.knowledge, knowledge);
  assert.match(record.message, /5 gerações/);
  assert.equal((await store.get('quota')).count, 5);
});

test('conectores reais consultam três títulos em português com fontes simuladas e preservam a origem', async () => {
  resetCatalogCache();
  const fixture = knowledgeFixture(),
    env = { FIREBASE_PROJECT_ID: 'fixture', OWNER_UID: 'owner' },
    identity = { uid: 'owner', token: 'fixture' };
  const fetcher = async (url, options) => {
    if (String(url).includes('/documents/users/')) return Response.json({ fields: { uid: { stringValue: 'owner' }, status: { stringValue: 'approved' }, role: { stringValue: 'superadmin' } } });
    return fixture.fetch(url, options);
  };
  for (const title of ['Catan', 'Azul', 'O Senhor dos Anéis: Sina da Sociedade']) {
    const result = await collectPublicKnowledge({ title, edition: '', sources: {} }, env, identity, fetcher);
    assert.equal(result.diagnostics.length, 2);
    assert.ok(result.sources.some((s) => s.name === 'Wikidata'));
    assert.ok(result.sources.some((s) => s.name === 'Autores da Wikipédia'));
    assert.ok(result.sources.every((s) => ['CC0', 'CC BY-SA 4.0'].includes(s.license) && s.url.startsWith('https://') && s.fetchedAt && s.scope === 'edition-unconfirmed'));
    assert.ok(result.sources.some((s) => s.facts.article?.includes(title)));
  }
  assert.equal(fixture.calls.length, 0, 'Pesquisa de fontes não gera conhecimento sozinha.');
  assert.ok(fixture.publicCalls.filter((url) => url.includes('wikidata.org')).every((url) => new URL(url).searchParams.get('maxlag') === '5'));
});

test('sugestões de cadastro guardam fonte, preservam duração e omitem divergências', () => {
  const knowledge = {
    sections: [{ topic: 'visao-geral', text: 'Resumo em português.', sourceId: 'one', review: 'unreviewed' }],
    sources: [
      { id: 'one', language: 'en', license: 'CC0', url: 'https://www.wikidata.org/', facts: { durationMinutes: 75, minPlayers: 3, maxPlayers: 4, recommendedAge: 10 } },
      { id: 'two', facts: { recommendedAge: 12 } },
    ],
  };
  const fields = knowledgeFields(knowledge);
  assert.equal(fields.minDurationMinutes.value, 75);
  assert.equal(fields.maxDurationMinutes.value, 75);
  assert.equal(fields.description.language, 'pt-BR');
  assert.equal(fields.description.generated, true);
  assert.equal(fields.minPlayers.sourceId, 'one');
  assert.equal(fields.recommendedAge, undefined);
  knowledge.sections[0].review = 'rejected';
  assert.equal(knowledgeFields(knowledge).description, undefined);
});
