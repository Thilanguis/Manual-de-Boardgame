import { privateCacheRequired, privateValue } from './private-cache.js';
let database;
export const indexCacheKey = (scope, uid, game) => `${scope}:${uid || 'visitor'}:${game.id}${game.documentId && game.documentId !== 'main' ? ':' + game.documentId : ''}:${game.manual.sha256}`;
async function db() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const r = indexedDB.open('acervo-rule-index-cache-v1', 2);
      r.onupgradeneeded = () => {
        const store = r.result.objectStoreNames.contains('indexes') ? r.transaction.objectStore('indexes') : r.result.createObjectStore('indexes');
        if (!store.indexNames.contains('savedAt')) store.createIndex('savedAt', 'savedAt');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  return database;
}
export async function cachedIndex(key, value) {
  if (privateCacheRequired()) return privateValue(`index:${key}`, value);
  try {
    const database = await db();
    return await new Promise((resolve, reject) => {
      const tx = database.transaction('indexes', value ? 'readwrite' : 'readonly'),
        store = tx.objectStore('indexes'),
        r = value ? store.put({ data: value, savedAt: Date.now() }, key) : store.get(key);
      if (value) {
        let kept = 0;
        const cursor = store.index('savedAt').openCursor(null, 'prev');
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          if (++kept > 48) c.delete();
          c.continue();
        };
      }
      tx.oncomplete = () => resolve(value || r.result?.data || null);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return value || null;
  }
}
