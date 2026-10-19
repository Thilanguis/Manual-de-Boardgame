import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeFixture } from '../../tests/knowledge-fixture.mjs';
import { draftKnowledgeEndpoint, draftContextKey, reusableDraftKnowledge } from '../src/draft-knowledge.js';
import { resetCatalogCache } from '../src/catalog/io.js';
import { inspectProfile, profileDefinitions } from '../../js/profile-facts.js';
import { savedKnowledgeCandidate } from '../../js/research-enrichment.js';
import { searchKnowledge } from '../../js/rule-relevance.js';
import { consolidateMetadata } from '../../js/metadata-consolidation.js';

const title = 'Sushi Go Party!';
// Valores são fixtures de transporte; não são uma consulta real deste jogo.
const values = {
  title,
  edition: '2025',
  description: 'Escolha cartas e passe a mão restante, formando combinações para marcar pontos.',
  minPlayers: 2,
  maxPlayers: 8,
  minDurationMinutes: 20,
  maxDurationMinutes: 20,
  recommendedAge: 8,
  tags: ['Jogo de cartas'],
  mechanics: ['Seleção de cartas', 'Coleção de conjuntos'],
  gameType: 'Competitivo',
};
const manualText = `${title} — edição de 2025. Para 2 a 8 jogadores. Escolha uma carta e passe as demais cartas para o próximo jogador. Forme conjuntos de cartas e compare a pontuação: quem tiver mais pontos vence a partida.`;
const input = () => ({ title, edition: '', includePublic: true, retry: true, requestId: crypto.randomUUID(), documents: [{ id: 'main', hash: 'b'.repeat(64), name: 'manual_63713.pdf', language: 'pt-BR', pages: [{ page: 1, text: manualText }] }] });
const who = { uid: 'owner', token: 'local-fixture', profile: { uid: 'owner', role: 'superadmin', status: 'approved' } };
export function combinedMetadata(prompt) {
  const manual = prompt.sources.find((s) => s.pages),
    publicSource = prompt.sources.find((s) => s.profileOnly && s.name === 'Wikidata');
  const pubKeys = ['minDurationMinutes', 'maxDurationMinutes', 'recommendedAge'];
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      pubKeys.includes(key) ? (publicSource ? { value, sourceId: publicSource.id, quote: JSON.stringify(publicSource.facts) } : null) : { value, sourceId: manual.id, page: 1, evidenceId: manual.pages[0].passages[0].id },
    ]),
  );
}
async function setup(action) {
  resetCatalogCache();
  const fixture = knowledgeFixture({
    names: [title],
    minPlayers: 2,
    maxPlayers: 8,
    durationMinutes: 20,
    recommendedAge: 8,
    overviewText: values.description,
    actionTitle: 'Selecionar cartas',
    actionText: 'Escolha uma carta e passe as demais cartas ao próximo jogador.',
  });
  fixture.faults.metadata = combinedMetadata;
  const env = { ...fixture.env, FIREBASE_PROJECT_ID: 'demo-acervo', OWNER_UID: 'owner', ALLOW_MANUAL_AI: 'true' };
  const old = globalThis.fetch;
  let profileReads = 0,
    blocked = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://firestore.googleapis.com/')) {
      assert.match(String(url), /\/users\/owner$/);
      profileReads++;
      return Response.json({ fields: { uid: { stringValue: 'owner' }, role: { stringValue: 'superadmin' }, status: { stringValue: blocked ? 'blocked' : 'approved' } } });
    }
    const response = await fixture.fetch(url, options);
    if (response) return response;
    assert.fail('Destino não simulado: ' + url);
  };
  const run = async (data) => (await draftKnowledgeEndpoint(new Request('https://fixture.test/draft', { method: 'POST' }), env, who, data)).json();
  try {
    await action({ fixture, env, run, reads: () => profileReads, block: () => (blocked = true) });
  } finally {
    globalThis.fetch = old;
    resetCatalogCache();
  }
}

test('uma geração reúne ficha completa e regras; cache e adoção não repetem Gemini, catálogos ou leituras extras', () =>
  setup(async ({ fixture, env, run, reads }) => {
    const data = input(),
      record = await run(data);
    assert.equal(record.status, 'ready');
    assert.equal(record.knowledge.profileAnalysis.publicEvidenceProtocol, 3);
    assert.equal(record.knowledge.profileAnalysis.valid, 11);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.discoveryCalls.length, 1);
    assert.equal(reads(), 1, 'apenas revalidação final; catálogos internos usam o perfil já autorizado desta requisição');
    const prompt = JSON.parse(fixture.calls[0].contents[0].parts[0].text);
    assert.equal(prompt.game.title, title);
    assert(prompt.sources.some((s) => s.pages));
    assert(prompt.sources.some((s) => s.profileOnly));
    assert(!JSON.stringify(prompt).includes(data.documents[0].hash), 'hash privado não é enviado ao provedor');
    const schema = fixture.calls[0].generationConfig.responseSchema;
    assert.deepEqual(schema.properties.sections.items.required, ['topic', 'title', 'text', 'sourceId', 'page', 'evidenceId']);
    assert.equal(schema.properties.metadata.properties.recommendedAge.properties.quote.type, 'string');
    const pub = record.knowledge.sources.find((s) => s.profileOnly && s.name === 'Wikidata');
    assert.equal(record.knowledge.profile.recommendedAge.sourceId, pub.id);
    assert.equal(record.knowledge.profile.minDurationMinutes.value, 20);
    assert.equal(record.knowledge.profile.maxDurationMinutes.value, 20);
    assert(
      record.knowledge.sections.every((s) => s.sourceId !== pub.id),
      'fontes da ficha não alteram as seções de regras',
    );
    const calls = fixture.publicCalls.length;
    await run({ ...data, requestId: crypto.randomUUID() });
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.publicCalls.length, calls);
    assert.equal(fixture.discoveryCalls.length, 1, 'cache não repete descoberta de nomes');
    assert.equal(reads(), 1);
    const game = { id: 'saved', createdBy: 'owner', title, edition: '2025', manual: { sha256: data.documents[0].hash, pages: 1 } };
    const adopted = await reusableDraftKnowledge(
      game,
      record.knowledge.sources.filter((s) => s.pages),
      env,
    );
    assert(adopted);
    assert.equal(adopted.profile.recommendedAge.value, 8);
    assert(adopted.sources.some((s) => s.profileOnly));
    const candidate = savedKnowledgeCandidate({ knowledge: { ...adopted, fields: record.knowledge.fields } }, game);
    assert.equal(candidate.fields.recommendedAge, 8);
    assert.equal(candidate.fieldOrigins.recommendedAge, 'gemini-public');
    assert.equal(candidate.evidence.recommendedAge.url, pub.url);
    assert.equal(consolidateMetadata(game, [candidate]).fields.maxDurationMinutes, 20);
    assert(
      searchKnowledge(adopted, 'cartas').some((s) => s.page === 1),
      'regras já pesquisáveis sem aprovação',
    );
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.publicCalls.length, calls);
  }));

test('modelo complementar indisponível não impede ficha e regras nem cria ciclo ao reabrir', () =>
  setup(async ({ fixture, run }) => {
    fixture.faults.discoveryStatus = 403;
    const data = input(),
      result = await run(data);
    assert.equal(result.status, 'ready');
    assert.equal(result.knowledge.profileAnalysis.discovery.status, 'unavailable');
    assert.equal(result.knowledge.profile.minDurationMinutes.value, 20);
    assert.equal(fixture.discoveryCalls.length, 1);
    await run({ ...data, requestId: crypto.randomUUID(), retry: false });
    await run({ ...data, requestId: crypto.randomUUID() });
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.discoveryCalls.length, 1);
  }));

test('resultado antigo só de manual é completado no clique explícito e conserva regra corrigida', () =>
  setup(async ({ fixture, run }) => {
    const data = input(),
      baseline = await run({ ...data, includePublic: false });
    assert.equal(baseline.knowledge.profile.recommendedAge, undefined);
    assert.equal(fixture.publicCalls.length, 0);
    const key = await draftContextKey(who.uid, baseline.knowledge.sources),
      previous = await fixture.storage.get('job:' + key);
    previous.knowledge.sections[0].review = 'manual';
    previous.knowledge.sections[0].text = 'Minha correção foi preservada.';
    await fixture.storage.put('job:' + key, previous);
    const updated = await run({ ...data, requestId: crypto.randomUUID() });
    assert.equal(updated.knowledge.profile.recommendedAge.value, 8);
    assert.equal(updated.knowledge.profileAnalysis.valid, 11);
    assert(updated.knowledge.sections.some((s) => s.review === 'manual' && s.text === 'Minha correção foi preservada.'));
    assert.equal(fixture.calls.length, 2);
    await run({ ...data, requestId: crypto.randomUUID() });
    assert.equal(fixture.calls.length, 2);
  }));

test('número presente em outro campo público não vira idade e metadata não autoriza inventar páginas', () =>
  setup(async ({ run }) => {
    const record = await run(input()),
      sources = record.knowledge.sources,
      pub = sources.find((s) => s.profileOnly && s.name === 'Wikidata');
    const bad = { value: 20, sourceId: pub.id, quote: JSON.stringify(pub.facts) };
    assert.equal(inspectProfile({ recommendedAge: bad }, sources).fields.recommendedAge, undefined, '20 é duração, não idade');
    const other = { ...pub, profileSpecificEligible: false };
    assert.equal(inspectProfile({ recommendedAge: { ...bad, value: 8 } }, [other]).fields.recommendedAge, undefined, 'edição incompatível não fornece números');
  }));

test('revogação durante a geração combinada impede aceitar o resultado', () =>
  setup(async ({ fixture, run, block }) => {
    let release;
    fixture.faults.wait = new Promise((r) => (release = r));
    const pending = run(input());
    while (!fixture.calls.length) await new Promise((r) => setTimeout(r, 0));
    block();
    release();
    const record = await pending;
    assert.equal(record.status, 'attention');
    assert.equal(record.knowledge, undefined);
  }));
