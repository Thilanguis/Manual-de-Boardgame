import test from 'node:test';
import assert from 'node:assert/strict';
import { collectManualKnowledge, synthesisSources, manualPassages } from '../src/manual-knowledge.js';
import { knowledgeEndpoint, synthesizePublicKnowledge, validateSynthesis, knowledgeKey } from '../src/game-knowledge.js';
import { packIndex } from '../../js/pdf-index.js';
import { searchKnowledge } from '../../js/rule-relevance.js';
import { knowledgeFixture } from '../../tests/knowledge-fixture.mjs';

const game = { id: 'private-game-id', title: 'Resident Evil — teste', edition: 'PT-BR', language: 'pt-BR', manual: { sha256: 'a'.repeat(64), pages: 2, name: 'Manual de regras' } };
const text = 'Para atacar, o sobrevivente gasta uma ação e consulta os dados indicados na carta. Não há outras ações neste exemplo de teste.';
const baseIndex = {
  schemaVersion: 1,
  gameId: game.id,
  documentId: 'main',
  sourceHash: game.manual.sha256,
  pageCount: 2,
  analysisComplete: true,
  pages: [
    { page: 1, text: 'Prepare a partida distribuindo as cartas e posicionando as miniaturas conforme o cenário selecionado.' },
    { page: 2, text },
  ],
  headings: [],
};
const env = {
  FIREBASE_PROJECT_ID: 'demo-acervo',
  LOCAL_SIMULATED_SERVICES: 'true',
  DRIVE_FOLDER_ID: 'dev-acervo-folder',
  DRIVE_OWNER_EMAIL: 'owner@example.test',
  GOOGLE_CLIENT_ID: 'fixture',
  GOOGLE_CLIENT_SECRET: 'fixture',
  GOOGLE_REFRESH_TOKEN: 'fixture',
};
async function fixture({ index = baseIndex, missing = false, permission = false, foreign = false } = {}) {
  const packed = await packIndex(index);
  return async (value, options) => {
    const url = new URL(value);
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'fixture-oauth', expires_in: 3600 });
    if (url.hostname === 'firestore.googleapis.com') {
      assert.equal(options.headers.Authorization, 'Bearer fixture-jwt');
      if (permission) return Response.json({}, { status: 403 });
      if (missing) return Response.json({}, { status: 404 });
      return Response.json({ fields: { fileId: { stringValue: 'fixture-index' }, sourceHash: { stringValue: game.manual.sha256 } } });
    }
    if (url.hostname === 'www.googleapis.com' && url.searchParams.get('alt') === 'media') return new Response(packed);
    if (url.hostname === 'www.googleapis.com')
      return Response.json({
        id: 'fixture-index',
        mimeType: 'application/gzip',
        size: packed.size,
        parents: [env.DRIVE_FOLDER_ID],
        owners: [{ me: true, emailAddress: env.DRIVE_OWNER_EMAIL }],
        appProperties: { acervoProject: env.FIREBASE_PROJECT_ID, gameId: foreign ? 'another-game' : game.id, kind: 'documentIndex', documentId: 'main', sourceHash: game.manual.sha256 },
      });
    assert.fail(`Destino inesperado: ${url.hostname}`);
  };
}
test('manual completo usa índice autorizado, conserva páginas e não consulta catálogos', async () => {
  const result = await collectManualKnowledge(game, env, { token: 'fixture-jwt' }, await fixture());
  assert.deepEqual(result.missing, []);
  assert.equal(result.sources[0].pages.length, 2);
  assert.equal(result.sources[0].pages[1].text, text);
  const sent = JSON.stringify(synthesisSources(result.sources));
  for (const privateValue of [game.id, game.manual.sha256, 'fixture-jwt']) assert.ok(!sent.includes(privateValue));
});

test('metadados explícitos do índice verificado alimentam o cadastro sem outra chamada Gemini', async () => {
  const index = structuredClone(baseIndex);
  index.pages[0].text += '\nJogadores: 1 a 5\nDuração: 60 a 150 minutos\nIdade: 14 anos';
  const result = await collectManualKnowledge(game, env, { token: 'fixture-jwt' }, await fixture({ index }));
  const facts = result.sources[0].facts;
  assert.equal(facts.minPlayers, 1);
  assert.equal(facts.maxPlayers, 5);
  assert.equal(facts.minDurationMinutes, 60);
  assert.equal(facts.maxDurationMinutes, 150);
});
test('preparo ausente ou incompleto aguarda sem gerar; hash errado e arquivo alheio são negados', async () => {
  for (const options of [{ missing: true }, { index: { ...baseIndex, analysisComplete: false } }]) {
    const result = await collectManualKnowledge(game, env, { token: 'fixture-jwt' }, await fixture(options));
    assert.deepEqual(result.missing, ['main']);
  }
  for (const options of [{ permission: true }, { foreign: true }, { index: { ...baseIndex, sourceHash: 'b'.repeat(64) } }]) await assert.rejects(collectManualKnowledge(game, env, { token: 'fixture-jwt' }, await fixture(options)));
});
test('síntese do manual exige evidência na página correta e a busca conserva o vínculo', async () => {
  const { sources } = await collectManualKnowledge(game, env, { token: 'fixture-jwt' }, await fixture());
  const raw = {
    language: 'pt-BR',
    sections: [{ topic: 'acoes', title: 'Como atacar', text: 'Gaste uma ação para atacar e consulte a carta.', sourceId: sources[0].id, page: 2, evidenceId: manualPassages(sources[0].pages[1], sources[0].id)[0].id }],
    unconfirmed: [],
  };
  const knowledge = await synthesizePublicKnowledge(game, sources, { GEMINI_API_KEY: 'fixture-secret' }, async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(JSON.parse(body.contents[0].parts[0].text).sources[0].pages.length, 2);
    assert.ok(!options.body.includes('fixture-secret'));
    assert.ok(!options.body.includes(game.id));
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] });
  });
  const results = searchKnowledge(knowledge, 'atacar');
  assert.equal(results[0].page, 2);
  assert.equal(results[0].documentId, 'main');
  assert.equal(results[0].sourceHash, game.manual.sha256);
  assert.throws(() => validateSynthesis({ ...raw, sections: [{ ...raw.sections[0], page: 1 }] }, sources));
  assert.throws(() => validateSynthesis({ ...raw, sections: [{ ...raw.sections[0], evidenceId: 'inventada', quote: 'Uma citação também inventada' }] }, sources));
  assert.equal(results[0].text, knowledge.sections[0].text);
  assert.equal(knowledge.sections[0].quote, text);
});

test('identificadores de evidência preservam todo o texto sem cortes ou citações fabricadas', () => {
  const page = { page: 3, text: 'Texto completo do manual. '.repeat(200) };
  const passages = manualPassages(page, 'manual-1');
  assert.equal(passages.map((p) => p.text).join(''), page.text);
  assert.equal(new Set(passages.map((p) => p.id)).size, passages.length);
  assert.ok(passages.every((p) => p.text.length <= 900));
});
test('manuais grandes não são cortados silenciosamente e edições confirmadas também respeitam hash', async () => {
  const tooLarge = { ...baseIndex, pages: [{ page: 1, text: 'a'.repeat(400001) }, baseIndex.pages[1]] };
  await assert.rejects(collectManualKnowledge(game, env, { token: 'fixture-jwt' }, await fixture({ index: tooLarge })), (error) => error.status === 413);
  assert.notEqual(await knowledgeKey(game, true), await knowledgeKey({ ...game, manual: { ...game.manual, sha256: 'b'.repeat(64) } }, true));
});

test('limite de texto é igual para cadastro e índice salvo: 250 mil caracteres continuam completos', async () => {
  const pages = Array.from({ length: 25 }, (_, i) => ({ page: i + 1, text: text.repeat(100).slice(0, 10000) }));
  const index = { ...baseIndex, pages, pageCount: pages.length };
  const result = await collectManualKnowledge({ ...game, manual: { ...game.manual, pages: pages.length } }, env, { token: 'fixture-jwt' }, await fixture({ index }));
  assert.equal(result.sources[0].pages.length, 25);
  assert.deepEqual(result.sources[0].pages, pages);
});
test('aguardar índice não consome quota nem impede a geração após ficar pronto', async () => {
  const { env: fixtureEnv, storage } = knowledgeFixture();
  const store = fixtureEnv.GAME_KNOWLEDGE.get();
  const call = async (path, body) => (await store.fetch(new Request(`https://knowledge.internal${path}`, { method: 'POST', body: JSON.stringify({ key: 'manual-test', ...body }) }))).json();
  const pending = await call('/pending', { status: 'waiting_index', message: 'Aguardando manual' });
  assert.equal(pending.status, 'waiting_index');
  assert.equal(await storage.get('quota'), undefined);
  assert.equal((await call('/claim', { requestId: crypto.randomUUID() })).claimed, true);
  assert.equal(await storage.get('quota'), undefined);
});

test('preparação automática só reutiliza conhecimento e nunca inicia Gemini ou cota', async () => {
  const model = knowledgeFixture(),
    transport = await fixture(),
    original = globalThis.fetch;
  const encode = (v) => (typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, value]) => [k, encode(value)])) } });
  globalThis.fetch = async (url, options) => (String(url).endsWith('/games/' + game.id) ? Response.json({ fields: Object.fromEntries(Object.entries(game).map(([k, v]) => [k, encode(v)])) }) : transport(url, options));
  try {
    const response = await knowledgeEndpoint(
      new Request('https://worker.test/knowledge', { method: 'POST' }),
      { ...env, ...model.env, OWNER_UID: 'owner', KNOWLEDGE_FROM_MANUAL: 'true', ALLOW_MANUAL_AI: 'true' },
      { uid: 'owner', token: 'fixture-jwt', profile: { uid: 'owner', role: 'superadmin', status: 'approved' } },
      game.id,
      { reuseOnly: true, requestId: crypto.randomUUID() },
    );
    assert.equal((await response.json()).status, 'not_started');
    assert.equal(model.calls.length, 0);
    assert.equal(await model.storage.get('quota'), undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test('atualização explícita da ficha legada preserva correção de regra e gasta uma única cota', async () => {
  const model = knowledgeFixture(),
    original = globalThis.fetch;
  const index = { ...baseIndex, pages: [{ page: 1, text: 'Prepare a partida para 2 a 4 jogadores. Duração: 30 a 60 minutos. Idade: 14 anos.' }, baseIndex.pages[1]] };
  const transport = await fixture({ index });
  const key = await knowledgeKey(game, true);
  const corrected = { id: 'corrected', sourceId: 'manual-old', sourceHash: game.manual.sha256, documentId: 'main', topic: 'acoes', page: 2, quote: text, text: 'Minha correção de ataque permanece.', review: 'manual' };
  await model.storage.put(`job:${key}`, {
    status: 'ready',
    revision: 1,
    knowledge: { title: game.title, edition: game.edition, sources: [{ id: 'manual-old', documentId: 'main', sourceHash: game.manual.sha256, pages: index.pages }], sections: [corrected] },
  });
  const encode = (v) => (typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, value]) => [k, encode(value)])) } });
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/games/' + game.id)) return Response.json({ fields: Object.fromEntries(Object.entries(game).map(([k, v]) => [k, encode(v)])) });
    if (String(url).endsWith('/users/owner')) return Response.json({ fields: { uid: { stringValue: 'owner' }, role: { stringValue: 'superadmin' }, status: { stringValue: 'approved' } } });
    return (await model.fetch(url, options)) || transport(url, options);
  };
  model.faults.metadata = (p) => ({ recommendedAge: { value: 14, sourceId: p.sources[0].id, page: 1, evidenceId: p.sources[0].pages[0].passages[0].id } });
  const requestId = crypto.randomUUID();
  try {
    const args = [
      new Request('https://worker.test/knowledge', { method: 'POST' }),
      { ...env, ...model.env, OWNER_UID: 'owner', KNOWLEDGE_FROM_MANUAL: 'true', ALLOW_MANUAL_AI: 'true' },
      { uid: 'owner', token: 'fixture-jwt', profile: { uid: 'owner', role: 'superadmin', status: 'approved' } },
      game.id,
      { force: true, requestId, expectedIdentity: { title: game.title, edition: game.edition, manualHash: game.manual.sha256, documents: [['main', game.manual.sha256]] } },
    ];
    await knowledgeEndpoint(...args);
    const saved = await model.storage.get(`job:${key}`);
    assert.equal(saved.status, 'ready');
    assert.equal(saved.knowledge.profile.recommendedAge.value, 14);
    assert(saved.knowledge.sections.some((s) => s.review === 'manual' && s.text === corrected.text));
    await knowledgeEndpoint(...args);
    assert.equal(model.calls.length, 1);
    assert.equal(await model.storage.get('quota'), undefined);
    args[4] = { ...args[4], requestId: crypto.randomUUID(), expectedIdentity: { ...args[4].expectedIdentity, title: 'Outro jogo' } };
    await assert.rejects(knowledgeEndpoint(...args), (e) => e.status === 409);
    assert.equal(model.calls.length, 1);
    assert.equal(await model.storage.get('quota'), undefined);
  } finally {
    globalThis.fetch = original;
  }
});
