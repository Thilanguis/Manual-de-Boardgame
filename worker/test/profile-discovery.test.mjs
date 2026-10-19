import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverProfileNames, missingProfileFacts } from '../src/profile-discovery.js';
import { collectProfileKnowledge } from '../src/game-knowledge.js';
import { resetCatalogCache } from '../src/catalog/io.js';
import { knowledgeFixture } from '../../tests/knowledge-fixture.mjs';

const game = { title: 'Nome corrigido', edition: '2021', language: 'pt-BR' };
const who = { uid: 'owner', profile: { uid: 'owner', status: 'approved', role: 'superadmin' } };
const env = { GEMINI_API_KEY: 'fixture-secret', OWNER_UID: 'owner' };
test('descoberta usa título e edição atuais, não envia PDF nem ferramentas Google Search', async () => {
  let attempts = 0,
    body;
  const result = await discoverProfileNames(
    game,
    {},
    env,
    async (url, options) => {
      assert.match(url, /gemini-2.5-flash-lite:generateContent$/);
      assert.equal(options.headers['x-goog-api-key'], 'fixture-secret');
      body = JSON.parse(options.body);
      assert.equal(body.tools, undefined);
      assert.equal(body.systemInstruction.parts[0].text.includes('não afirme ter pesquisado'), true);
      assert(!options.body.includes('fixture-secret'));
      return Response.json({
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    ambiguous: false,
                    names: [
                      { value: 'Official Name', language: 'en' },
                      { value: 'Nome corrigido', language: 'pt-BR' },
                      { value: 'https://evil.test', language: 'en' },
                      { value: 'Official Name', language: 'en' },
                    ],
                    recommendedAge: 99,
                  }),
                },
              ],
            },
          },
        ],
      });
    },
    async () => {
      attempts++;
      return { allowed: true };
    },
  );
  assert.equal(attempts, 1);
  const input = JSON.parse(body.contents[0].parts[0].text);
  assert.deepEqual({ title: input.title, edition: input.edition }, { title: game.title, edition: '2021' });
  assert(input.missingFields.includes('recommendedAge'));
  assert.equal(input.sources, undefined);
  assert.deepEqual(result.hints, [{ value: 'Official Name', language: 'en', origin: 'gemini-hint' }]);
  assert.equal(result.recommendedAge, undefined);
});
test('campos completos dispensam descoberta e cota; limite bloqueia antes do transporte', async () => {
  let calls = 0;
  const filled = Object.fromEntries(missingProfileFacts({}).map((k) => [k, 1]));
  const result = await discoverProfileNames(
    game,
    filled,
    env,
    () => calls++,
    () => assert.fail('sem reserva'),
  );
  assert.equal(result.status, 'not-needed');
  const limited = await discoverProfileNames(
    game,
    {},
    env,
    () => calls++,
    async () => ({ allowed: false, reason: 'already-attempted', retryAt: 100 }),
  );
  assert.equal(limited.status, 'quota');
  assert.equal(calls, 0);
});
test('ambiguidade, indisponibilidade e 429 não disparam fallback nem repetição automática', async () => {
  for (const code of [403, 404, 429, 503]) {
    let calls = 0;
    const result = await discoverProfileNames(
      game,
      {},
      env,
      async () => {
        calls++;
        return Response.json({}, { status: code });
      },
      async () => ({ allowed: true }),
    );
    assert.equal(calls, 1);
    assert.equal(result.status, [403, 404].includes(code) ? 'unavailable' : code === 429 ? 'quota' : 'failed');
    assert.deepEqual(result.hints, []);
  }
  const fixture = knowledgeFixture();
  fixture.faults.discovery = { ambiguous: true, names: [{ value: 'Incompatível', language: 'en' }] };
  assert.equal((await discoverProfileNames(game, {}, env, fixture.fetch, async () => ({ allowed: true }))).hints.length, 0);
});
test('pista Gemini amplia descoberta, mas identidade exige nome confirmado independentemente', async () => {
  for (const verified of [false, true]) {
    resetCatalogCache();
    const fixture = knowledgeFixture({ names: [verified ? game.title : 'Outro jogo'] });
    fixture.faults.discovery = { ambiguous: false, names: [{ value: 'Official Name', language: 'en' }] };
    const fetcher = async (url, options) => {
      const response = await fixture.fetch(url, options);
      if (new URL(url).hostname === 'www.wikidata.org' && new URL(url).searchParams.get('action') !== 'wbsearchentities') {
        const data = await response.json();
        for (const e of Object.values(data.entities)) e.aliases = { en: [{ value: 'Official Name', language: 'en' }] };
        return Response.json(data);
      }
      return response || assert.fail('Destino não permitido: ' + url);
    };
    const result = await collectProfileKnowledge(game, { sources: [], diagnostics: [] }, env, who, fetcher, { reserve: async () => ({ allowed: true }) });
    assert.equal(fixture.discoveryCalls.length, 1);
    assert.equal(result.discovery.status, verified ? 'confirmed' : 'unconfirmed');
    assert.equal(!!result.sources.length, verified);
    assert(fixture.publicCalls.some((url) => new URL(url).searchParams.get('gsrsearch') === 'Official Name'));
    assert(fixture.publicCalls.every((url) => /\.(?:wikipedia|wikidata)\.org$/.test(new URL(url).hostname)));
  }
  resetCatalogCache();
});
