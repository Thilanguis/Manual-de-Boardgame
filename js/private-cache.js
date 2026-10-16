// A chave é obtida novamente do servidor após validar a conta. Nunca persiste no navegador.
let required = false,
  key = null,
  uid = '',
  generation = 0,
  database;
export function requirePrivateCache() {
  required = true;
}
export const privateCacheRequired = () => required;
export const privateCacheUnlocked = () => !!key;
export async function unlockPrivateCache(userId, bytes) {
  const current = ++generation;
  const imported = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  if (current !== generation) return;
  key = imported;
  uid = userId;
}
export function lockPrivateCache() {
  ++generation;
  key = null;
  uid = '';
}
async function open() {
  return (database ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('acervo-private-v1', 2);
    r.onupgradeneeded = () => {
      const store = r.result.objectStoreNames.contains('entries') ? r.transaction.objectStore('entries') : r.result.createObjectStore('entries');
      if (!store.indexNames.contains('savedAt')) store.createIndex('savedAt', 'savedAt');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
export async function privateValue(name, value) {
  const activeKey = key,
    current = generation,
    owner = uid;
  if (!activeKey) return value === undefined ? null : value;
  const id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${owner}:${name}`))), (b) => b.toString(16).padStart(2, '0')).join('');
  let envelope;
  if (value !== undefined) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    envelope = {
      iv,
      data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) }, activeKey, new TextEncoder().encode(JSON.stringify(value))),
      savedAt: Date.now(),
      family: name.startsWith('translation:') ? 'translation' : 'index',
      pinned: name.startsWith('index:preparation:') || value.analysisComplete === false || (value.pages && value.pages.some((p) => p.text.trim().length < 40 && !p.ocrStatus)),
    };
  }
  if (generation !== current) return null;
  const db = await open();
  if (generation !== current) return null;
  const result = await new Promise((resolve, reject) => {
    const tx = db.transaction('entries', envelope ? 'readwrite' : 'readonly'),
      store = tx.objectStore('entries');
    const r = envelope ? store.put(envelope, id) : store.get(id);
    if (envelope) {
      let kept = 0;
      const cursor = store.index('savedAt').openCursor(null, 'prev');
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        if (entry.value.family === envelope.family && !entry.value.pinned && ++kept > (envelope.family === 'translation' ? 300 : 48)) entry.delete();
        entry.continue();
      };
    }
    tx.oncomplete = () => resolve(envelope || r.result);
    tx.onerror = () => reject(tx.error);
  });
  if (generation !== current) return null;
  if (envelope) return value;
  if (!result) return null;
  try {
    const text = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: result.iv, additionalData: new TextEncoder().encode(id) }, activeKey, result.data);
    return generation === current ? JSON.parse(new TextDecoder().decode(text)) : null;
  } catch {
    return null;
  }
}
export async function purgePrivateCaches({ legacyOnly = false } = {}) {
  if (!legacyOnly) lockPrivateCache();
  const names = ['acervo-private-v1', 'acervo-rule-index-cache-v1', 'acervo-translations-v1', 'acervo-research-v1'];
  await Promise.all(
    names
      .filter((name) => !legacyOnly || name !== 'acervo-private-v1')
      .map(
        (name) =>
          new Promise((resolve) => {
            const request = indexedDB.open(name);
            request.onsuccess = () => {
              const db = request.result,
                stores = [...db.objectStoreNames];
              if (!stores.length) {
                db.close();
                resolve();
                return;
              }
              const tx = db.transaction(stores, 'readwrite');
              stores.forEach((store) => tx.objectStore(store).clear());
              tx.oncomplete = tx.onerror = () => {
                db.close();
                resolve();
              };
            };
            request.onerror = () => resolve();
          }),
      ),
  );
  if (legacyOnly) return;
  for (const name of Object.keys(localStorage)) if (/^acervo[:\-]/.test(name)) localStorage.removeItem(name);
}
