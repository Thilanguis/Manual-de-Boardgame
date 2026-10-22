import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeStore } from '../src/game-knowledge.js';
import { ruleAssistantEndpoint, selectRuleEvidence, validateRuleAnswer } from '../src/rule-assistant.js';
import { assistantIdentity } from '../../js/rule-assistant-contract.js';

const hash = 'a'.repeat(64);
const encode = (data) =>
  typeof data === 'string'
    ? { stringValue: data }
    : typeof data === 'boolean'
      ? { booleanValue: data }
      : typeof data === 'number'
        ? { integerValue: String(data) }
        : Array.isArray(data)
          ? { arrayValue: { values: data.map(encode) } }
          : { mapValue: { fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, encode(v)])) } };
function fixture() {
  const map = new Map();
  let queue = Promise.resolve();
  const storage = { get: async (k) => structuredClone(map.get(k)), put: async (k, v) => map.set(k, structuredClone(v)) };
  storage.transaction = (f) => {
    const p = queue.then(() => f(storage));
    queue = p.catch(() => {});
    return p;
  };
  const store = new KnowledgeStore({ storage });
  const state = { profile: { uid: 'admin', role: 'superadmin', status: 'approved' }, game: { id: crypto.randomUUID(), title: 'Jogo de teste', edition: '2', manual: { sha256: hash, pages: 3, name: 'manual.pdf' } }, calls: [], sources: [] };
  state.sources = [
    {
      id: 'manual-1',
      name: 'Manual de teste',
      documentId: 'main',
      sourceHash: hash,
      documentType: 'principal',
      pages: [{ page: 2, text: 'COMBATE\nPara atacar um inimigo, gaste uma ação e escolha sua arma. Cada ataque custa uma ação. Exceção: não é possível atacar sem arma.' }],
    },
  ];
  state.env = { FIREBASE_PROJECT_ID: 'demo-acervo', OWNER_UID: 'admin', ALLOW_MANUAL_AI: 'true', GEMINI_API_KEY: 'simulated', GAME_KNOWLEDGE: { idFromName: (n) => n, get: () => store } };
  state.fetcher = async (url, options = {}) => {
    if (String(url).includes('firestore.googleapis.com')) return Response.json({ fields: encode(String(url).includes('/users/') ? state.profile : state.game).mapValue.fields });
    if (String(url).includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(options.body),
        prompt = JSON.parse(body.contents[0].parts[0].text);
      state.calls.push(body);
      if (state.wait) await Promise.race([state.wait, new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')), { once: true }))]);
      if (options.signal.aborted) throw new DOMException('Cancelado', 'AbortError');
      if (state.failure) return Response.json({ error: { status: 'UNAVAILABLE' } }, { status: state.failure });
      const ref = prompt.evidence.find((e) => e.source === 'official') || prompt.evidence[0];
      const raw = state.raw || { language: 'pt-BR', insufficient: false, blocks: [{ kind: 'explanation', text: 'Para atacar, gaste uma ação e escolha uma arma.', citations: [{ id: ref.id, quote: ref.text.slice(0, 90) }] }] };
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] });
    }
    if (String(url) === 'https://official.example.test/faq') {
      state.externalCalls = (state.externalCalls || 0) + 1;
      if (state.externalFailure) return new Response('', { status: 503 });
      return new Response('<p>Combate: para atacar o inimigo no turno, gaste uma ação de ataque e escolha uma arma disponível.</p>', { headers: { 'Content-Type': 'text/html' } });
    }
    assert.fail('Nenhum acesso externo real: ' + url);
  };
  state.input = () => ({ question: 'Como atacar um inimigo?', conversationId: crypto.randomUUID(), context: { topic: 'Combate', documentId: 'main', sourceHash: state.game.manual.sha256, page: 2 } });
  state.ask = (input = state.input(), signal) =>
    ruleAssistantEndpoint(new Request('https://worker.test/question', { signal }), state.env, { uid: state.profile.uid, token: 'simulated' }, state.game.id, input, { fetcher: state.fetcher, loadSources: async () => ({ sources: state.sources }) });
  state.map = map;
  state.store = store;
  return state;
}
test('papel administrativo válido, independente de adicionar/editar; leitores, bloqueados e pendentes recusados', async () => {
  for (const role of ['user', 'subadmin', 'superadmin'])
    for (const status of ['approved', 'pending', 'rejected', 'blocked']) {
      const f = fixture();
      f.profile = { ...f.profile, role, status, permissions: { addGames: false, editGames: false } };
      if (status === 'approved' && role !== 'user') assert.equal((await f.ask()).status, 200);
      else await assert.rejects(f.ask(), (e) => e.status === 403);
      assert.equal(f.calls.length, status === 'approved' && role !== 'user' ? 1 : 0);
    }
});
test('evidência PDF contextual limitada, cache privado e acompanhamento, sem geração repetida', async () => {
  const f = fixture(),
    input = f.input();
  const first = await (await f.ask(input)).json();
  assert.equal(first.cached, false);
  assert.equal(first.usage.used, 1);
  assert.equal(first.usage.providerRemaining, null);
  assert.equal(first.answer.blocks[0].citations[0].page, 2);
  assert.equal(first.answer.blocks[0].citations[0].sourceHash, hash);
  assert.equal((await (await f.ask(input)).json()).cached, true);
  assert.equal((await (await f.ask({ ...input, conversationId: crypto.randomUUID() })).json()).cached, true);
  assert.equal(f.calls.length, 1);
  await f.ask({ ...input, question: 'E como escolher a arma?' });
  const prompt = JSON.parse(f.calls.at(-1).contents[0].parts[0].text);
  assert.equal(prompt.history[0].question, input.question);
  assert.equal(prompt.topic, 'Combate');
  assert.equal(prompt.game.edition, '2');
  assert.equal(prompt.evidence[0].documentId, 'main');
  assert.equal(f.calls[0].tools, undefined);
  f.profile = { uid: 'sub', status: 'approved', role: 'subadmin' };
  assert.equal((await (await f.ask(input)).json()).cached, false);
  assert.equal(f.calls.length, 3, 'outra conta não recebe conversa/cache privado');
});
test('mudança de título, edição ou hash durante a geração descarta resposta; revogação também', async () => {
  for (const field of ['title', 'edition', 'hash', 'role']) {
    const f = fixture();
    let release;
    f.wait = new Promise((r) => (release = r));
    const pending = f.ask();
    while (!f.calls.length) await new Promise((r) => setTimeout(r, 1));
    if (field === 'hash') f.game.manual.sha256 = 'b'.repeat(64);
    else if (field === 'role') f.profile.status = 'blocked';
    else f.game[field] += ' alterado';
    release();
    await assert.rejects(pending, (e) => e.status === (field === 'role' ? 403 : 409));
    assert.equal([...f.map.keys()].filter((k) => k.startsWith('qa:answer:')).length, 0);
  }
});
test('cliques concorrentes não duplicam geração; falha e cancelamento liberam bloqueio sem repetição', async () => {
  const f = fixture();
  let release;
  f.wait = new Promise((r) => (release = r));
  const input = f.input(),
    pending = f.ask(input);
  while (!f.calls.length) await new Promise((r) => setTimeout(r, 1));
  assert.equal((await f.ask(input)).status, 409);
  assert.equal(f.calls.length, 1);
  release();
  await pending;
  f.wait = null;
  f.failure = 503;
  await assert.rejects(f.ask({ ...f.input(), question: 'Como funciona o combate?' }), (e) => e.reason === 'provider-unavailable' && /HTTP 503/.test(e.message));
  assert.equal(f.calls.length, 2);
  assert.equal(f.map.get('qa:locks').items.length, 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.ask(f.input(), controller.signal));
  assert.equal(f.calls.length, 2);
});
test('orçamento próprio bloqueia somente novas perguntas; cache continua disponível e geração antiga intacta', async () => {
  const f = fixture();
  const firstInput = f.input();
  await f.ask(firstInput);
  for (let n = 1; n < 10; n++) await f.ask({ ...f.input(), question: `Como atacar o inimigo no turno ${n}?` });
  const result = await f.ask({ ...f.input(), question: 'Como atacar mais uma vez?' });
  assert.equal(result.status, 429);
  assert.equal((await result.json()).usage.used, 10);
  assert.equal(f.calls.length, 10);
  assert.equal((await (await f.ask(firstInput)).json()).cached, true);
  const original = await (await f.store.fetch(new Request('https://internal/claim', { method: 'POST', body: JSON.stringify({ key: 'metadata', requestId: 'unrelated' }) }))).json();
  assert.equal(original.claimed, true, 'orçamento Q&A não limita geração de ficha existente');
});
test('fontes oficiais autorizadas são consultadas quando PDF é insuficiente; falha é declarada', async () => {
  for (const failure of [false, true]) {
    const f = fixture();
    f.externalFailure = failure;
    f.sources[0].pages = [{ page: 2, text: 'Visão geral: os jogadores recebem componentes antes da partida.' }];
    f.env.RULE_ASSISTANT_OFFICIAL_SOURCES = JSON.stringify([{ gameId: f.game.id, edition: '2', official: true, reuseAllowed: true, license: 'Permissão de teste', url: 'https://official.example.test/faq' }]);
    const response = await (await f.ask()).json();
    assert.equal(response.answer.external, failure ? 'partial' : 'searched');
    if (!failure) {
      const prompt = JSON.parse(f.calls[0].contents[0].parts[0].text);
      assert(prompt.evidence.some((e) => e.source === 'official'));
      assert.equal(response.answer.blocks[0].citations[0].source, 'official');
      assert.equal(response.answer.blocks[0].citations[0].url, 'https://official.example.test/faq');
    }
  }
  const f = fixture();
  f.sources = [];
  const result = await (await f.ask()).json();
  assert.equal(result.status, 'insufficient');
  assert.equal(result.external, 'unavailable');
  assert.equal(f.calls.length, 0);
});
test('PDF com evidência direta não dispara consulta externa desnecessária', async () => {
  const f = fixture();
  f.env.RULE_ASSISTANT_OFFICIAL_SOURCES = JSON.stringify([{ gameId: f.game.id, edition: '2', official: true, reuseAllowed: true, license: 'Permissão de teste', url: 'https://official.example.test/faq' }]);
  const response = await (await f.ask()).json();
  assert.equal(response.answer.external, 'not-needed');
  assert.equal(f.externalCalls || 0, 0);
  assert.equal(f.calls.length, 1);
});
test('referências inventadas e conflito com uma única fonte são rejeitados', () => {
  const evidence = [{ id: 'p', text: 'Texto literal verificável da página.', source: 'manual', page: 2, sourceHash: hash }];
  const answer = { language: 'pt-BR', insufficient: false, blocks: [{ kind: 'explanation', text: 'Explicação.', citations: [{ id: 'p', quote: 'Texto inventado.' }] }] };
  assert.throws(() => validateRuleAnswer(answer, evidence), /citação/);
  answer.blocks[0].citations[0].quote = 'Texto literal';
  answer.blocks[0].kind = 'conflict';
  assert.throws(() => validateRuleAnswer(answer, evidence), /duas referências/);
});
test('timeout de 30 segundos cancela o provedor uma vez e libera concorrência', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.wait = new Promise(() => {});
  const pending = f.ask();
  while (!f.calls.length) await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(30000);
  await assert.rejects(pending, (e) => e.status === 504 && e.reason === 'provider-timeout');
  assert.equal(f.calls.length, 1);
  assert.equal(f.map.get('qa:locks').items.length, 0);
});
test('conversa limita histórico a quatro perguntas e concorrência global a duas', async () => {
  const f = fixture(),
    input = f.input();
  for (let n = 0; n < 4; n++) await f.ask({ ...input, question: `Como atacar o inimigo, pergunta ${n}?` });
  assert.equal((await f.ask({ ...input, question: 'E um quinto ataque?' })).status, 409);
  const operation = async (uid) => f.store.fetch(new Request('https://internal/assistant/claim', { method: 'POST', body: JSON.stringify({ uid, key: uid, conversationId: crypto.randomUUID(), identity: 'same-doc' }) }));
  assert.equal((await operation('one')).status, 200);
  assert.equal((await operation('two')).status, 200);
  assert.equal((await operation('three')).status, 429);
});
test('documentos e edições incompatíveis e expansões não contaminam contexto base', () => {
  const f = fixture();
  f.game.documents = {
    main: { id: 'main', edition: '2', documentType: 'principal', manual: f.game.manual },
    faq: { id: 'faq', edition: '2', documentType: 'faq', manual: { ...f.game.manual, sha256: 'b'.repeat(64) } },
    old: { id: 'old', edition: '1', manual: { ...f.game.manual, sha256: 'c'.repeat(64) } },
    exp: { id: 'exp', edition: '2', documentType: 'expansao', manual: { ...f.game.manual, sha256: 'd'.repeat(64) } },
  };
  const sources = Object.values(f.game.documents).map((d, i) => ({ ...f.sources[0], id: 's' + i, documentId: d.id, sourceHash: d.manual.sha256 }));
  const selected = selectRuleEvidence(f.game, sources, f.input().context, f.input().question);
  assert.deepEqual(new Set(selected.evidence.map((e) => e.documentId)), new Set(['main', 'faq']));
  assert.notEqual(assistantIdentity(f.game), assistantIdentity({ ...f.game, title: 'Outro' }));
  assert.throws(() => selectRuleEvidence(f.game, sources, { ...f.input().context, sourceHash: 'obsolete' }, 'Combate'), /referência mudou/);
});
