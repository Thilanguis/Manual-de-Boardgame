import { ApiError } from '../auth.js';

const cache = new Map(),
  cooldown = new Map(),
  flights = new Map();
let cacheBytes = 0;
function evict(key) {
  cacheBytes -= cache.get(key)?.bytes || 0;
  cache.delete(key);
}
export function resetCatalogCache() {
  cache.clear();
  cacheBytes = 0;
  cooldown.clear();
  flights.clear();
}
async function withSignal(task, signal) {
  if (!signal) return task;
  let abort;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        abort = () => reject(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}
export function catalogIO(source, { signal, token = '', ttl = 300000, interval = 500, fetcher = fetch } = {}) {
  const scope = `${source}:${token}`; // Chave privada em memória; nunca enviada ou registrada.
  return async (url, { xml = false } = {}) => {
    signal?.throwIfAborted();
    for (const [key, entry] of cache) if (entry.until <= Date.now()) evict(key);
    const key = `${scope}:${url}`,
      hit = cache.get(key);
    if (hit?.until > Date.now()) return hit.value;
    if (flights.has(key)) return withSignal(flights.get(key), signal);
    if ((cooldown.get(scope) || 0) > Date.now()) throw new ApiError(429, 'Esta fonte está limitando consultas. Continue com as outras e tente depois.');
    cooldown.set(scope, Date.now() + interval);
    const task = (async () => {
      const response = await fetcher(url, {
        headers: { Accept: xml ? 'application/xml' : 'application/json', 'User-Agent': 'ManualDeBoardgames/1.4 (https://github.com/Thilanguis/Manual-de-Boardgame)', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal,
        redirect: 'manual',
      });
      signal?.throwIfAborted();
      if ([202, 429, 503].includes(response.status)) {
        const header = response.headers.get('Retry-After'),
          seconds = Number(header);
        const wait = header && Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(header) - Date.now()) || 60000;
        cooldown.set(scope, Date.now() + Math.min(3600000, Math.max(1000, wait)));
        throw new ApiError(429, 'A fonte pediu uma pausa. As demais consultas continuam disponíveis.');
      }
      if ([401, 403].includes(response.status)) throw new ApiError(503, 'O administrador precisa revisar a autorização desta fonte.');
      if (!response.ok) throw new ApiError(502, 'A fonte não respondeu agora.');
      const reader = response.body.getReader();
      let size = 0;
      const parts = [];
      try {
        while (true) {
          signal?.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > (xml ? 150000 : 900000)) throw new ApiError(502, 'Resposta da fonte maior que o limite.');
          parts.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      const text = new TextDecoder().decode(bytes);
      if (xml && /<!DOCTYPE|<!ENTITY/i.test(text)) throw new ApiError(502, 'XML da fonte não suportado.');
      const value = xml ? text : JSON.parse(text);
      if (value.error) {
        if (value.error.code === 'maxlag') cooldown.set(scope, Date.now() + 60000);
        throw new ApiError(503, 'A fonte está indisponível; nenhum dado foi presumido.');
      }
      const control = response.headers.get('Cache-Control') || '',
        age = /(?:^|,)\s*max-age=(\d+)/i.exec(control);
      const lifetime = /no-store|no-cache|private/i.test(control) ? 0 : Math.min(ttl, age ? Number(age[1]) * 1000 : ttl);
      if (lifetime > 0) {
        if (cache.has(key)) evict(key);
        while (cache.size && (cache.size >= 100 || cacheBytes + size > 6 * 1024 * 1024)) evict(cache.keys().next().value);
        cache.set(key, { value, bytes: size, until: Date.now() + lifetime });
        cacheBytes += size;
      }
      return value;
    })();
    flights.set(key, task);
    try {
      return await withSignal(task, signal);
    } finally {
      if (flights.get(key) === task) flights.delete(key);
    }
  };
}

export const text = (value, max = 160) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
export const positive = (value, max = 1440) => (Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= max ? Number(value) : null);
export function facts(source, id, url, fields, extra = {}) {
  const values = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null && value !== '' && value !== undefined && (!Array.isArray(value) || value.length)));
  return { source, id: String(id), url, fields: values, names: [], kind: 'unknown', edition: '', conflicts: [], ...extra };
}
