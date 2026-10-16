import { privateCacheRequired, privateValue } from './private-cache.js';
import { researchForReuse, researchName } from './research-knowledge.js';

let database;
function open() {
  return (database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('acervo-research-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
export function createResearchStore(repository, { project = 'local', db, sdk, auth } = {}) {
  const scope = () => `${project}:${repository.session.user?.uid || (project === 'local' ? 'device' : 'signed-out')}`;
  const permitted = () => repository.session.canAdd || repository.session.canEdit;
  const bestMatch = (items) => items.filter(Boolean).sort((a, b) => Number(!!a.needsEditionReview) - Number(!!b.needsEditionReview) || b.fetchedAt - a.fetchedAt)[0];
  async function records() {
    if (privateCacheRequired()) return (await privateValue(`research:${scope()}`)) || [];
    const cache = await open();
    return new Promise((resolve, reject) => {
      const tx = cache.transaction('snapshots'),
        request = tx.objectStore('snapshots').getAll();
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    });
  }
  return {
    async findResearch(input, { signal } = {}) {
      if (!permitted()) return null;
      const currentScope = scope();
      let local;
      try {
        local = bestMatch((await records()).filter((record) => record.scope === currentScope).map((record) => researchForReuse(record.data, input)));
        if (signal?.aborted || currentScope !== scope() || !permitted()) return null;
        if (local && !local.needsEditionReview) return local;
        if (!db || !auth.currentUser) return local || null;
        if (input.gameId) {
          const direct = await sdk.getDocFromServer(sdk.doc(db, 'gameResearch', input.gameId));
          if (signal?.aborted || currentScope !== scope() || !permitted()) return null;
          const original = direct.exists() && JSON.parse(direct.data().content);
          const reusable = original && researchForReuse(original, input);
          if (reusable) {
            // Guardar a projeção apagaria as aprovações do PDF de origem.
            await this.saveResearch(original);
            if (!reusable.needsEditionReview) return reusable;
            local = bestMatch([local, reusable]);
          }
        }
        const result = await sdk.getDocsFromServer(sdk.query(sdk.collection(db, 'gameResearch'), sdk.where('aliases', 'array-contains', researchName(input.query)), sdk.limit(5)));
        if (signal?.aborted || currentScope !== scope() || !permitted()) return null;
        const originals = result.docs.map((doc) => JSON.parse(doc.data().content));
        const found = bestMatch([local, ...originals.map((data) => researchForReuse(data, input))]);
        const original = originals.find((data) => data.manualHash === found?.manualHash && data.fetchedAt === found?.fetchedAt);
        if (original) await this.saveResearch(original);
        return found || null;
      } catch {
        return !signal?.aborted && currentScope === scope() && permitted() ? local || null : null;
      } // Cache é opcional; a pesquisa e o PDF continuam disponíveis.
    },
    async saveResearch(data, game = null) {
      if (!permitted() || !data?.candidates?.length) return;
      const content = JSON.stringify(data);
      if (new TextEncoder().encode(content).length > 120000) throw new Error('Pesquisa grande demais para guardar.');
      const currentScope = scope(),
        cache = privateCacheRequired() ? null : await open();
      if (!cache) {
        const existing = (await privateValue(`research:${currentScope}`)) || [];
        const key = `${researchName(data.query)}:${data.edition}:${data.kind}:${data.preferredLanguage}:${data.manualHash}`;
        if (currentScope !== scope() || !permitted()) return;
        await privateValue(`research:${currentScope}`, [{ key, scope: currentScope, data }, ...existing.filter((r) => r.key !== key)].slice(0, 30));
      } else
        await new Promise((resolve, reject) => {
          const tx = cache.transaction('snapshots', 'readwrite'),
            store = tx.objectStore('snapshots');
          store.put({ key: `${currentScope}:${researchName(data.query)}:${data.edition}:${data.kind}:${data.preferredLanguage}:${data.manualHash || 'unknown-manual'}`, scope: currentScope, data });
          const all = store.getAll();
          all.onsuccess = () =>
            all.result
              .filter((r) => r.scope === currentScope)
              .sort((a, b) => b.data.fetchedAt - a.data.fetchedAt)
              .slice(30)
              .forEach((r) => store.delete(r.key));
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      if (!game?.id || !db || !auth.currentUser || currentScope !== scope()) return;
      const reference = sdk.doc(db, 'gameResearch', game.id);
      await sdk.runTransaction(db, async (tx) => {
        if (currentScope !== scope() || !permitted()) throw new Error('A conta mudou durante o salvamento.');
        const old = await tx.get(reference);
        if (old.exists() && old.data().fetchedAt > data.fetchedAt) return;
        tx.set(reference, { gameId: game.id, schemaVersion: 1, aliases: data.aliases, content, fetchedAt: data.fetchedAt, revision: (old.data()?.revision || 0) + 1, updatedAt: sdk.serverTimestamp(), updatedBy: auth.currentUser.uid });
      });
    },
  };
}
