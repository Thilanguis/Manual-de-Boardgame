import test from 'node:test';
import assert from 'node:assert/strict';
import { collectProfileKnowledge, collectPublicKnowledge } from '../src/game-knowledge.js';
import { knowledgeFixture } from '../../tests/knowledge-fixture.mjs';
import { resetCatalogCache } from '../src/catalog/io.js';
const who = { uid: 'owner', profile: { uid: 'owner', role: 'superadmin', status: 'approved' } };
test('Completar informações usa consulta interativa; falha maxlag de tarefa de fundo não é ausência de jogo', async () => {
  resetCatalogCache();
  const fixture = knowledgeFixture({ names: ['Sushi Go Party!'] });
  const urls = [];
  const fetcher = async (url, options) => {
    urls.push(new URL(url));
    return (await fixture.fetch(url, options)) || assert.fail('Destino não simulado');
  };
  const env = { ...fixture.env, OWNER_UID: 'owner' };
  const game = { title: 'Sushi Go Party!', edition: '', language: 'pt-BR' };
  const result = await collectProfileKnowledge(game, { sources: [], diagnostics: [] }, env, who, fetcher);
  assert.ok(result.sources.some((s) => s.name === 'Wikidata'));
  assert.ok(urls.filter((u) => u.hostname === 'www.wikidata.org').every((u) => !u.searchParams.has('maxlag')));
  resetCatalogCache();
  const failed = await collectPublicKnowledge(game, env, who, async () => Response.json({ error: { code: 'maxlag' } }), { alreadyAuthorized: true });
  assert.ok(failed.diagnostics.every((d) => d.state === 'failed'));
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.discoveryCalls.length, 0);
  resetCatalogCache();
});
