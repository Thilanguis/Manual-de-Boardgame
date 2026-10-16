import { privateCacheRequired, privateValue } from './private-cache.js';
// Tradução de texto completo no dispositivo. Sem endpoint remoto ou fallback de rede.
export const isPortuguese = (language) => /^pt(?:-|$)/i.test(language || '');
export const baseLanguage = (language) =>
  String(language || '')
    .toLowerCase()
    .split('-')[0];
export function translatedValue(record, original) {
  return record?.targetLanguage === 'pt-BR' && record.sourceText === original && typeof record.text === 'string' ? record.text : '';
}
export function translationChunks(text, limit = 1600) {
  const chunks = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(start + limit, text.length);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf('\n', end - 1), text.lastIndexOf('. ', end - 1), text.lastIndexOf(' ', end - 1));
      if (boundary > start + limit / 2) end = boundary + 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}
let database;
async function translationCache(key, value) {
  if (privateCacheRequired()) return privateValue(`translation:${key}`, value);
  try {
    database ||= new Promise((resolve, reject) => {
      const r = indexedDB.open('acervo-translations-v1', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('texts', { keyPath: 'key' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const db = await database;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('texts', value ? 'readwrite' : 'readonly'),
        store = tx.objectStore('texts');
      const request = value ? store.put({ key, value, savedAt: Date.now() }) : store.get(key);
      if (value) {
        const all = store.getAll();
        all.onsuccess = () =>
          all.result
            .sort((a, b) => b.savedAt - a.savedAt)
            .slice(300)
            .forEach((r) => store.delete(r.key));
      }
      tx.oncomplete = () => resolve(value || request.result?.value || null);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return value || null;
  }
}
export function createTextTranslator({ provider = globalThis.Translator, cache = translationCache, scope = 'local' } = {}) {
  const sessions = new Map();
  async function availability(language) {
    if (isPortuguese(language)) return 'available';
    if (!provider || !language || ['unknown', 'other'].includes(language)) return 'unavailable';
    try {
      return await provider.availability({ sourceLanguage: baseLanguage(language), targetLanguage: 'pt' });
    } catch {
      return 'unavailable';
    }
  }
  // Chamar diretamente no clique antes de outros awaits permite baixar o pacote local.
  function prepare(language, { allowDownload = false, signal, onProgress = () => {} } = {}) {
    if (isPortuguese(language)) return Promise.resolve(null);
    const sourceLanguage = baseLanguage(language);
    if (!provider || !sourceLanguage || ['unknown', 'other'].includes(sourceLanguage)) return Promise.reject(new Error('Tradução local indisponível neste navegador ou idioma. Use a edição manual em português.'));
    if (sessions.has(sourceLanguage)) return sessions.get(sourceLanguage);
    const create = () => provider.create({ sourceLanguage, targetLanguage: 'pt', signal, monitor: (monitor) => monitor.addEventListener('downloadprogress', (event) => onProgress(`Preparando tradução local: ${Math.round(event.loaded * 100)}%.`)) });
    const promise = (
      allowDownload
        ? Promise.resolve(create())
        : availability(language).then((state) => {
            if (state !== 'available') throw new Error('Clique em Traduzir para preparar o idioma neste dispositivo.');
            return create();
          })
    ).catch((error) => {
      sessions.delete(sourceLanguage);
      if (error.name === 'AbortError' || /Clique em Traduzir/.test(error.message)) throw error;
      throw new Error('Não foi possível preparar a tradução local. Tente em um navegador compatível ou escreva a versão em português.');
    });
    sessions.set(sourceLanguage, promise);
    return promise;
  }
  async function translate(text, { sourceLanguage, signal, onProgress = () => {} } = {}) {
    text = String(text || '');
    signal?.throwIfAborted();
    if (!text.trim() || isPortuguese(sourceLanguage)) return { sourceText: text, text, sourceLanguage, targetLanguage: 'pt-BR', method: 'original', createdAt: Date.now() };
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, '0')).join('');
    const key = `${scope}:${sourceLanguage}:pt-BR:native-v1:${digest}`;
    const old = await cache(key);
    signal?.throwIfAborted();
    if (translatedValue(old, text)) return old;
    const session = await prepare(sourceLanguage, { signal, onProgress });
    const chunks = translationChunks(text),
      parts = [];
    for (const [i, chunk] of chunks.entries()) {
      signal?.throwIfAborted();
      const result = await session.translate(chunk, { signal });
      signal?.throwIfAborted();
      if (!String(result).trim()) throw new Error('A tradução ficou vazia. O original foi preservado.');
      parts.push(String(result));
      onProgress(`Traduzindo trecho ${i + 1} de ${chunks.length}…`);
    }
    const record = { sourceText: text, text: parts.join('\n'), sourceLanguage, targetLanguage: 'pt-BR', actualTargetLanguage: session.targetLanguage || 'pt', method: 'browser-local', reviewed: false, createdAt: Date.now() };
    await cache(key, record);
    return record;
  }
  function destroy() {
    for (const session of sessions.values()) void session.then((s) => s?.destroy()).catch(() => {});
    sessions.clear();
  }
  return { availability, prepare, translate, destroy };
}
export async function translateIndex(index, translator, { signal, checkpoint = async () => {}, onProgress = () => {} } = {}) {
  const pending = index.pages.filter((p) => p.text.trim() && !isPortuguese(index.language) && !translatedValue(p.translation, p.text));
  for (const [i, page] of pending.entries()) {
    signal?.throwIfAborted();
    page.translation = await translator.translate(page.text, { sourceLanguage: index.language, signal });
    index.revision = (index.revision || 0) + 1;
    await checkpoint(index);
    onProgress({ message: `Tradução: ${i + 1} de ${pending.length} páginas.`, current: i + 1, total: pending.length });
  }
  for (const h of index.headings) {
    signal?.throwIfAborted();
    if (!isPortuguese(index.language) && !translatedValue(h.translation, h.title)) {
      h.translation = await translator.translate(h.title, { sourceLanguage: index.language, signal });
      await checkpoint(index);
    }
  }
  return index;
}
