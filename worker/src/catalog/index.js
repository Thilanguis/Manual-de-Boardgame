import { ApiError, permissions } from '../auth.js';
import { getDocument } from '../services.js';
import { catalogIO } from './io.js';
import { wikidata } from './wikidata.js';
import { ludopedia } from './ludopedia.js';
import { bgg } from './bgg.js';

export const validBggLogo = (env) => /^https:\/\/thilanguis\.github\.io\/Manual-de-Boardgame\/assets\/powered-by-bgg\.(?:png|svg|webp)$/.test(env.BGG_LOGO_URL || '');
export const sourceStatus = (env) => [
  {
    id: 'ludopedia',
    name: 'Ludopedia',
    language: 'pt-BR',
    enabled: !!env.LUDOPEDIA_TOKEN,
    reason: env.LUDOPEDIA_TOKEN ? 'API autorizada · atribuição obrigatória' : 'Aplicação autorizada e token ainda necessários',
    url: 'https://ludopedia.com.br',
    policy: 'https://ludopedia.com.br/aplicativo',
  },
  { id: 'wikidata', name: 'Wikidata', language: 'multilingual', enabled: true, reason: 'Dados estruturados CC0 · cobertura variável', url: 'https://www.wikidata.org', policy: 'https://www.wikidata.org/wiki/Wikidata:Data_access' },
  {
    id: 'bgg',
    name: 'BoardGameGeek',
    language: 'en',
    enabled: !!env.BGG_TOKEN && validBggLogo(env),
    reason: env.BGG_TOKEN && validBggLogo(env) ? 'API autorizada · atribuição obrigatória' : 'Aplicação aprovada, token e logo oficial ainda necessários',
    ...(validBggLogo(env) ? { logo: env.BGG_LOGO_URL } : {}),
    url: 'https://boardgamegeek.com',
    policy: 'https://boardgamegeek.com/using_the_xml_api',
  },
];
const connectors = { wikidata, ludopedia, bgg };
export function validateQuery(source, raw) {
  if (!connectors[source]) throw new ApiError(404, 'Fonte de consulta não disponível.');
  if (!['search', 'detail'].includes(raw.action) || !['pt-BR', 'en', 'fr'].includes(raw.preferredLanguage || 'pt-BR')) throw new ApiError(400, 'Consulta ou idioma inválido.');
  const query =
    typeof raw.query === 'string'
      ? raw.query
          .replace(/[_\-–—]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  if (raw.action === 'search' && (query.length < 2 || query.length > 160)) throw new ApiError(400, 'Informe um nome entre 2 e 160 caracteres.');
  if (raw.action === 'detail' && !(source === 'wikidata' ? /^Q[1-9]\d{0,10}$/ : /^[1-9]\d{0,8}$/).test(String(raw.id))) throw new ApiError(400, 'Identificador inválido.');
  if (raw.kind && !['base', 'expansion', 'unknown'].includes(raw.kind)) throw new ApiError(400, 'Tipo de produto inválido.');
  return {
    action: raw.action,
    query,
    id: String(raw.id || ''),
    preferredLanguage: raw.preferredLanguage || 'pt-BR',
    pdfLanguage: ['pt-BR', 'en', 'fr'].includes(raw.pdfLanguage) ? raw.pdfLanguage : 'other',
    kind: raw.kind || 'unknown',
    expanded: raw.expanded === true,
    // Endpoint interativo chamado pelo formulário; nenhum robô ou varredura em lote.
    interactive: true,
  };
}
export async function queryCatalog(source, raw, env, identity, requestSignal, fetcher = fetch) {
  const input = validateQuery(source, raw),
    timeout = AbortSignal.timeout(input.expanded ? 8000 : 3500),
    signal = requestSignal ? AbortSignal.any([timeout, requestSignal]) : timeout;
  const limitedFetch = (url, options = {}) => fetcher(url, { ...options, signal });
  try {
    if (!identity) throw new ApiError(401, 'Entre com uma conta autorizada para pesquisar.');
    const profile = await getDocument(env, `users/${encodeURIComponent(identity.uid)}`, identity.token, limitedFetch);
    const access = permissions(profile, identity.uid, env.OWNER_UID);
    if (!access.add && !access.edit) throw new ApiError(403, 'Sua conta não pode adicionar ou editar jogos.');
    if (!sourceStatus(env).find((s) => s.id === source).enabled) throw new ApiError(503, 'Esta fonte ainda precisa ser autorizada pelo proprietário.');
    const token = source === 'ludopedia' ? env.LUDOPEDIA_TOKEN : source === 'bgg' ? env.BGG_TOKEN : '';
    const io = catalogIO(source, { signal, token, ttl: source === 'wikidata' ? 21600000 : source === 'bgg' ? 3600000 : 300000, interval: source === 'wikidata' ? 0 : 1000, fetcher: limitedFetch });
    const candidates = await connectors[source](input, io);
    return { source, candidates: candidates.map((c) => (source === 'bgg' ? { ...c, attributionLogo: env.BGG_LOGO_URL } : c)), fetchedAt: Date.now() };
  } catch (error) {
    if (timeout.aborted) throw new ApiError(504, 'Esta fonte demorou a responder. Use os demais resultados ou amplie a pesquisa.');
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'Não foi possível consultar esta fonte. Continue com os dados do PDF.');
  }
}
