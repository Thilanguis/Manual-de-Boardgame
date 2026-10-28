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
  state.env = { FIREBASE_PROJECT_ID: 'demo-acervo', OWNER_UID: 'admin', ALLOW_MANUAL_AI: 'true', RULE_ASSISTANT_WEB_SEARCH: 'false', GEMINI_API_KEY: 'simulated', GAME_KNOWLEDGE: { idFromName: (n) => n, get: () => store } };
  state.fetcher = async (url, options = {}) => {
    if (String(url).includes('firestore.googleapis.com')) return Response.json({ fields: encode(String(url).includes('/users/') ? state.profile : state.game).mapValue.fields });
    if (String(url).includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(options.body),
        prompt = JSON.parse(body.contents[0].parts[0].text);
      if (body.tools?.some((tool) => tool.google_search)) {
        (state.webCalls ||= []).push(body);
        if (state.webFailure) return Response.json({}, { status: state.webFailure });
        const text = 'No jogo de tabuleiro, a habilidade permite recolocar um corvo da reserva em um espaço.';
        return Response.json(
          state.webPayload || {
            candidates: [
              {
                finishReason: 'STOP',
                content: { parts: [{ text }] },
                groundingMetadata: {
                  webSearchQueries: ['jogo de teste board game habilidade corvo'],
                  searchEntryPoint: { renderedContent: '<div>Sugestões de pesquisa</div>' },
                  groundingChunks: [{ web: { title: 'Editora · regras do jogo de tabuleiro', uri: 'https://official.example.test/boardgame-faq' } }],
                  groundingSupports: [{ segment: { text }, groundingChunkIndices: [0] }],
                },
              },
            ],
          },
        );
      }
      state.calls.push(body);
      if (state.wait) await Promise.race([state.wait, new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')), { once: true }))]);
      if (options.signal.aborted) throw new DOMException('Cancelado', 'AbortError');
      if (state.failure) return Response.json({ error: { status: 'UNAVAILABLE' } }, { status: state.failure });
      const webRef = prompt.evidence.find((e) => e.source === 'web');
      if (webRef && state.synthesisFailure) return Response.json({}, { status: state.synthesisFailure });
      const ref = webRef || prompt.evidence.find((e) => e.source === 'official') || prompt.evidence[0];
      const raw = state.raw || { language: 'pt-BR', insufficient: !!state.needsWeb && !webRef, blocks: [{ kind: 'explanation', text: 'Para atacar, gaste uma ação e escolha uma arma.', citations: [{ id: ref.id }] }] };
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
test('contas aprovadas podem perguntar sem poderes de edição; bloqueados, rejeitados e pendentes são recusados', async () => {
  for (const role of ['user', 'subadmin', 'superadmin'])
    for (const status of ['approved', 'pending', 'rejected', 'blocked']) {
      const f = fixture();
      f.profile = { ...f.profile, role, status, permissions: { addGames: false, editGames: false } };
      if (status === 'approved') assert.equal((await f.ask()).status, 200);
      else await assert.rejects(f.ask(), (e) => e.status === 403);
      assert.equal(f.calls.length, status === 'approved' ? 1 : 0);
    }
});
test('perguntas sem autenticação continuam recusadas no backend', async () => {
  const f = fixture();
  await assert.rejects(ruleAssistantEndpoint(new Request('https://worker.test/question'), f.env, null, f.game.id, f.input(), { fetcher: f.fetcher }), (error) => error.status === 401);
  assert.equal(f.calls.length, 0);
});
test('evidência PDF contextual limitada, cache privado e acompanhamento, sem geração repetida', async () => {
  const f = fixture(),
    input = f.input();
  const first = await (await f.ask(input)).json();
  assert.equal(first.cached, false);
  assert.equal(first.usage, undefined, 'não existe contador artificial de perguntas');
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
  assert.deepEqual(
    f.calls[0].generationConfig.responseSchema.properties.blocks.items.properties.citations.items.properties.id.enum,
    JSON.parse(f.calls[0].contents[0].parts[0].text).evidence.map((e) => e.id),
    'o esquema só permite IDs realmente enviados',
  );
  f.profile = { uid: 'sub', status: 'approved', role: 'subadmin' };
  assert.equal((await (await f.ask(input)).json()).cached, false);
  assert.equal(f.calls.length, 3, 'outra conta não recebe conversa/cache privado');
});
test('pergunta de acompanhamento com "eles" recupera o assunto anterior sem tratar a resposta antiga como regra', async () => {
  const f = fixture();
  f.game.manual.pages = 40;
  f.sources[0].pages = [
    ...Array.from({ length: 38 }, (_, i) => ({ page: i + 1, text: 'INTERAGIR: regras gerais para escolher uma ação no turno do jogador. Não descreve uma habilidade específica.' })),
    { page: 39, text: 'CORVOS. O Assassino remove o Corvo e ganha um Ponto de Sangue. O Sobrevivente ganha um turno bônus.' },
  ];
  const input = { ...f.input(), question: 'O que acontece ao interagir com os corvos?', context: { ...f.input().context, page: 1 } };
  await f.ask(input);
  await f.ask({ ...input, question: 'Você falou que eles podem interagir. Mas o que acontece com eles?' });
  const prompt = JSON.parse(f.calls.at(-1).contents[0].parts[0].text);
  assert(prompt.evidence.some((ref) => ref.page === 39));
  assert.match(f.calls.at(-1).systemInstruction.parts[0].text, /histórico não é fonte de regra/);
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
test('contadores antigos esgotados não bloqueiam mais de 30 perguntas nem afetam o cache ou a geração de fichas', async () => {
  const f = fixture();
  const day = new Date().toISOString().slice(0, 10);
  const legacy = { used: 999, expiry: Date.now() + 86400000 };
  f.map.set(`qa:budget:${day}`, structuredClone(legacy));
  f.map.set(`qa:budget:${day}:admin`, structuredClone(legacy));
  const firstInput = f.input();
  await f.ask(firstInput);
  for (let n = 1; n < 35; n++) assert.equal((await f.ask({ ...firstInput, question: `Como atacar o inimigo no turno ${n}?` })).status, 200);
  assert.equal(f.calls.length, 35);
  assert.deepEqual(f.map.get(`qa:budget:${day}`), legacy, 'contadores históricos não são modificados');
  assert.deepEqual(f.map.get(`qa:budget:${day}:admin`), legacy);
  assert.equal(f.map.get(`qa:thread:admin:${firstInput.conversationId}`).turns.length, 4, 'retenção do histórico não impede novas perguntas');
  assert.equal((await (await f.ask({ ...firstInput, conversationId: crypto.randomUUID() })).json()).cached, true);
  const original = await (await f.store.fetch(new Request('https://internal/claim', { method: 'POST', body: JSON.stringify({ key: 'metadata', requestId: 'unrelated' }) }))).json();
  assert.equal(original.claimed, true, 'geração de ficha permanece independente');
});
test('limite do próprio Gemini é informado sem cotas locais nem repetição automática', async () => {
  const f = fixture();
  f.failure = 429;
  await assert.rejects(f.ask(), (error) => error.status === 429 && error.reason === 'provider-rate-limit' && /provedor Gemini/.test(error.message));
  assert.equal(f.calls.length, 1);
  assert.equal(
    [...f.map.keys()].some((key) => key.startsWith('qa:budget:')),
    false,
  );
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
  assert.equal(result.status, 'ready');
  assert.equal(result.answer.insufficient, true);
  assert.equal(result.answer.external, 'unavailable');
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
test('resposta suficiente dos PDFs não inicia pesquisa Google', async () => {
  const f = fixture();
  delete f.env.RULE_ASSISTANT_WEB_SEARCH;
  const result = await (await f.ask()).json();
  assert.equal(result.answer.insufficient, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.webCalls?.length || 0, 0);
  assert.equal(result.answer.blocks[0].citations[0].quote, f.sources[0].pages[0].text, 'citação vem integralmente do índice, sem cópia pelo modelo');
});
test('insuficiência reconhecida pelo modelo planeja pesquisa Google e uma síntese com fontes externas', async () => {
  const f = fixture();
  delete f.env.RULE_ASSISTANT_WEB_SEARCH;
  f.needsWeb = true;
  const input = f.input(),
    result = await (await f.ask(input)).json();
  assert.equal(result.answer.insufficient, false);
  assert.equal(result.answer.external, 'web-searched');
  assert.equal(f.calls.length, 2, 'primeira explicação dos PDFs e síntese após a pesquisa');
  assert.equal(f.webCalls.length, 1, 'pesquisa complementar planejada, sem ciclo de tentativas');
  const citation = result.answer.blocks[0].citations[0];
  assert.equal(citation.source, 'web');
  assert.equal(citation.quoteKind, 'search-summary');
  assert.equal(citation.url, 'https://official.example.test/boardgame-faq');
  assert.equal(result.answer.searchSuggestions, '<div>Sugestões de pesquisa</div>');
  const search = JSON.parse(f.webCalls[0].contents[0].parts[0].text);
  assert.deepEqual(Object.keys(search).sort(), ['edition', 'game', 'medium', 'question']);
  assert.equal(search.question, input.question);
  assert.equal(f.webCalls[0].generationConfig.responseSchema, undefined, '2.5 usa grounding sem formato JSON incompatível');
  assert.equal((await (await f.ask(input)).json()).cached, true);
  assert.equal(f.webCalls.length, 1, 'reutilizar a resposta não repete a pesquisa');
});
test('falha, falta de autorização e cota do Google na pesquisa preservam a resposta parcial dos PDFs', async () => {
  for (const [code, status] of [
    [503, 'web-unavailable'],
    [403, 'web-not-authorized'],
    [429, 'web-rate-limit'],
  ]) {
    const f = fixture();
    f.env.RULE_ASSISTANT_WEB_SEARCH = 'true';
    f.needsWeb = true;
    f.webFailure = code;
    const result = await (await f.ask()).json();
    assert.equal(result.answer.insufficient, true);
    assert.equal(result.answer.external, status);
    assert.equal(result.answer.blocks[0].citations[0].source, 'manual');
    assert.equal(f.webCalls.length, 1);
    assert.equal(f.calls.length, 1);
  }
});
test('sem índices utilizáveis, pesquisa primeiro e só depois sintetiza; memória sem grounding não vira fonte', async () => {
  const f = fixture();
  f.env.RULE_ASSISTANT_WEB_SEARCH = 'true';
  f.sources = [];
  const result = await (await f.ask()).json();
  assert.equal(result.answer.external, 'web-searched');
  assert.equal(f.calls.length, 1);
  assert.equal(f.webCalls.length, 1);
  const other = fixture();
  other.env.RULE_ASSISTANT_WEB_SEARCH = 'true';
  other.needsWeb = true;
  other.webPayload = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Uma explicação sem fontes verificadas.' }] } }] };
  const partial = await (await other.ask()).json();
  assert.equal(partial.answer.external, 'web-no-match');
  assert.equal(partial.answer.insufficient, true);
  assert.equal(other.calls.length, 1);
});
test('erro na síntese complementar não descarta a parte verificável do PDF nem repete a pesquisa', async () => {
  const f = fixture();
  f.env.RULE_ASSISTANT_WEB_SEARCH = 'true';
  f.needsWeb = true;
  f.synthesisFailure = 503;
  const result = await (await f.ask()).json();
  assert.equal(result.answer.external, 'web-answer-unavailable');
  assert.equal(result.answer.blocks[0].citations[0].source, 'manual');
  assert.equal(f.calls.length, 2);
  assert.equal(f.webCalls.length, 1);
});
test('falha externa não fica presa no cache; uma nova tentativa explícita pode completar a resposta', async () => {
  const f = fixture();
  f.env.RULE_ASSISTANT_WEB_SEARCH = 'true';
  f.needsWeb = true;
  f.webFailure = 503;
  const input = f.input();
  assert.equal((await (await f.ask(input)).json()).answer.insufficient, true);
  assert.equal(
    [...f.map.keys()].some((key) => key.startsWith('qa:answer:')),
    false,
  );
  f.webFailure = 0;
  assert.equal((await (await f.ask(input)).json()).answer.insufficient, false);
  assert.equal(f.webCalls.length, 2, 'uma consulta por clique explícito, não uma repetição automática');
});
test('referências inventadas e conflito com uma única fonte são rejeitados', () => {
  const evidence = [{ id: 'p', text: 'Texto literal verificável da página.', source: 'manual', page: 2, sourceHash: hash }];
  const answer = { language: 'pt-BR', insufficient: false, blocks: [{ kind: 'explanation', text: 'Explicação.', citations: [{ id: 'p', quote: 'Texto inventado.' }] }] };
  assert.throws(() => validateRuleAnswer(answer, evidence), /citação/);
  answer.blocks[0].citations[0].quote = 'Texto literal';
  answer.blocks[0].kind = 'conflict';
  assert.throws(() => validateRuleAnswer(answer, evidence), /duas referências/);
});
test('citação com quebras de linha ou NBSP é conferida e retorna o texto original do índice', () => {
  const text = 'O Sobrevivente não vira\nAdereços\u00a0voltados para baixo durante esse movimento.';
  const evidence = [{ id: 'p15', text, source: 'manual', page: 15, documentId: 'main', sourceHash: hash }];
  const answer = { language: 'pt-BR', insufficient: false, blocks: [{ kind: 'explanation', text: 'O movimento não revela esses adereços.', citations: [{ id: 'p15', quote: text.replace(/\s+/g, ' ') }] }] };
  const citation = validateRuleAnswer(answer, evidence).blocks[0].citations[0];
  assert.equal(citation.quote, text, 'a referência exibida continua sendo literal, não a cópia reformatada pelo modelo');
  assert.equal(citation.page, 15);
  assert.equal(citation.documentId, 'main');
  assert.equal(citation.sourceHash, hash);
  answer.blocks[0].citations[0].quote = 'O Sobrevivente\n\n não vira Adereços voltados para baixo';
  assert.equal(validateRuleAnswer(answer, evidence).blocks[0].citations[0].quote, 'O Sobrevivente não vira\nAdereços\u00a0voltados para baixo');
});
test('tolerância de diagramação não aceita mudança de regra, número, pontuação ou referência', () => {
  const evidence = [{ id: 'p15', text: 'O Sobrevivente não vira\nAdereços. Role até 4 dados (não 5).', source: 'manual', page: 15 }];
  for (const quote of ['O Sobrevivente vira Adereços.', 'Role até 5 dados', 'O Sobrevivente NÃO vira Adereços.', 'O Sobrevivente não vira Adereços!', 'O Sobrevivente não vira [...] Role até 4 dados', '        ', 'Role até 4 dados (não 5) ou 6.']) {
    const raw = { language: 'pt-BR', insufficient: false, blocks: [{ kind: 'explanation', text: 'Texto.', citations: [{ id: 'p15', quote }] }] };
    assert.throws(() => validateRuleAnswer(raw, evidence), /citação/);
  }
  const raw = { language: 'pt-BR', insufficient: false, blocks: [{ kind: 'explanation', text: 'Texto.', citations: [{ id: 'pagina-15', quote: 'Role até 4 dados' }] }] };
  assert.throws(() => validateRuleAnswer(raw, evidence), /referência que não recebeu/);
  raw.blocks[0].citations = [null];
  assert.throws(() => validateRuleAnswer(raw, evidence), /referência que não recebeu/);
  raw.blocks[0].citations = [{ id: 'p15', quote: 'Role até 4 dados (não 5).' }];
  assert.equal(validateRuleAnswer(raw, evidence).blocks[0].citations[0].quote, 'Role até 4 dados (não 5).', 'parênteses são tratados literalmente');
});
test('citação inválida não gera repetição automática nem deixa resposta inválida em cache', async () => {
  const f = fixture();
  f.raw = { language: 'pt-BR', insufficient: false, blocks: [{ kind: 'explanation', text: 'Regra inventada.', citations: [{ id: 'manual-1-p2-1', quote: 'Cada ataque custa três ações.' }] }] };
  await assert.rejects(f.ask(), (error) => error.status === 502 && /citação/.test(error.message));
  assert.equal(f.calls.length, 1);
  assert.equal([...f.map.keys()].filter((k) => k.startsWith('qa:answer:')).length, 0);
  assert.equal(f.map.get('qa:locks').items.length, 0);
});
test('timeout de 90 segundos cobre recuperação/pesquisa e cancela sem repetição', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.wait = new Promise(() => {});
  const pending = f.ask();
  while (!f.calls.length) await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(90000);
  await assert.rejects(pending, (e) => e.status === 504 && e.reason === 'provider-timeout');
  assert.equal(f.calls.length, 1);
  assert.equal(f.map.get('qa:locks').items.length, 0);
});
test('conversa continua após quatro perguntas e não existe teto global de duas gerações', async () => {
  const f = fixture(),
    input = f.input();
  for (let n = 0; n < 4; n++) await f.ask({ ...input, question: `Como atacar o inimigo, pergunta ${n}?` });
  assert.equal((await f.ask({ ...input, question: 'E um quinto ataque?' })).status, 200);
  const operation = async (uid, key = uid) => f.store.fetch(new Request('https://internal/assistant/claim', { method: 'POST', body: JSON.stringify({ uid, key, conversationId: crypto.randomUUID(), identity: 'same-doc' }) }));
  assert.equal((await operation('one')).status, 200);
  assert.equal((await operation('two')).status, 200);
  assert.equal((await operation('three')).status, 200);
  assert.equal((await operation('one', 'different-question')).status, 200, 'mesma conta pode fazer outra pergunta em outra aba');
  assert.equal((await operation('one')).status, 409, 'geração idêntica simultânea continua sendo deduplicada');
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
