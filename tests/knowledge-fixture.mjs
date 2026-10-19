// Provedor e storage simulados; usa o coordenador e conectores reais do Worker.
import { KnowledgeStore } from '../worker/src/game-knowledge.js';
export function knowledgeFixture(fixtureOptions = {}) {
  const map = new Map();
  let chain = Promise.resolve();
  const storage = { get: async (key) => structuredClone(map.get(key)), put: async (key, value) => map.set(key, structuredClone(value)) };
  storage.transaction = (action) => {
    const current = chain.then(() => action(storage));
    chain = current.catch(() => {});
    return current;
  };
  const store = new KnowledgeStore({ storage });
  const faults = {},
    calls = [],
    discoveryCalls = [],
    catalogCalls = [],
    publicCalls = [];
  const names = fixtureOptions.names || ['Catan', 'Azul', 'O Senhor dos Anéis: Sina da Sociedade'];
  const claim = (value) => ({ rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value } } });
  const entities = Object.fromEntries(
    names.map((name, i) => [
      fixtureOptions.wikidataIds?.[i] || `Q${91000 + i}`,
      {
        id: fixtureOptions.wikidataIds?.[i] || `Q${91000 + i}`,
        labels: { pt: { value: name, language: 'pt' }, en: { value: name, language: 'en' } },
        descriptions: { pt: { value: 'jogo de tabuleiro com decisões compartilhadas', language: 'pt' } },
        claims: {
          P31: [claim({ id: 'Q131436' })],
          ...(fixtureOptions.catalogGame ? { P2339: [claim('1')] } : {}),
          P1872: [claim({ amount: '+' + (fixtureOptions.minPlayers || 3), unit: '1' })],
          P1873: [claim({ amount: '+' + (fixtureOptions.maxPlayers || 4), unit: '1' })],
          P2047: [claim({ amount: '+' + (fixtureOptions.durationMinutes || 75), unit: 'http://www.wikidata.org/entity/Q7727' })],
          P2899: [claim({ amount: '+' + (fixtureOptions.recommendedAge || 10), unit: '1' })],
        },
      },
    ]),
  );
  const articles = names.map((name, i) => ({
    pageid: 1000 + i,
    title: name,
    pageprops: { wikibase_item: fixtureOptions.wikidataIds?.[i] || `Q${91000 + i}` },
    extract: `${name} é um jogo de tabuleiro. As decisões dos participantes mudam o desenvolvimento da partida. A preparação e as regras da edição precisam ser conferidas no manual correspondente.`,
    ...(fixtureOptions.infobox ? { revisions: [{ revid: 12345, slots: { main: { content: fixtureOptions.infobox } } }] } : {}),
  }));
  return {
    faults,
    calls,
    discoveryCalls,
    catalogCalls,
    publicCalls,
    storage,
    env: { GEMINI_API_KEY: 'fixture-gemini-secret', GAME_KNOWLEDGE: { idFromName: (name) => name, get: () => store } },
    async fetch(value, options) {
      const url = new URL(String(value));
      if (fixtureOptions.catalogGame && ['boardgamegeek.com', 'ludopedia.com.br'].includes(url.hostname)) {
        catalogCalls.push(url.href);
        const game = fixtureOptions.catalogGame;
        if (url.hostname === 'boardgamegeek.com')
          return new Response(
            `<items><item type="boardgame" id="1"><name type="primary" value="${game.title}"/><yearpublished value="2016"/><minplayers value="2"/><maxplayers value="8"/><minplaytime value="20"/><maxplaytime value="20"/><minage value="8"/><link type="boardgamecategory" value="Card Game"/><link type="boardgamemechanic" value="Card Drafting"/><link type="boardgamemechanic" value="Set Collection"/><link type="boardgamedesigner" value="Designer de teste"/></item></items>`,
            { headers: { 'Content-Type': 'application/xml' } },
          );
        const data = {
          id_jogo: 1,
          nm_jogo: game.title,
          tp_jogo: 'b',
          ano_publicacao: 2016,
          designers: [{ nm_profissional: 'Designer de teste' }],
          qt_jogadores_min: 2,
          qt_jogadores_max: 8,
          vl_tempo_jogo: 20,
          idade_minima: 8,
          categorias: [{ nm_categoria: 'Jogo de cartas' }],
          mecanicas: [{ nm_mecanica: 'Seleção de cartas' }, { nm_mecanica: 'Coleção de conjuntos' }],
        };
        return Response.json(url.pathname.endsWith('/1') ? data : { jogos: [data] });
      }
      if (url.hostname === 'generativelanguage.googleapis.com') {
        if (url.pathname.includes('gemini-2.5-flash-lite:')) {
          const body = JSON.parse(options.body);
          discoveryCalls.push(body);
          if (faults.discoveryStatus) return Response.json({}, { status: faults.discoveryStatus });
          const result = typeof faults.discovery === 'function' ? faults.discovery(JSON.parse(body.contents[0].parts[0].text)) : faults.discovery || { names: [], ambiguous: false };
          return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } }] });
        }
        calls.push(JSON.parse(options.body));
        if (faults.network) throw new Error('fixture provider unavailable');
        if (faults.quota) return Response.json({ error: {} }, { status: 429 });
        if (faults.httpError) return Response.json({ error: faults.httpError.error }, { status: faults.httpError.status });
        if (faults.finishReason) return Response.json({ candidates: [{ finishReason: faults.finishReason, content: { parts: [{ text: '{"language":' }] } }], usageMetadata: { candidatesTokenCount: 6500 } });
        if (faults.invalid) return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }] });
        if (faults.wait) await faults.wait;
        const prompt = JSON.parse(calls.at(-1).contents[0].parts[0].text),
          source = prompt.sources.find((s) => s.pages) || prompt.sources.find((s) => s.name.includes('Wikipédia')) || prompt.sources[0];
        if (source.pages) {
          const first = source.pages[0],
            last = source.pages.at(-1);
          return Response.json({
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        language: 'pt-BR',
                        unconfirmed: [],
                        metadata: typeof faults.metadata === 'function' ? faults.metadata(prompt) : faults.metadata || {},
                        sections: [
                          {
                            topic: 'visao-geral',
                            title: 'Visão geral',
                            text: fixtureOptions.overviewText || 'A Sociedade coopera para proteger Frodo e alcançar o objetivo apresentado no manual.',
                            sourceId: source.id,
                            page: first.page,
                            evidenceId: first.passages[0].id,
                          },
                          {
                            topic: 'acoes',
                            title: fixtureOptions.actionTitle || 'Como atacar',
                            text: fixtureOptions.actionText || 'Para atacar, gaste uma ação e consulte a carta do cenário.',
                            sourceId: source.id,
                            page: last.page,
                            evidenceId: last.passages[0].id,
                          },
                        ],
                      }),
                    },
                  ],
                },
              },
            ],
          });
        }
        return Response.json({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      language: 'pt-BR',
                      sections: [
                        {
                          topic: 'visao-geral',
                          title: 'Visão geral',
                          text: `${prompt.game.title}: as decisões dos participantes mudam o desenvolvimento da partida.`,
                          sourceId: source.id,
                          quote: source.facts.description ? source.facts.description.slice(0, 60) : 'jogo de tabuleiro',
                        },
                        { topic: 'conceitos', title: 'Decisões da partida', text: 'As decisões dos participantes mudam o desenvolvimento da partida.', sourceId: source.id, quote: source.facts.description.slice(0, 60) },
                      ],
                      unconfirmed: ['Preparação e condições de vitória da edição precisam de confirmação.'],
                    }),
                  },
                ],
              },
            },
          ],
        });
      }
      if (url.hostname === 'www.wikidata.org' && url.pathname === '/w/api.php') {
        publicCalls.push(url.href);
        return Response.json(url.searchParams.get('action') === 'wbsearchentities' ? { search: Object.keys(entities).map((id) => ({ id })) } : { entities });
      }
      if (/^(pt|en|fr)\.wikipedia\.org$/.test(url.hostname) && url.pathname === '/w/api.php') {
        publicCalls.push(url.href);
        const pages = url.searchParams.has('pageids') ? articles.filter((p) => p.pageid === Number(url.searchParams.get('pageids'))) : articles;
        return Response.json({ query: { pages } });
      }
      return null;
    },
  };
}
