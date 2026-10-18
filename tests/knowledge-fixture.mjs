// Provedor e storage simulados; usa o coordenador e conectores reais do Worker.
import { KnowledgeStore } from '../worker/src/game-knowledge.js';
export function knowledgeFixture() {
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
    publicCalls = [];
  const names = ['Catan', 'Azul', 'O Senhor dos Anéis: Sina da Sociedade'];
  const claim = (value) => ({ rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value } } });
  const entities = Object.fromEntries(
    names.map((name, i) => [
      `Q${91000 + i}`,
      {
        id: `Q${91000 + i}`,
        labels: { pt: { value: name, language: 'pt' }, en: { value: name, language: 'en' } },
        descriptions: { pt: { value: 'jogo de tabuleiro com decisões compartilhadas', language: 'pt' } },
        claims: {
          P31: [claim({ id: 'Q131436' })],
          P1872: [claim({ amount: '+3', unit: '1' })],
          P1873: [claim({ amount: '+4', unit: '1' })],
          P2047: [claim({ amount: '+75', unit: 'http://www.wikidata.org/entity/Q7727' })],
          P2899: [claim({ amount: '+10', unit: '1' })],
        },
      },
    ]),
  );
  const articles = names.map((name, i) => ({
    pageid: 1000 + i,
    title: name,
    pageprops: { wikibase_item: `Q${91000 + i}` },
    extract: `${name} é um jogo de tabuleiro. As decisões dos participantes mudam o desenvolvimento da partida. A preparação e as regras da edição precisam ser conferidas no manual correspondente.`,
  }));
  return {
    faults,
    calls,
    publicCalls,
    storage,
    env: { GEMINI_API_KEY: 'fixture-gemini-secret', GAME_KNOWLEDGE: { idFromName: (name) => name, get: () => store } },
    async fetch(value, options) {
      const url = new URL(String(value));
      if (url.hostname === 'generativelanguage.googleapis.com') {
        calls.push(JSON.parse(options.body));
        if (faults.network) throw new Error('fixture provider unavailable');
        if (faults.quota) return Response.json({ error: {} }, { status: 429 });
        if (faults.invalid) return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }] });
        if (faults.wait) await faults.wait;
        const prompt = JSON.parse(calls.at(-1).contents[0].parts[0].text),
          source = prompt.sources.find((s) => s.name.includes('Wikipédia')) || prompt.sources[0];
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
                        metadata: typeof faults.metadata==='function' ? faults.metadata(prompt) : faults.metadata || {},
                        sections: [
                          { topic: 'visao-geral', title: 'Visão geral', text: 'A Sociedade coopera para proteger Frodo e alcançar o objetivo apresentado no manual.', sourceId: source.id, page: first.page, evidenceId: first.passages[0].id },
                          { topic: 'acoes', title: 'Como atacar', text: 'Para atacar, gaste uma ação e consulte a carta do cenário.', sourceId: source.id, page: last.page, evidenceId: last.passages[0].id },
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
