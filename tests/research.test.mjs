import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMetadata, titleCandidates } from '../js/recognition.js';
import { normalizedQuery, parallelResearch, researchRequest, sameWork, matchWarnings, selectedFields } from '../js/research-client.js';

test('lista de fontes também envia o token exigido pelo Worker privado', async () => {
  let calls = 0;
  const data = await researchRequest('https://api.test', async () => 'token-ficticio', 'sources', null, {
    fetcher: async (url, options) => {
      calls++;
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'Bearer token-ficticio');
      assert.equal(options.body, undefined);
      return Response.json({ sources: [] });
    },
  });
  assert.deepEqual(data.sources, []);
  await assert.rejects(
    researchRequest('https://api.test', async () => null, 'sources', null, {
      fetcher: () => {
        calls++;
      },
    }),
    /Entre com/,
  );
  assert.equal(calls, 1, 'sem sessão não consulta o endpoint');
});

test('PDF francês extrai fatos explícitos sem estimar intervalos ou traduzir regras', () => {
  const result = extractMetadata(
    'Joueurs: 2 à 4\nDurée: 45 minutes\nÂge: 10 ans\nÉdition: Québec 2024\nMécaniques: Placement, Cartes\nCatégories: Famille\nTitre original: Test Island\nObjectif du jeu\nCollectez les cartes.\nPréparation\nPlacez les pièces sur le plateau. Victoire et points du jeu.',
  );
  assert.deepEqual([result.minPlayers, result.maxPlayers, result.durationMinutes, result.recommendedAge], [2, 4, 45, 10]);
  assert.equal(result.edition, 'Québec 2024');
  assert.equal(result.language, 'fr');
  assert.equal(result.description, 'Collectez les cartes.');
  assert.equal(result.sources.originalTitle.excerpt, 'Test Island');
  assert.equal(extractMetadata('Durée: 30 à 60 minutes').durationMinutes, null);
  assert.equal(extractMetadata('Composants: 4 pièces et 20 cartes').minPlayers, null);
  assert.equal(normalizedQuery('Catan—2e_édition'), 'Catan 2e édition');
  assert.equal(titleCandidates({ filename: 'Catan_règles_français.pdf' })[0].text, 'Catan');
});
test('fontes entregam resultados independentes antes da fonte lenta e aceitam cancelamento', async () => {
  const controller = new AbortController(),
    events = [];
  let finish;
  const slow = new Promise((resolve) => (finish = resolve));
  const pending = parallelResearch(
    [
      { id: 'ludopedia', enabled: true },
      { id: 'wikidata', enabled: true },
      { id: 'bgg', enabled: false },
    ],
    {},
    async (source) => (source === 'ludopedia' ? slow : { candidates: [{ id: 'Q17271' }] }),
    { signal: controller.signal, onUpdate: (event) => events.push(event) },
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert(events.some((e) => e.source === 'wikidata' && e.status === 'done'));
  assert(!events.some((e) => e.source === 'ludopedia' && e.status === 'done'));
  controller.abort();
  finish({ candidates: [] });
  await pending;
  assert(!events.some((e) => e.source === 'ludopedia' && e.status === 'done'));
});
test('prazo curto inclui autenticação pendente; cancelamento interrompe fetch', async () => {
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(
      researchRequest('https://api.test', () => new Promise(() => {}), 'wikidata', {}, { timeoutMs: 15 }),
      /demorou/,
    );
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await assert.rejects(
      researchRequest(
        'https://api.test',
        async () => 'fake',
        'wikidata',
        {},
        {
          signal: controller.signal,
          fetcher: async () => {
            calls++;
            return Response.json({});
          },
        },
      ),
    );
    assert.equal(calls, 0);
  } finally {
    clearTimeout(keepAlive);
  }
});
test('identidade usa identificadores verificados; homônimos, edições e expansões não são fundidos', () => {
  const a = { source: 'wikidata', names: [{ value: 'Colonizadores de Catan' }], kind: 'unknown', edition: '', identifiers: { bgg: '13' }, fields: { minPlayers: 3 } };
  const b = { ...a, source: 'bgg', kind: 'base', fields: { minPlayers: 2 } };
  assert.equal(sameWork(a, b), true);
  assert.equal(sameWork({ ...b, kind: 'expansion' }, b), false);
  assert.equal(sameWork({ ...a, identifiers: {} }, b), false);
  assert.equal(sameWork({ ...b, edition: '2024' }, { ...b, edition: '1995' }), false);
  const warnings = matchWarnings(a, { title: 'Jogo homônimo', edition: '2024' }, [a, b]);
  assert(warnings.some((w) => w.includes('homônimos')));
  assert(warnings.some((w) => w.includes('discordam')));
  assert(warnings.some((w) => w.includes('2024')));
});
test('dados do PDF ficam desmarcados quando contradizem catálogo; ausências podem ser preenchidas após revisão', () => {
  const choices = selectedFields({ fields: { title: 'Catan', minPlayers: 3, durationMinutes: 75 }, conflicts: [] }, { title: 'Catan Brasil', minPlayers: 2, durationMinutes: null });
  assert.equal(choices.find((f) => f.key === 'minPlayers').checked, false);
  assert.equal(choices.find((f) => f.key === 'title').conflict, true);
  assert.equal(choices.find((f) => f.key === 'minDurationMinutes').checked, true);
});
