import { facts, positive, text } from './io.js';

const lists = (data, key, name) =>
  (Array.isArray(data[key]) ? data[key] : [])
    .map((v) => text(v[name], 40))
    .filter(Boolean)
    .slice(0, 8);
function sourceURL(value) {
  try {
    const url = new URL(text(value, 400).replace(/^https:(?!\/\/)/, 'https://'));
    if (url.protocol === 'https:' && ['ludopedia.com.br', 'www.ludopedia.com.br'].includes(url.hostname) && !url.username && !url.password && /^\/jogo\/[a-z0-9_-]{1,160}\/?$/i.test(url.pathname)) {
      url.search = '';
      url.hash = '';
      return url.href;
    }
  } catch {}
  return 'https://ludopedia.com.br';
}
export function ludopediaCandidate(game, summary = false) {
  const id = positive(game.id_jogo, 999999999);
  if (!id || !text(game.nm_jogo)) return null;
  let min = positive(game.qt_jogadores_min, 100),
    max = positive(game.qt_jogadores_max, 100);
  if (!min || !max || min > max) min = max = null;
  return facts(
    'ludopedia',
    id,
    sourceURL(game.link),
    {
      title: text(game.nm_jogo),
      minPlayers: min,
      maxPlayers: max,
      durationMinutes: positive(game.vl_tempo_jogo),
      recommendedAge: positive(game.idade_minima, 100),
      mechanics: lists(game, 'mecanicas', 'nm_mecanica'),
      tags: lists(game, 'categorias', 'nm_categoria'),
    },
    {
      names: [{ value: text(game.nm_jogo), language: 'pt-BR' }, ...(text(game.nm_original) ? [{ value: text(game.nm_original), language: 'unknown' }] : [])],
      kind: game.tp_jogo === 'e' ? 'expansion' : game.tp_jogo === 'b' ? 'base' : 'unknown',
      identifiers: { ludopedia: String(id) },
      language: 'pt-BR',
      license: 'Ludopedia · API não comercial com atribuição',
      needsDetail: summary,
    },
  );
  // O esquema oficial não fornece descrição nem licença individual das capas.
  // Dados de comunidade/ano nacional não são números oficiais/edição do PDF.
}
export async function ludopedia(input, io) {
  if (input.action === 'detail') return [ludopediaCandidate(await io(`https://ludopedia.com.br/api/v1/jogos/${input.id}`))].filter(Boolean);
  const url = new URL('https://ludopedia.com.br/api/v1/jogos');
  url.search = new URLSearchParams({ search: input.query, rows: input.expanded ? '15' : '8', page: '1', ...(input.kind !== 'unknown' ? { tp_jogo: input.kind === 'base' ? 'b' : 'e' } : {}) });
  const data = await io(url.href);
  return (data.jogos || []).map((game) => ludopediaCandidate(game, true)).filter(Boolean);
}
