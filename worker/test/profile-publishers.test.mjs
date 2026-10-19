import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gamewrightFacts, collectPublisherFacts, resetPublisherCache } from '../src/profile-publishers.js';

const html = await readFile(new URL('../../tests/fixtures/gamewright-profile.html', import.meta.url), 'utf8');
const game = { title: 'Sushi GO Party', edition: '' };
const manual = { sources: [{ profileEligible: true, pages: [{ page: 1, text: 'Sushi Go Party! Publicado por Gamewright. www.gamewright.com' }] }] };
const response = (content = html, headers = {}) => new Response(content, { headers: { 'Content-Type': 'text/html', ...headers } });

test('editora: ficha real isola idade/jogadores/duração; duração fixa vira 30/30', () => {
  const result = gamewrightFacts(html, [game.title]);
  assert.deepEqual(result.fields, { title: 'Sushi Go Party!', minPlayers: 2, maxPlayers: 8, recommendedAge: 8, minDurationMinutes: 30, maxDurationMinutes: 30 });
  assert.equal(result.evidence.minDurationMinutes, '30 min');
  assert(!JSON.stringify(result).includes('99 min'));
  assert.equal(gamewrightFacts(html, ['Sushi Go']), null, 'jogo base e Party não são equivalentes');
  assert.equal(gamewrightFacts(html.replace('2-8', '8-2'), [game.title]).fields.minPlayers, undefined);
  const interval = gamewrightFacts(html.replace('30 min', '20–40 min'), [game.title]);
  assert.equal(interval.fields.minDurationMinutes, 20);
  assert.equal(interval.fields.maxDurationMinutes, 40);
});
test('somente domínio registrado e nome comprovado, sem URLs da IA, conteúdo autoral ou chamadas duplicadas', async () => {
  resetPublisherCache();
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, 'https://gamewright.com/product/Sushi-Go-Party');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, undefined);
    return response();
  };
  const results = await Promise.all(Array.from({ length: 5 }, () => collectPublisherFacts(game, manual, [], fetcher)));
  assert.equal(calls, 1);
  assert.equal(results[0].sources[0].facts.maxDurationMinutes, 30);
  assert.equal(results[0].sources[0].fieldEvidence.minDurationMinutes.url, 'https://gamewright.com/product/Sushi-Go-Party');
  assert.equal(results[0].sources[0].facts.description, undefined);
  assert.equal((await collectPublisherFacts({ ...game, edition: 'Edição especial' }, manual, [], fetcher)).sources[0].profileSpecificEligible, false);
  assert.equal(calls, 1);
  const untrusted = { sources: [{ pages: [{ text: 'https://evil.test/ www.gamewright.com.evil.test/' }] }] };
  assert.deepEqual((await collectPublisherFacts(game, { sources: [] }, [{ url: 'https://evil.test' }], () => assert.fail('sem editora identificada não consulta'))).sources, []);
  // Mesmo uma URL maliciosa nunca controla o endereço de destino.
  await collectPublisherFacts(game, untrusted, [], () => assert.fail('um subdomínio enganoso não identifica a editora'));
  assert.equal(calls, 1);
});
test('redirecionamento, resposta excessiva, nome diferente e limites da editora não viram fatos', async () => {
  for (const fetcher of [
    async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } }),
    async () => response('x'.repeat(150001)),
    async () => response(html.replace('Sushi Go Party!&trade;', 'Another Game')),
    async () => new Response(null, { status: 429, headers: { 'Retry-After': '120' } }),
  ]) {
    resetPublisherCache();
    const result = await collectPublisherFacts(game, manual, [], fetcher);
    assert.equal(result.sources.length, 0);
  }
  let calls = 0;
  resetPublisherCache();
  const fetcher = async () => {
    calls++;
    return new Response(null, { status: 429 });
  };
  await collectPublisherFacts(game, manual, [], fetcher);
  await collectPublisherFacts(game, manual, [], fetcher);
  assert.equal(calls, 1, 'sem retry automático após cota/pausa do provedor');
  const realNow = Date.now;
  let now = Date.parse('2026-10-19T12:00:00Z');
  try {
    Date.now = () => now;
    resetPublisherCache();
    calls = 0;
    const dated = async () => {
      calls++;
      return new Response(null, { status: 429, headers: { 'Retry-After': 'Mon, 19 Oct 2026 12:05:00 GMT' } });
    };
    await collectPublisherFacts(game, manual, [], dated);
    now += 61000;
    await collectPublisherFacts(game, manual, [], dated);
    assert.equal(calls, 1, 'Retry-After em data HTTP não é encurtado para um minuto');
  } finally {
    Date.now = realNow;
    resetPublisherCache();
  }
});
