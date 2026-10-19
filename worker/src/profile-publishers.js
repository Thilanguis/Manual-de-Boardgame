import { normalizeText } from '../../js/model.js';

// Registro de adaptadores públicos, não um crawler de URLs sugeridas pela IA.
// /product/ é permitido pelo robots.txt Gamewright. Guarda somente fatos da
// ficha; descrições, imagens e PDFs da editora não são copiados.
const cache = new Map(),
  flights = new Map();
let pauseUntil = 0;
export function resetPublisherCache() {
  cache.clear();
  flights.clear();
  pauseUntil = 0;
}
const plain = (html) =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:trade|reg);/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function gamewrightFacts(html, names) {
  const main = html.split(/class=["']product_description\b/i)[1]?.split(/More Like This/i)[0] || '';
  const title = plain(main.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '');
  if (!title || !names.some((name) => normalizeText(name) === normalizeText(title))) return null;
  const details = main.match(/<ul\b[^>]*class=["']details["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1] || '';
  const rows = [...details.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => ({ html: m[1], text: plain(m[1]) }));
  const fields = { title },
    evidence = { title };
  for (const row of rows) {
    let match;
    if (/fa-clock/.test(row.html) && (match = /^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\s*min$/i.exec(row.text))) {
      const min = Number(match[1]),
        max = Number(match[2] || match[1]);
      if (min > 0 && max >= min && max <= 1440) {
        fields.minDurationMinutes = min;
        fields.maxDurationMinutes = max;
        evidence.minDurationMinutes = evidence.maxDurationMinutes = row.text;
      }
    } else if (/fa-user\b/.test(row.html) && (match = /^(\d{1,2})\s*[-–]\s*(\d{1,2})$/.exec(row.text))) {
      const min = Number(match[1]),
        max = Number(match[2]);
      if (min > 0 && max >= min) {
        fields.minPlayers = min;
        fields.maxPlayers = max;
        evidence.minPlayers = evidence.maxPlayers = row.text;
      }
    } else if (/fa-(?:male|female)\b/.test(row.html) && (match = /^(\d{1,2})\s*\+$/.exec(row.text))) {
      if (Number(match[1]) > 0) {
        fields.recommendedAge = Number(match[1]);
        evidence.recommendedAge = row.text;
      }
    }
  }
  return Object.keys(fields).length > 1 ? { fields, evidence } : null;
}

async function product(url, names, fetcher) {
  const hit = cache.get(url);
  if (hit?.until > Date.now()) return structuredClone(hit.value);
  if (pauseUntil > Date.now()) throw new Error('publisher-cooldown');
  let flight = flights.get(url);
  if (!flight) {
    flight = (async () => {
      const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(3500), headers: { Accept: 'text/html', 'User-Agent': 'Acervo/1.11 (https://github.com/Thilanguis/Manual-de-Boardgame)' } });
      if ([429, 503].includes(response.status)) {
        const header = response.headers.get('Retry-After');
        const seconds = Number(header);
        const wait = header && Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(header) - Date.now()) || 60000;
        pauseUntil = Date.now() + Math.max(1000, wait);
        throw new Error('publisher-cooldown');
      }
      if (response.status === 404) {
        if (cache.size >= 50) cache.delete(cache.keys().next().value);
        cache.set(url, { value: null, until: Date.now() + 300000 });
        return null;
      }
      if (!response.ok || response.status >= 300 || !response.headers.get('Content-Type')?.includes('text/html')) throw new Error('publisher-unavailable');
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let html = '',
        size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 150000) throw new Error('publisher-size');
          html += decoder.decode(value, { stream: true });
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const parsed = gamewrightFacts(html + decoder.decode(), names);
      const result = parsed ? { ...parsed, fetchedAt: Date.now() } : null;
      // O HTML é descartado. Cache por URL, com identidade revalidada no retorno.
      const control = response.headers.get('Cache-Control') || '';
      const age = /(?:^|,)\s*max-age=(\d+)/i.exec(control);
      const lifetime = /no-store|private|no-cache/i.test(control) ? 0 : Math.min(21600000, age ? Number(age[1]) * 1000 : 21600000);
      if (lifetime > 0) {
        if (cache.size >= 50) cache.delete(cache.keys().next().value);
        cache.set(url, { value: result, until: Date.now() + lifetime });
      }
      return result;
    })();
    flights.set(url, flight);
    flight
      .finally(() => {
        if (flights.get(url) === flight) flights.delete(url);
      })
      .catch(() => {});
  }
  return structuredClone(await flight);
}

export async function collectPublisherFacts(game, manual, publicSources, fetcher = fetch) {
  const trusted = manual.sources.filter((s) => s.pages && s.profileEligible !== false);
  if (!trusted.some((s) => s.pages.some((p) => /\b(?:www\.)?gamewright\.com(?=[/\s"'<>)]|[.,;:](?:\s|$)|$)/i.test(p.text)))) return { sources: [], diagnostics: [] };
  const manualNames = (game.research?.alternateTitles || []).filter((n) => typeof n?.value === 'string' && trusted.some((s) => s.pages.some((p) => normalizeText(p.text).includes(normalizeText(n.value))))).map((n) => n.value);
  const names = [...new Set([game.title, ...publicSources.flatMap((s) => s.originalTitles?.map((n) => n.value) || []), ...manualNames])].filter((n) => typeof n === 'string' && n.length <= 160);
  const slugs = [
    ...new Set(
      names.map((n) =>
        n
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-zA-Z0-9 ]/g, '')
          .trim()
          .split(/\s+/)
          .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
          .join('-'),
      ),
    ),
  ]
    .filter(Boolean)
    .slice(0, 2);
  for (const slug of slugs) {
    const url = 'https://gamewright.com/product/' + slug;
    try {
      const result = await product(url, names, fetcher);
      if (!result || !names.some((n) => normalizeText(n) === normalizeText(result.fields.title))) continue;
      const source = {
        id: 'publisher-gamewright-' + slug.toLowerCase(),
        name: 'Gamewright · editora',
        catalogSource: 'publisher',
        catalogId: slug,
        profileOnly: true,
        profileEligible: true,
        // Uma ficha atual da obra não prova a edição do PDF.
        profileSpecificEligible: !game.edition,
        editionConfirmed: false,
        scope: 'work-metadata',
        edition: '',
        language: 'en',
        url,
        license: 'Editora · somente fatos da ficha pública, com atribuição',
        independenceKey: 'publisher:gamewright.com',
        fetchedAt: result.fetchedAt,
        facts: result.fields,
        fieldEvidence: Object.fromEntries(Object.entries(result.evidence).map(([key, excerpt]) => [key, { excerpt, url }])),
        originalTitles: [{ value: result.fields.title, language: 'en' }],
        identifiers: {},
        kind: 'unknown',
      };
      return { sources: [source], diagnostics: [{ source: 'publisher', state: 'ok', count: 1 }] };
    } catch {
      return { sources: [], diagnostics: [{ source: 'publisher', state: 'failed', count: 0 }] };
    }
  }
  return { sources: [], diagnostics: [{ source: 'publisher', state: 'ok', count: 0 }] };
}
