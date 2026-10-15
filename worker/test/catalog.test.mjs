import test from 'node:test';
import assert from 'node:assert/strict';
import { wikidataCandidate, wikidata } from '../src/catalog/wikidata.js';
import { ludopediaCandidate, ludopedia } from '../src/catalog/ludopedia.js';
import { bgg } from '../src/catalog/bgg.js';
import { catalogIO, resetCatalogCache } from '../src/catalog/io.js';
import { queryCatalog, validateQuery, sourceStatus } from '../src/catalog/index.js';

const claim = (value, qualifiers = {}) => ({ rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value } }, qualifiers });
const entity = {
  id: 'Q17271',
  labels: { 'pt-br': { value: 'Colonizadores de Catan', language: 'pt-br' }, en: { value: 'The Settlers of Catan', language: 'en' } },
  aliases: { en: [{ value: 'Catan' }] },
  descriptions: { pt: { value: 'jogo de tabuleiro', language: 'pt' } },
  claims: {
    P31: [claim({ id: 'Q131436' })],
    P2339: [claim('13')],
    P1872: [claim({ amount: '+3', unit: '1' })],
    P1873: [claim({ amount: '+4', unit: '1' })],
    P2047: [claim({ amount: '+75', unit: 'http://www.wikidata.org/entity/Q7727' })],
    P2899: [claim({ amount: '+10', unit: 'http://www.wikidata.org/entity/Q24564698' })],
    P18: [claim('Catan.jpg')],
  },
};
test('Wikidata fornece nomes PT-BR, aliases verificáveis e apenas fatos sem licença de imagem presumida', () => {
  const result = wikidataCandidate(entity);
  assert.equal(result.fields.title, 'Colonizadores de Catan');
  assert.equal(result.fields.recommendedAge, 10);
  assert.equal(result.fields.durationMinutes, 75);
  assert(result.names.some((n) => n.value === 'Catan'));
  assert.equal(result.identifiers.bgg, '13');
  assert.equal(result.image, undefined);
  assert.equal(result.fields.edition, undefined);
  assert.equal(result.license, 'CC0');
  assert.equal(wikidataCandidate({ ...entity, claims: { P31: [claim({ id: 'Q7889' })], P2339: [claim('13')] } }), null);
  assert.equal(wikidataCandidate({ ...entity, claims: {} }), null);
});
test('divergências e qualificadores de edição não são transformados em um número inventado', () => {
  const result = wikidataCandidate({
    ...entity,
    claims: { ...entity.claims, P1872: [claim({ amount: '+3', unit: '1' }), claim({ amount: '+2', unit: '1' })], P2047: [claim({ amount: '+60', unit: 'http://www.wikidata.org/entity/Q7727' }, { P518: [{}] })] },
  });
  assert.equal(result.fields.minPlayers, undefined);
  assert.equal(result.fields.maxPlayers, undefined);
  assert.equal(result.fields.durationMinutes, undefined);
  assert.equal(result.conflicts.length, 2);
});
test('busca Wikidata descarta cidades homônimas usando tipo/identificador, entrega nomes em PT-BR', async () => {
  const urls = [];
  const result = await wikidata({ action: 'search', query: 'Catan', pdfLanguage: 'en', preferredLanguage: 'pt-BR' }, async (url) => {
    urls.push(new URL(url));
    return urls.length === 1 ? { search: [{ id: 'Q17271' }, { id: 'Q123' }] } : { entities: { Q17271: entity, Q123: { id: 'Q123', labels: { en: { value: 'Catan City' } } } } };
  });
  assert.equal(result.length, 1);
  assert.equal(urls[0].searchParams.get('language'), 'en');
  assert.equal(urls[0].searchParams.get('maxlag'), '5');
  assert.equal(result[0].fields.title, 'Colonizadores de Catan');
});
test('Ludopedia preserva nome original e diferencia expansão; não copia capa nem estatística da comunidade', async () => {
  const game = {
    id_jogo: 1,
    nm_jogo: 'Ilha',
    nm_original: 'Island',
    tp_jogo: 'e',
    qt_jogadores_min: 2,
    qt_jogadores_max: 4,
    vl_tempo_jogo: 45,
    idade_minima: 10,
    comunidade: { qt_jogadores_min: 1 },
    thumb: 'https://image.test',
    ano_nacional: 2024,
    mecanicas: [{ nm_mecanica: 'Cartas' }],
    categorias: [{ nm_categoria: 'Família' }],
  };
  const value = ludopediaCandidate(game);
  assert.equal(value.kind, 'expansion');
  assert.equal(value.fields.minPlayers, 2);
  assert.equal(value.names[1].value, 'Island');
  assert.equal(value.image, undefined);
  assert.equal(value.fields.edition, undefined);
  assert.equal(ludopediaCandidate({ ...game, link: 'https:ludopedia.com.br/jogo/ilha' }).url, 'https://ludopedia.com.br/jogo/ilha');
  assert.equal(ludopediaCandidate({ ...game, link: 'https://untrusted.test/jogo/ilha' }).url, 'https://ludopedia.com.br');
  const results = await ludopedia({ action: 'search', query: 'Ilha', kind: 'expansion' }, async (url) => {
    assert.equal(new URL(url).searchParams.get('tp_jogo'), 'e');
    return { jogos: [game] };
  });
  assert.equal(results[0].needsDetail, true);
});
test('BGG autorizado disponibiliza fatos e aliases; descrição e imagens autorais ficam fora da importação', async () => {
  const result = await bgg(
    { action: 'detail', id: '13' },
    async () =>
      '<items><item type="boardgame" id="13"><name type="primary" value="Catan"/><name type="alternate" value="Colonizadores de Catan"/><description>Texto autoral</description><image>https://image.test/catan.jpg</image><minplayers value="3"/><maxplayers value="4"/><minage value="10"/></item></items>',
  );
  assert.equal(result[0].fields.minPlayers, 3);
  assert.equal(result[0].fields.description, undefined);
  assert.equal(result[0].image, undefined);
  assert.equal(result[0].names.length, 2);
});
test('cache respeita no-store, pausa Retry-After e respostas grandes/redirects não são seguidos', async () => {
  resetCatalogCache();
  let calls = 0;
  const io = catalogIO('test', {
    interval: 0,
    fetcher: async () => {
      calls++;
      return Response.json({ ok: true }, { headers: { 'Cache-Control': 'max-age=60' } });
    },
  });
  await io('https://fixed.test/a');
  await io('https://fixed.test/a');
  assert.equal(calls, 1);
  const noStore = catalogIO('private', {
    interval: 0,
    fetcher: async () => {
      calls++;
      return Response.json({}, { headers: { 'Cache-Control': 'no-store' } });
    },
  });
  await noStore('https://fixed.test/a');
  await noStore('https://fixed.test/a');
  assert.equal(calls, 3);
  let limitedCalls = 0;
  const limited = catalogIO('limited', {
    interval: 0,
    fetcher: async () => {
      limitedCalls++;
      return new Response('', { status: 429, headers: { 'Retry-After': '60' } });
    },
  });
  await assert.rejects(limited('https://fixed.test/a'), (e) => e.status === 429);
  await assert.rejects(limited('https://fixed.test/b'), (e) => e.status === 429);
  assert.equal(limitedCalls, 1);
  await assert.rejects(
    catalogIO('redirect', {
      fetcher: async (_, options) => {
        assert.equal(options.redirect, 'manual');
        return new Response('', { status: 302, headers: { Location: 'https://untrusted.test' } });
      },
    })('https://fixed.test/a'),
    (e) => e.status === 502,
  );
  await assert.rejects(catalogIO('large', { fetcher: async () => new Response('x'.repeat(900001)) })('https://fixed.test/a'), (e) => e.status === 502);
});
test('perfil autorizado recebe a consulta completa; bloqueio atual é verificado antes do cache', async () => {
  resetCatalogCache();
  const env = { FIREBASE_PROJECT_ID: 'test', OWNER_UID: 'owner' },
    identity = { uid: 'owner', token: 'firebase-test' };
  let enabled = true,
    providerCalls = 0,
    profileCalls = 0;
  const fetcher = async (url, options) => {
    if (String(url).includes('firestore.googleapis.com')) {
      profileCalls++;
      assert.equal(options.headers.Authorization, 'Bearer firebase-test');
      return Response.json({ fields: { uid: { stringValue: 'owner' }, role: { stringValue: 'superadmin' }, status: { stringValue: enabled ? 'approved' : 'blocked' } } });
    }
    providerCalls++;
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://www.wikidata.org');
    assert.equal(parsed.searchParams.has('maxlag'), false);
    return parsed.searchParams.get('action') === 'wbsearchentities' ? Response.json({ search: [{ id: 'Q17271', description: 'board game' }] }) : Response.json({ entities: { Q17271: entity } });
  };
  const first = await queryCatalog('wikidata', { action: 'search', query: 'Catan' }, env, identity, null, fetcher);
  assert.equal(first.candidates[0].fields.title, 'Colonizadores de Catan');
  const initialCalls = providerCalls;
  assert.equal(initialCalls, 5);
  await queryCatalog('wikidata', { action: 'search', query: 'Catan' }, env, identity, null, fetcher);
  assert.equal(providerCalls, initialCalls);
  enabled = false;
  await assert.rejects(queryCatalog('wikidata', { action: 'search', query: 'Catan' }, env, identity, null, fetcher), (e) => e.status === 403);
  assert.equal(profileCalls, 3);
  assert.equal(providerCalls, initialCalls);
});

test('consulta compartilhada não prolonga o prazo curto de outra requisição', async () => {
  resetCatalogCache();
  let finish,
    calls = 0;
  const first = catalogIO('shared', {
    interval: 0,
    fetcher: () => {
      calls++;
      return new Promise((resolve) => (finish = resolve));
    },
  })('https://fixed.test/a');
  const controller = new AbortController(),
    second = catalogIO('shared', {
      signal: controller.signal,
      interval: 0,
      fetcher: () => {
        throw new Error('não deve repetir');
      },
    })('https://fixed.test/a');
  controller.abort(new Error('prazo curto'));
  await assert.rejects(second, /prazo curto/);
  assert.equal(calls, 1);
  finish(Response.json({ ok: true }));
  assert.deepEqual(await first, { ok: true });
});

test('somente perfil aprovado com permissão atual consulta fontes; credenciais não são publicadas', async () => {
  const env = { FIREBASE_PROJECT_ID: 'test', OWNER_UID: 'owner', LUDOPEDIA_TOKEN: 'private-test-token' },
    identity = { uid: 'owner', token: 'fake-firebase' };
  assert(!JSON.stringify(sourceStatus(env)).includes('private-test-token'));
  let calls = 0;
  await assert.rejects(
    queryCatalog('wikidata', { action: 'search', query: 'Catan' }, env, null, null, async () => {
      calls++;
    }),
    (e) => e.status === 401,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    queryCatalog('wikidata', { action: 'search', query: 'Catan' }, env, identity, null, async (url) => {
      calls++;
      assert(String(url).includes('/users/owner'));
      return Response.json({ fields: { uid: { stringValue: 'owner' }, role: { stringValue: 'superadmin' }, status: { stringValue: 'blocked' } } });
    }),
    (e) => e.status === 403,
  );
  assert.equal(calls, 1);
  assert.throws(
    () => validateQuery('https://untrusted.test', { action: 'search', query: 'Catan' }),
    (e) => e.status === 404,
  );
  assert.throws(
    () => validateQuery('ludopedia', { action: 'detail', id: '../users' }),
    (e) => e.status === 400,
  );
});
