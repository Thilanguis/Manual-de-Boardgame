import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { knowledgeFixture } from '../../tests/knowledge-fixture.mjs';
import { draftKnowledgeEndpoint, draftContextKey } from '../src/draft-knowledge.js';
import { resetCatalogCache } from '../src/catalog/io.js';
import { resetPublisherCache } from '../src/profile-publishers.js';
import { savedKnowledgeCandidate } from '../../js/research-enrichment.js';
import { consolidateMetadata, metadataUpdates } from '../../js/metadata-consolidation.js';
import { inspectProfile, profileDefinitions } from '../../js/profile-facts.js';
import { manualPassages } from '../src/manual-knowledge.js';

const html = await readFile(new URL('../../tests/fixtures/gamewright-profile.html', import.meta.url), 'utf8');
const title = 'Sushi Go Party!';
const text = `${title} www.gamewright.com. Para 2 a 8 jogadores. Idades: 8+. Escolha uma carta e passe as demais cartas para o próximo jogador. Forme conjuntos de cartas. Quem tiver mais pontos vence ao final de três rodadas.`;
const input = () => ({ title, edition: '', includePublic: true, retry: true, requestId: crypto.randomUUID(), documents: [{ id: 'main', hash: 'c'.repeat(64), name: 'manual.pdf', language: 'pt-BR', pages: [{ page: 1, text }] }] });
const who = { uid: 'owner', token: 'fixture', profile: { uid: 'owner', status: 'approved', role: 'superadmin' } };
async function setup(action, catalogs = false) {
  resetCatalogCache();
  resetPublisherCache();
  const fixture = knowledgeFixture({ names: [title], minPlayers: 2, maxPlayers: 8, durationMinutes: 20, recommendedAge: 8, ...(catalogs ? { catalogGame: { title } } : {}) });
  const env = {
    ...fixture.env,
    FIREBASE_PROJECT_ID: 'demo-acervo',
    OWNER_UID: 'owner',
    ALLOW_MANUAL_AI: 'true',
    ...(catalogs ? { BGG_TOKEN: 'fixture-bgg', BGG_LOGO_URL: 'https://thilanguis.github.io/Manual-de-Boardgame/assets/powered-by-bgg.svg', LUDOPEDIA_TOKEN: 'fixture-ludopedia' } : {}),
  };
  const previous = globalThis.fetch;
  fixture.faults.metadata = () => Object.fromEntries(Object.keys(profileDefinitions).map((k) => [k, null]));
  let publishers = 0,
    firestore = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('firestore.googleapis.com')) {
      firestore++;
      assert.match(String(url), /\/users\/owner$/);
      return Response.json({ fields: { uid: { stringValue: 'owner' }, status: { stringValue: 'approved' }, role: { stringValue: 'superadmin' } } });
    }
    if (String(url).startsWith('https://gamewright.com/')) {
      publishers++;
      if (new URL(url).pathname !== '/product/Sushi-Go-Party') return new Response(null, { status: 404 });
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }
    if (!catalogs && String(url).includes('wikipedia.org')) return Response.json({ query: { pages: [] } });
    if (!catalogs && String(url).includes('wikidata.org')) return Response.json({ search: [] });
    const result = await fixture.fetch(url, options);
    if (result) return result;
    assert.fail('Requisição não simulada: ' + url);
  };
  const run = async (data) => (await draftKnowledgeEndpoint(new Request('https://fixture.test/draft', { method: 'POST' }), env, who, data)).json();
  try {
    await action({ fixture, env, run, publishers: () => publishers, firestore: () => firestore });
  } finally {
    globalThis.fetch = previous;
    resetCatalogCache();
    resetPublisherCache();
  }
}

test('sem Wikidata/Wikipédia, ficha usa editora 30/30 e resumo/classificações Gemini do manual; cache e correções preservados', () =>
  setup(async ({ fixture, run, publishers, firestore }) => {
    fixture.faults.metadata = (prompt) => {
      const source = prompt.sources.find((s) => s.pages),
        ref = { sourceId: source.id, page: 1, evidenceId: source.pages[0].passages[0].id };
      return {
        ...Object.fromEntries(Object.keys(profileDefinitions).map((k) => [k, null])),
        title: { ...ref, value: title },
        description: { ...ref, value: 'Escolha cartas simultaneamente e passe a mão restante, formando conjuntos para somar mais pontos em três rodadas.' },
        tags: { ...ref, value: ['Jogo de cartas'] },
        mechanics: { ...ref, value: ['Seleção de cartas', 'Coleção de conjuntos'] },
        gameType: { ...ref, value: 'Competitivo' },
      };
    };
    const data = input(),
      record = await run(data);
    assert.equal(record.status, 'ready');
    const game = { id: 'draft', title, edition: '', language: 'pt-BR', sources: {}, manual: { sha256: data.documents[0].hash, pages: 1 } };
    const candidate = savedKnowledgeCandidate(record, game);
    assert.equal(candidate.fields.minDurationMinutes, 30);
    assert.equal(candidate.fields.maxDurationMinutes, 30);
    assert.equal(candidate.fieldOrigins.minDurationMinutes, 'publisher');
    assert.equal(candidate.evidence.minDurationMinutes.excerpt, '30 min');
    assert.equal(candidate.evidence.minDurationMinutes.url, 'https://gamewright.com/product/Sushi-Go-Party');
    assert.equal(candidate.fieldOrigins.description, 'gemini');
    assert.equal(candidate.fields.gameType, 'Competitivo');
    assert.deepEqual(candidate.fields.mechanics, ['Seleção de cartas', 'Coleção de conjuntos']);
    assert.equal(candidate.fields.edition, undefined, 'edição ausente não é inventada');
    const model = consolidateMetadata(game, [candidate]);
    const manuallyEdited = { ...game, minDurationMinutes: 25, maxDurationMinutes: 25, sources: { duration: { source: 'Conferido e ajustado por você', confirmedAt: Date.now() } } };
    assert.equal(metadataUpdates(model, manuallyEdited).minDurationMinutes, undefined);
    const tasks = fixture.calls[0].contents[0].parts.map((p) => {
      try {
        return JSON.parse(p.text);
      } catch {
        return null;
      }
    });
    assert(tasks.some((part) => part?.profileTask?.summary && part.profileTask.data));
    assert(tasks.some((part) => part?.verifiedFactCards?.some((c) => c.field === 'minDurationMinutes' && c.value === 30 && c.quote === '"minDurationMinutes":30')));
    assert.equal(record.knowledge.profileAnalysis.publicEvidenceProtocol, 3);
    assert.equal(fixture.calls.length, 1);
    assert.equal(publishers(), 1);
    assert.equal(firestore(), 1);
    await run({ ...data, requestId: crypto.randomUUID() });
    assert.equal(fixture.calls.length, 1);
    assert.equal(publishers(), 1);
    assert.equal(firestore(), 1);
  }));

test('BGG e Ludopedia autorizados são detalhados antes da síntese; fichas estruturadas vão na mesma geração', () =>
  setup(async ({ fixture, run }) => {
    const data = input();
    data.documents[0].pages[0].text = text.replace('www.gamewright.com.', '');
    const record = await run(data);
    const sources = record.knowledge.sources.filter((s) => s.profileOnly);
    assert(sources.some((s) => s.catalogSource === 'bgg' && s.facts.minDurationMinutes === 20));
    assert(sources.some((s) => s.catalogSource === 'ludopedia' && s.facts.recommendedAge === 8));
    const prompt = JSON.parse(fixture.calls[0].contents[0].parts[0].text);
    assert(prompt.sources.some((s) => s.name === 'BoardGameGeek'));
    assert(prompt.sources.some((s) => s.name === 'Ludopedia'));
    assert.equal(fixture.catalogCalls.length, 4, 'uma busca e um detalhe por conector; cache evita segunda descoberta duplicada');
    assert.equal(fixture.calls.length, 1);
    await run({ ...data, requestId: crypto.randomUUID() });
    assert.equal(fixture.catalogCalls.length, 4);
    assert.equal(fixture.calls.length, 1);
  }, true));

test('referência metadata com ID errado só é recuperada por excerpt literal único na mesma página', () => {
  const source = { id: 'manual', documentId: 'main', sourceHash: 'd'.repeat(64), pages: [{ page: 1, text }] };
  const fact = { value: 'Competitivo', sourceId: source.id, page: 1, evidenceId: 'id-errado', excerpt: 'Quem tiver mais pontos vence ao final de três rodadas.' };
  const checked = inspectProfile({ gameType: fact }, [source], manualPassages);
  assert.equal(checked.fields.gameType.evidenceId, 'manual-p1-1');
  assert.equal(inspectProfile({ gameType: { ...fact, page: 2 } }, [source], manualPassages).fields.gameType, undefined);
  assert.equal(inspectProfile({ gameType: { ...fact, excerpt: 'Frase que não existe no manual.' } }, [source], manualPassages).fields.gameType, undefined);
  assert.equal(
    inspectProfile({ gameType: fact }, [source], () => [
      { id: 'a', text },
      { id: 'b', text },
    ]).fields.gameType,
    undefined,
    'trecho ambíguo não corrige referência',
  );
});

test('nome português usa pista inglesa automaticamente, mas só confirma a editora com evidência independente no manual', async () => {
  for (const verified of [true, false])
    await setup(async ({ fixture, run, publishers }) => {
      fixture.faults.discovery = { names: [{ value: title, language: 'en' }], ambiguous: false };
      const data = input();
      data.title = 'Festa do Sushi';
      if (!verified) data.documents[0].pages[0].text = text.replaceAll(title, 'Festa do Sushi');
      const record = await run(data);
      const publisher = record.knowledge.sources.find((s) => s.catalogSource === 'publisher');
      assert.equal(!!publisher, verified);
      if (verified) assert.equal(publisher.facts.minDurationMinutes, 30);
      assert.equal(publishers(), verified ? 2 : 1, 'no máximo duas páginas; cache negativo evita repetir o endereço inexistente');
      assert.equal(fixture.discoveryCalls.length, 1);
      assert.equal(fixture.calls.length, 1);
    });
});

test('análise antiga parcial só atualiza no clique explícito; regra corrigida fica salva', () =>
  setup(async ({ fixture, run }) => {
    const data = input(),
      first = await run(data);
    const key = await draftContextKey(who.uid, first.knowledge.sources);
    const old = await fixture.storage.get('job:' + key);
    old.knowledge.profileAnalysis.publicEvidenceProtocol = 1;
    old.knowledge.sections[0].review = 'manual';
    old.knowledge.sections[0].text = 'Minha regra corrigida.';
    await fixture.storage.put('job:' + key, old);
    await run({ ...data, retry: false, requestId: crypto.randomUUID() });
    assert.equal(fixture.calls.length, 1, 'abrir não gera');
    const next = await run({ ...data, requestId: crypto.randomUUID() });
    assert.equal(next.knowledge.profileAnalysis.publicEvidenceProtocol, 3);
    assert(next.knowledge.sections.some((s) => s.review === 'manual' && s.text === 'Minha regra corrigida.'));
    assert.equal(fixture.calls.length, 2);
    await run({ ...data, requestId: crypto.randomUUID() });
    assert.equal(fixture.calls.length, 2);
  }));

test('ficha salva com rótulo de resumo só renova no clique explícito e depois reutiliza a nova análise', () =>
  setup(async ({ fixture, run }) => {
    const data = input(),
      first = await run(data),
      key = await draftContextKey(who.uid, first.knowledge.sources);
    const saved = await fixture.storage.get('job:' + key);
    delete saved.knowledge.profileAnalysis.summaryProtocol;
    saved.knowledge.profile.description = { value: 'jogo de cartas', sourceId: saved.knowledge.sources[0].id, page: 1, quote: text, excerpt: text };
    saved.knowledge.fields = { description: saved.knowledge.profile.description };
    await fixture.storage.put('job:' + key, saved);
    await run({ ...data, retry: false, requestId: crypto.randomUUID() });
    assert.equal(fixture.calls.length, 1, 'abrir não gera');
    const updated = await run({ ...data, requestId: crypto.randomUUID() });
    assert.equal(fixture.calls.length, 2, 'clique explícito atualiza análise antiga');
    assert.equal(updated.knowledge.profileAnalysis.summaryProtocol, 1);
    await run({ ...data, requestId: crypto.randomUUID() });
    assert.equal(fixture.calls.length, 2, 'resultado novo fica em cache');
  }));
