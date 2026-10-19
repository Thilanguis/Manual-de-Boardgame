import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeFixture } from '../../tests/knowledge-fixture.mjs';
import { draftKnowledgeEndpoint, reusableDraftKnowledge, draftContextKey } from '../src/draft-knowledge.js';
import { profileDefinitions } from '../../js/profile-facts.js';

const text = 'Jogo Exemplo. Terceira edição. Para 2 a 5 jogadores. Duração de 60 a 150 minutos. Idade: 14 anos. Jogo base cooperativo de aventura, com gestão de cartas.';
const values = {
  title: 'Jogo Exemplo',
  edition: 'Terceira edição',
  description: 'Coopere em uma aventura com cartas.',
  minPlayers: 2,
  maxPlayers: 5,
  minDurationMinutes: 60,
  maxDurationMinutes: 150,
  recommendedAge: 14,
  tags: ['Aventura'],
  mechanics: ['Gestão de cartas'],
  gameType: 'Jogo base cooperativo',
};
const input = () => ({ title: 'Jogo Exemplo', edition: '', requestId: crypto.randomUUID(), documents: [{ id: 'main', hash: 'a'.repeat(64), name: 'Manual.pdf', language: 'pt-BR', pages: [{ page: 1, text }] }] });
const identity = { uid: 'owner', token: 'fixture', profile: { uid: 'owner', role: 'superadmin', status: 'approved' } };
async function setup(action) {
  const fixture = knowledgeFixture(),
    env = { ...fixture.env, FIREBASE_PROJECT_ID: 'demo-acervo', OWNER_UID: 'owner', ALLOW_MANUAL_AI: 'true' };
  fixture.faults.metadata = (p) => Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value, sourceId: p.sources[0].id, page: 1, evidenceId: p.sources[0].pages[0].passages[0].id }]));
  const old = globalThis.fetch;
  let reads = 0,
    blocked = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://firestore.googleapis.com/')) {
      assert.match(String(url), /\/users\/owner$/);
      reads++;
      return Response.json({ fields: { uid: { stringValue: 'owner' }, role: { stringValue: 'superadmin' }, status: { stringValue: blocked ? 'blocked' : 'approved' } } });
    }
    const response = await fixture.fetch(url, options);
    if (response) return response;
    assert.fail(`Chamada não simulada: ${url}`);
  };
  try {
    await action({
      fixture,
      env,
      reads: () => reads,
      block: () => {
        blocked = true;
      },
    });
  } finally {
    globalThis.fetch = old;
  }
}
const run = (env, data, who = identity) => draftKnowledgeEndpoint(new Request('https://api.test/v1/research/draft-knowledge', { method: 'POST' }), env, who, data);

test('administrador retoma ficha bloqueada pela cota interna antiga somente no clique explícito', async () =>
  setup(async ({ fixture, env }) => {
    const data = input();
    const sources = [{ pages: data.documents[0].pages, sourceHash: data.documents[0].hash }];
    const key = await draftContextKey(identity.uid, sources);
    await fixture.storage.put('job:' + key, { status: 'quota', reason: 'app-rate-limit', retryAt: Date.now() + 86400000, revision: 0 });
    const opened = await (await run(env, data)).json();
    assert.equal(opened.status, 'attention');
    assert.equal(opened.retryAt, 0);
    assert.equal(fixture.calls.length, 0);
    const refreshed = await (await run(env, { ...data, retry: true })).json();
    assert.equal(refreshed.status, 'ready');
    assert.equal(fixture.calls.length, 1);
    await run(env, { ...data, retry: true });
    assert.equal(fixture.calls.length, 1, 'resultado válido continua sendo reutilizado');
  }));

test('HTTP 400 após conhecimento legado preserva a ficha anterior com motivo da tentativa nova', async () =>
  setup(async ({ fixture, env }) => {
    const data = input();
    const first = await (await run(env, data)).json();
    const key = await draftContextKey(identity.uid, first.knowledge.sources);
    const legacy = { ...first, knowledge: { ...first.knowledge, profile: { title: first.knowledge.profile.title, description: first.knowledge.profile.description }, profileAnalysis: undefined } };
    legacy.knowledge.sections[0].text = 'Correção manual anterior';
    legacy.knowledge.sections[0].review = 'manual';
    await fixture.storage.put('job:' + key, legacy);
    fixture.faults.httpError = { status: 400, error: { status: 'INVALID_ARGUMENT', message: 'response schema too complex PRIVATE_TEXT' } };
    const failed = await (await run(env, { ...data, retry: true, requestId: crypto.randomUUID() })).json();
    assert.equal(failed.status, 'attention');
    assert.equal(failed.reason, 'provider-schema-rejected');
    assert.equal(failed.provider.httpStatus, 400);
    assert.equal(failed.knowledge.sections[0].text, 'Correção manual anterior');
    assert.equal(failed.knowledge.generatedAt, first.knowledge.generatedAt);
    assert.ok(!JSON.stringify(failed).includes('PRIVATE_TEXT'));
    const calls = fixture.calls.length;
    await run(env, { ...data, requestId: crypto.randomUUID() });
    assert.equal(fixture.calls.length, calls, 'reabrir não repete falha');
  }));

test('interrupção persiste diagnóstico seguro e não regenera ao reabrir; retry explícito respeita cota', async () =>
  setup(async ({ fixture, env }) => {
    const data = input();
    fixture.faults.finishReason = 'MAX_TOKENS';
    const failed = await (await run(env, data)).json();
    assert.equal(failed.status, 'attention');
    assert.equal(failed.reason, 'provider-output-limit');
    assert.equal(failed.generation.finishReason, 'MAX_TOKENS');
    assert.equal(failed.generation.usage.outputTokens, 6500);
    assert.equal(failed.knowledge, undefined);
    const reopened = await (await run(env, { ...data, requestId: crypto.randomUUID() })).json();
    assert.equal(reopened.reason, failed.reason);
    assert.equal(fixture.calls.length, 1);
    assert.equal(await fixture.storage.get('quota'), undefined);
    delete fixture.faults.finishReason;
    const recovered = await (await run(env, { ...data, retry: true, requestId: crypto.randomUUID() })).json();
    assert.equal(recovered.status, 'ready');
    assert.equal(recovered.generation.finishReason, 'STOP');
    assert.equal(fixture.calls.length, 2);
    assert.equal(await fixture.storage.get('quota'), undefined);
  }));

test('rascunho produz ficha e regras em uma chamada, sem criar jogo ou ler catálogo Firestore', async () =>
  setup(async ({ fixture, env, reads }) => {
    const data = input(),
      record = await (await run(env, data)).json();
    assert.equal(record.status, 'ready');
    assert.equal(record.analysisOrigin, 'generation');
    assert.equal(record.knowledge.profileAnalysis.returned, 11);
    assert.equal(record.knowledge.profileAnalysis.valid, 11);
    assert.equal(fixture.calls.length, 1);
    assert.equal(reads(), 1, 'somente revalidação do perfil, nenhuma leitura de jogo');
    assert.deepEqual(Object.keys(record.knowledge.profile).sort(), Object.keys(profileDefinitions).sort());
    assert.equal(record.knowledge.fields.recommendedAge.value, 14);
    const body = fixture.calls[0];
    assert.equal(body.systemInstruction.parts.length, 2);
    assert(body.generationConfig.responseSchema.required.includes('metadata'));
    assert.match(body.systemInstruction.parts[0].text, /Prepare entre 10 e 24 seções/);
    assert.deepEqual(body.generationConfig.responseSchema.properties.sections.items.required, ['topic', 'title', 'text', 'sourceId', 'page', 'evidenceId']);
    assert.equal(record.lease, undefined);
    const cached = await (await run(env, { ...data, requestId: crypto.randomUUID() })).json();
    assert.equal(cached.status, 'ready');
    assert.equal(cached.analysisOrigin, 'server-cache');
    assert.equal(fixture.calls.length, 1);
    assert.equal(reads(), 1);
    const sources = record.knowledge.sources;
    assert.equal(await reusableDraftKnowledge({ id: 'new-game', createdBy: 'owner', title: 'Outro jogo' }, sources, env), null, 'mesmo hash não confirma um jogo diferente');
    const adopted = await reusableDraftKnowledge({ id: 'new-game', createdBy: 'owner', title: 'Jogo Exemplo' }, sources, env);
    assert.equal(adopted.gameId, 'new-game');
    assert.equal(adopted.profile.recommendedAge.value, 14);
    assert.equal(fixture.calls.length, 1);
    const corrected = { ...adopted.sections[0], review: 'manual', text: 'Correção anterior preservada.' };
    await fixture.storage.put('job:prior', { knowledge: { ...adopted, sections: [corrected] }, status: 'ready' });
    await fixture.storage.put('latest:new-game', 'job:prior');
    const reused = await (
      await env.GAME_KNOWLEDGE.get('demo-acervo').fetch(
        new Request('https://knowledge.internal/adopt', { method: 'POST', body: JSON.stringify({ key: 'adopted', gameId: 'new-game', documents: [{ id: 'main', hash: sources[0].sourceHash }], knowledge: adopted }) }),
      )
    ).json();
    assert.equal(reused.knowledge.sections[0].text, 'Correção anterior preservada.');
    assert.equal(await fixture.storage.get('quota'), undefined);
    assert.equal(await reusableDraftKnowledge({ createdBy: 'other' }, sources, env), null);
    assert.equal(
      await reusableDraftKnowledge(
        { createdBy: 'owner' },
        sources.map((s) => ({ ...s, pages: [{ page: 1, text: text + ' Alteração.' }] })),
        env,
      ),
      null,
    );
  }));

test('mesmo PDF com outra obra/edição não retorna ficha incompatível nem gera ao abrir', async () =>
  setup(async ({ env, fixture }) => {
    const data = input();
    await run(env, data);
    for (const change of [{ title: 'Jogo sem relação' }, { edition: 'Quarta edição' }]) {
      const result = await (await run(env, { ...data, ...change, requestId: crypto.randomUUID() })).json();
      assert.equal(result.status, 'identity_changed');
      assert.equal(result.knowledge, null);
    }
    const compatible = await (await run(env, { ...data, title: 'Jogo: Exemplo', requestId: crypto.randomUUID() })).json();
    assert.equal(compatible.status, 'ready');
    assert.equal(compatible.knowledge.title, 'Jogo: Exemplo');
    assert.equal(fixture.calls.length, 1);
  }));

test('nome corrigido permite nova análise explícita sem ficar preso ao cache por hash', async () =>
  setup(async ({ env, fixture }) => {
    const data = input();
    await run(env, { ...data, title: 'Nome técnico antigo do arquivo' });
    const opened = await (await run(env, { ...data, requestId: crypto.randomUUID() })).json();
    // A ficha estruturada confirma o título real e permite reaproveitar o cache.
    assert.equal(opened.status, 'ready');
    const key = await draftContextKey(identity.uid, opened.knowledge.sources);
    const legacy = await fixture.storage.get('job:' + key);
    legacy.knowledge.profile = {};
    legacy.knowledge.profileAnalysis = { version: 1, complete: true };
    await fixture.storage.put('job:' + key, legacy);
    const blocked = await (await run(env, { ...data, requestId: crypto.randomUUID() })).json();
    assert.equal(blocked.status, 'identity_changed');
    assert.equal(fixture.calls.length, 1, 'abrir não consome outra geração');
    const updated = await (await run(env, { ...data, retry: true, requestId: crypto.randomUUID() })).json();
    assert.equal(updated.status, 'ready');
    assert.equal(updated.knowledge.title, data.title);
    assert.equal(fixture.calls.at(-1).contents[0].parts[0].text.includes(data.title), true);
    assert.equal(fixture.calls.length, 2, 'somente o clique explícito usa mais uma geração');
    await run(env, { ...data, retry: true, requestId: crypto.randomUUID() });
    assert.equal(fixture.calls.length, 2, 'resultado completo da identidade atual é reutilizado');
  }));

test('rascunho legado só atualiza ficha ausente no clique explícito e preserva correções', async () =>
  setup(async ({ env, fixture }) => {
    const data = input(),
      first = await (await run(env, data)).json();
    const key = await draftContextKey(identity.uid, first.knowledge.sources);
    const old = await fixture.storage.get('job:' + key);
    old.knowledge.profile = {};
    old.knowledge.profileAnalysis = { version: 1, complete: true };
    old.knowledge.sections[0].review = 'manual';
    old.knowledge.sections[0].text = 'Correção administrativa preservada.';
    await fixture.storage.put('job:' + key, old);
    await run(env, { ...data, requestId: crypto.randomUUID() });
    assert.equal(fixture.calls.length, 1, 'leitura sem retry não gera');
    const result = await (await run(env, { ...data, retry: true, requestId: crypto.randomUUID() })).json();
    assert.equal(fixture.calls.length, 2);
    assert.equal(result.knowledge.profileAnalysis.valid, 11);
    assert.equal(result.knowledge.sections[0].text, 'Correção administrativa preservada.');
  }));

test('ficha antiga com só descrição atualiza os demais campos uma vez no clique explícito', async () =>
  setup(async ({ env, fixture }) => {
    const data = input();
    const first = await (await run(env, data)).json();
    const key = await draftContextKey(identity.uid, first.knowledge.sources);
    const previous = await fixture.storage.get('job:' + key);
    previous.knowledge.profile = { description: previous.knowledge.profile.description };
    previous.knowledge.profileAnalysis = { version: 2, complete: true, returned: 1, valid: 1 };
    previous.knowledge.sections[0].review = 'manual';
    previous.knowledge.sections[0].text = 'Minha regra corrigida.';
    await fixture.storage.put('job:' + key, previous);
    await run(env, { ...data, requestId: crypto.randomUUID() });
    assert.equal(fixture.calls.length, 1, 'consulta simples não inicia atualização');
    const updated = await (await run(env, { ...data, retry: true, requestId: crypto.randomUUID() })).json();
    assert.equal(fixture.calls.length, 2);
    assert.equal(updated.knowledge.profileAnalysis.coverageComplete, true);
    assert.equal(updated.knowledge.profileAnalysis.valid, 11);
    assert.equal(updated.knowledge.sections[0].text, 'Minha regra corrigida.');
    await run(env, { ...data, retry: true, requestId: crypto.randomUUID() });
    assert.equal(fixture.calls.length, 2, 'resultado completo reutilizado mesmo no clique explícito');
    assert.equal(await fixture.storage.get('quota'), undefined);
  }));

test('ficha anterior com os 11 campos válidos não é regenerada só por faltar marcador novo', async () =>
  setup(async ({ env, fixture }) => {
    const data = input();
    const first = await (await run(env, data)).json();
    const key = await draftContextKey(identity.uid, first.knowledge.sources);
    const old = await fixture.storage.get('job:' + key);
    delete old.knowledge.profileAnalysis.coverageComplete;
    delete old.knowledge.profileAnalysis.checkedFields;
    old.knowledge.profileAnalysis.version = 2;
    await fixture.storage.put('job:' + key, old);
    const cached = await (await run(env, { ...data, retry: true, requestId: crypto.randomUUID() })).json();
    assert.equal(cached.analysisOrigin, 'server-cache');
    assert.equal(fixture.calls.length, 1);
    assert.equal(await fixture.storage.get('quota'), undefined);
  }));

test('texto totalmente corrompido não é enviado ao provedor', async () =>
  setup(async ({ env, fixture }) => {
    const data = input();
    data.documents[0].pages[0].text = 'Introdução: ' + '□'.repeat(200);
    const result = await (await run(env, data)).json();
    assert.equal(result.status, 'attention');
    assert.match(result.message, /OCR local/);
    assert.equal(fixture.calls.length, 0);
    assert.equal(await fixture.storage.get('quota'), undefined, 'texto ilegível não consome a cota local');
  }));
test('troca de IDs locais não gera outra análise; versões e conteúdo diferentes não são promovidos', async () =>
  setup(async ({ env, fixture }) => {
    const data = input(),
      record = await (await run(env, data)).json();
    const changed = record.knowledge.sources.map((s) => ({ ...s, documentId: '11111111-1111-4111-8111-111111111111', id: 'manual-2' }));
    const result = await reusableDraftKnowledge({ id: 'x', createdBy: 'owner', title: 'Jogo Exemplo' }, changed, env);
    assert.equal(result.profile.recommendedAge.documentId, changed[0].documentId);
    assert.equal(result.sections[0].sourceId, 'manual-2');
    const other = { ...data, requestId: crypto.randomUUID(), documents: [{ ...data.documents[0], hash: 'b'.repeat(64) }] };
    await run(env, other);
    assert.equal(fixture.calls.length, 2);
  }));
test('permissão é conferida antes do rascunho e novamente ao terminar; revogação impede aceitar resultado', async () =>
  setup(async ({ fixture, env, block }) => {
    await assert.rejects(() => run(env, input(), { ...identity, profile: { uid: 'reader', role: 'user', status: 'approved' } }), /não pode analisar/);
    assert.equal(fixture.calls.length, 0);
    let release;
    fixture.faults.wait = new Promise((r) => {
      release = r;
    });
    const pending = run(env, input());
    while (!fixture.calls.length) await new Promise((r) => setTimeout(r, 0));
    block();
    release();
    const record = await (await pending).json();
    assert.equal(record.status, 'attention');
    assert.equal(record.knowledge, undefined);
  }));
test('limites e autorização de envio são preservados, sem acesso ao provedor', async () =>
  setup(async ({ env, fixture }) => {
    const record = await (await run({ ...env, ALLOW_MANUAL_AI: 'false' }, input())).json();
    assert.equal(record.status, 'pending_authorization');
    await assert.rejects(() => run(env, { ...input(), documents: [{ ...input().documents[0], pages: [{ page: 2, text }] }] }), /Páginas inválidas/);
    assert.equal(fixture.calls.length, 0);
  }));
