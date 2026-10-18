import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeFixture } from '../../tests/knowledge-fixture.mjs';
import { draftKnowledgeEndpoint, reusableDraftKnowledge } from '../src/draft-knowledge.js';
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

test('rascunho produz ficha e regras em uma chamada, sem criar jogo ou ler catálogo Firestore', async () =>
  setup(async ({ fixture, env, reads }) => {
    const data = input(),
      record = await (await run(env, data)).json();
    assert.equal(record.status, 'ready');
    assert.equal(fixture.calls.length, 1);
    assert.equal(reads(), 1, 'somente revalidação do perfil, nenhuma leitura de jogo');
    assert.deepEqual(Object.keys(record.knowledge.profile).sort(), Object.keys(profileDefinitions).sort());
    assert.equal(record.knowledge.fields.recommendedAge.value, 14);
    const body = fixture.calls[0];
    assert.equal(body.systemInstruction.parts.length, 2);
    assert.match(body.systemInstruction.parts[0].text, /Prepare entre 10 e 24 seções/);
    assert.deepEqual(body.generationConfig.responseSchema.properties.sections.items.required, ['topic', 'title', 'text', 'sourceId', 'page', 'evidenceId']);
    assert.equal(record.lease, undefined);
    const cached = await (await run(env, { ...data, requestId: crypto.randomUUID() })).json();
    assert.equal(cached.status, 'ready');
    assert.equal(fixture.calls.length, 1);
    assert.equal(reads(), 1);
    const sources = record.knowledge.sources;
    const adopted = await reusableDraftKnowledge({ id: 'new-game', createdBy: 'owner', title: 'Título corrigido' }, sources, env);
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
    assert.equal((await fixture.storage.get('quota')).count, 1, 'adoção não incrementa cota');
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
test('troca de IDs locais não gera outra análise; versões e conteúdo diferentes não são promovidos', async () =>
  setup(async ({ env, fixture }) => {
    const data = input(),
      record = await (await run(env, data)).json();
    const changed = record.knowledge.sources.map((s) => ({ ...s, documentId: '11111111-1111-4111-8111-111111111111', id: 'manual-2' }));
    const result = await reusableDraftKnowledge({ id: 'x', createdBy: 'owner', title: 'Jogo' }, changed, env);
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
