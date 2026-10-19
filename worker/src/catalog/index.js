import { ApiError, permissions } from '../auth.js';
import { getDocument } from '../services.js';
import { catalogIO } from './io.js';
import { wikidata } from './wikidata.js';
import { ludopedia } from './ludopedia.js';
import { bgg } from './bgg.js';
import { RESEARCH_PROTOCOL, RESEARCH_VERSION, RESEARCH_QUERY_VERSION } from '../../../js/research-contract.js';
import { wikipedia } from './wikipedia.js';
export const researchCapabilities = (env) => ({ protocol: RESEARCH_PROTOCOL, apiVersion: RESEARCH_VERSION, queryStrategyVersion: RESEARCH_QUERY_VERSION, sources: sourceStatus(env) });

export const validBggLogo = (env) => /^https:\/\/thilanguis\.github\.io\/Manual-de-Boardgame\/assets\/powered-by-bgg\.(?:png|svg|webp)$/.test(env.BGG_LOGO_URL || '');
export const sourceStatus = (env) => [
  {
    id: 'ludopedia',
    name: 'Ludopedia',
    language: 'pt-BR',
    enabled: !!env.LUDOPEDIA_TOKEN,
    state: env.LUDOPEDIA_TOKEN ? 'configured' : 'requires_credentials',
    reason: env.LUDOPEDIA_TOKEN ? 'API autorizada · atribuição obrigatória' : 'Aplicação autorizada e token ainda necessários',
    url: 'https://ludopedia.com.br',
    policy: 'https://ludopedia.com.br/aplicativo',
  },
  {
    id: 'wikidata',
    name: 'Wikidata',
    language: 'multilingual',
    enabled: true,
    state: 'configured',
    reason: 'API automática · dados CC0 · cobertura variável',
    url: 'https://www.wikidata.org',
    policy: 'https://www.wikidata.org/wiki/Wikidata:Data_access',
  },
  {
    id: 'wikipedia',
    name: 'Wikipédia',
    language: 'multilingual',
    enabled: true,
    state: 'configured',
    reason: 'API automática · textos CC BY-SA · somente artigos de jogos identificados',
    url: 'https://pt.wikipedia.org',
    policy: 'https://en.wikipedia.org/wiki/Wikipedia:Copyrights',
  },
  {
    id: 'bgg',
    name: 'BoardGameGeek',
    language: 'en',
    enabled: !!env.BGG_TOKEN && validBggLogo(env),
    state: env.BGG_TOKEN && validBggLogo(env) ? 'configured' : 'requires_credentials',
    reason: env.BGG_TOKEN && validBggLogo(env) ? 'API autorizada · atribuição obrigatória' : 'Aplicação aprovada, token e logo oficial ainda necessários',
    ...(validBggLogo(env) ? { logo: env.BGG_LOGO_URL } : {}),
    url: 'https://boardgamegeek.com',
    policy: 'https://boardgamegeek.com/using_the_xml_api',
  },
];
const connectors = { wikidata, wikipedia, ludopedia, bgg };
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
  if (raw.action === 'detail' && !(source === 'wikidata' || source === 'wikipedia' ? /^Q[1-9]\d{0,10}$/ : /^[1-9]\d{0,8}$/).test(String(raw.id))) throw new ApiError(400, 'Identificador inválido.');
  if (raw.kind && !['base', 'expansion', 'unknown'].includes(raw.kind)) throw new ApiError(400, 'Tipo de produto inválido.');
  return {
    action: raw.action,
    query,
    id: String(raw.id || ''),
    preferredLanguage: raw.preferredLanguage || 'pt-BR',
    pdfLanguage: ['pt-BR', 'en', 'fr'].includes(raw.pdfLanguage) ? raw.pdfLanguage : 'other',
    kind: raw.kind || 'unknown',
    edition: typeof raw.edition === 'string' ? raw.edition.trim().slice(0, 100) : '',
    publisher: typeof raw.publisher === 'string' ? raw.publisher.trim().slice(0, 100) : '',
    year: /^(19|20)\d{2}$/.test(String(raw.year || '')) ? String(raw.year) : '',
    expanded: raw.expanded === true,
    alternateTitles: Array.isArray(raw.alternateTitles)
      ? raw.alternateTitles
          .filter((n) => n && typeof n.value === 'string' && n.value.length >= 2 && n.value.length <= 160)
          .slice(0, 6)
          .map((n) => ({ value: n.value, language: ['pt-BR', 'en', 'fr'].includes(n.language) ? n.language : 'other', ...(n.origin === 'gemini-hint' ? { origin: 'gemini-hint' } : {}) }))
      : [],
    // Formulário interativo; tarefas internas adotam maxlag e prazo próprios.
    interactive: true,
  };
}
export async function queryCatalog(source, raw, env, identity, requestSignal, fetcher = fetch, { background = false, alreadyAuthorized = false } = {}) {
  const input = validateQuery(source, raw),
    timeout = AbortSignal.timeout(input.expanded ? 8000 : 3500),
    signal = requestSignal ? AbortSignal.any([timeout, requestSignal]) : timeout;
  const limitedFetch = (url, options = {}) => fetcher(url, { ...options, signal });
  input.interactive = !background;
  try {
    if (!identity) throw new ApiError(401, 'Entre com uma conta autorizada para pesquisar.');
    // Só chamadas internas da mesma requisição podem aproveitar o perfil já
    // conferido pelo roteador. A opção não é lida do JSON recebido do cliente.
    const profile = alreadyAuthorized && identity.profile ? identity.profile : await getDocument(env, `users/${encodeURIComponent(identity.uid)}`, identity.token, limitedFetch);
    const access = permissions(profile, identity.uid, env.OWNER_UID);
    if (!access.add && !access.edit) throw new ApiError(403, 'Sua conta não pode adicionar ou editar jogos.');
    if (!sourceStatus(env).find((s) => s.id === source).enabled) throw new ApiError(503, 'Esta fonte ainda precisa ser autorizada pelo proprietário.');
    const token = source === 'ludopedia' ? env.LUDOPEDIA_TOKEN : source === 'bgg' ? env.BGG_TOKEN : '';
    const io = catalogIO(source, {
      signal,
      token,
      ttl: ['wikidata', 'wikipedia'].includes(source) ? 21600000 : source === 'bgg' ? 3600000 : 300000,
      interval: ['wikidata', 'wikipedia'].includes(source) ? 0 : 1000,
      waitForInterval: input.action === 'detail',
      fetcher: limitedFetch,
    });
    const candidates = await connectors[source](input, io);
    return {
      source,
      protocol: RESEARCH_PROTOCOL,
      apiVersion: RESEARCH_VERSION,
      candidates: candidates.map((c) => (source === 'bgg' ? { ...c, attributionLogo: env.BGG_LOGO_URL } : c)),
      diagnostics: input.diagnostics || { complete: true, queries: [{ query: input.query }], returned: candidates.length },
      fetchedAt: Date.now(),
    };
  } catch (error) {
    if (timeout.aborted) throw new ApiError(504, 'Esta fonte demorou a responder. Use os demais resultados ou amplie a pesquisa.');
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'Não foi possível consultar esta fonte. Continue com os dados do PDF.');
  }
}
