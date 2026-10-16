import { cleanGuide, parseGuide, publishedAssets, checkGuidePages } from './guide-model.js';
export function createGuideRepository(repository, { db, dbSDK, auth, files }) {
  const ref = (kind, game) => dbSDK.doc(db, kind, game.id);
  const editable = () => {
    if (!repository.session.canEdit || !auth.currentUser) throw new Error('Sua conta precisa da permissão de edição de jogos.');
  };
  const record = (guide, revision) => ({
    gameId: guide.gameId,
    schemaVersion: 1,
    revision,
    content: JSON.stringify(guide.sections),
    sourceHash: guide.sourceHash,
    assets: guide.assets,
    indexFileId: guide.indexFileId,
    reviewed: guide.reviewed,
    updatedAt: dbSDK.serverTimestamp(),
    updatedBy: auth.currentUser.uid,
  });
  return {
    async getGuide(game, draft = false) {
      if (!repository.session.canRead) throw new Error('Entre com uma conta aprovada.');
      if (draft) editable();
      const snapshot = await dbSDK.getDocFromServer(ref(draft ? 'guideDrafts' : 'gameGuides', game));
      return snapshot.exists() ? parseGuide(snapshot.data()) : null;
    },
    async saveGuide(game, input) {
      editable();
      const guide = checkGuidePages(game, cleanGuide(input)),
        reference = ref('guideDrafts', game);
      await dbSDK.runTransaction(db, async (tx) => {
        const old = await tx.get(reference),
          version = old.exists() ? old.data().revision : 0;
        if (version !== guide.revision) throw new Error('Outro editor alterou o rascunho. Reabra o editor para carregar a versão atual.');
        tx.set(reference, record(guide, version + 1));
      });
      return { ...guide, revision: guide.revision + 1 };
    },
    async publishGuide(game, input, expectedRevision) {
      editable();
      const guide = checkGuidePages(game, cleanGuide(input));
      if (!guide.reviewed) throw new Error('Revise e marque todas as seções antes de publicar.');
      if (guide.sourceHash !== game.manual.sha256) throw new Error('Confira as páginas do PDF atual e confirme a revisão das referências.');
      const draft = ref('guideDrafts', game),
        published = ref('gameGuides', game),
        eventId = crypto.randomUUID();
      let revision;
      await dbSDK.runTransaction(db, async (tx) => {
        const [saved, old] = await Promise.all([tx.get(draft), tx.get(published)]);
        if (!saved.exists() || saved.data().revision !== guide.revision || saved.data().content !== JSON.stringify(guide.sections)) throw new Error('Salve o rascunho atual antes de publicar.');
        revision = old.exists() ? old.data().revision + 1 : 1;
        if (revision - 1 !== expectedRevision) throw new Error('A publicação mudou em outra sessão. Reabra o editor.');
        tx.set(published, { ...record({ ...guide, assets: publishedAssets(guide) }, revision), draftRevision: guide.revision, lastEventId: eventId });
        tx.set(dbSDK.doc(db, 'auditEvents', eventId), {
          id: eventId,
          targetType: 'guide',
          targetId: game.id,
          actorUid: auth.currentUser.uid,
          action: 'publishGuide',
          before: { revision: revision - 1 },
          after: { revision },
          version: revision,
          createdAt: dbSDK.serverTimestamp(),
        });
      });
      return { ...guide, revision };
    },
    async uploadGuideAsset(game, blob, name, onProgress) {
      editable();
      const receipt = await files.put(`games/${game.id}/guide-assets/${crypto.randomUUID()}`, blob, onProgress, { kind: 'guideAsset', mimeType: blob.type, name });
      return { ...receipt, mimeType: blob.type };
    },
    finalizeGuideAsset(receipt) {
      return files.finalize(receipt);
    },
    discardGuideAsset(receipt) {
      return files.discard(receipt);
    },
    getGuideAsset(game, id) {
      return files.getGuideAsset(game, id);
    },
  };
}
// Modo local continua independente do Firebase e conserva rascunhos entre visitas.
export async function createLocalGuides(repository) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('acervo-guides-local-v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('drafts');
      request.result.createObjectStore('published');
      request.result.createObjectStore('assets');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const operation = (store, action, key, data) =>
    new Promise((resolve, reject) => {
      const tx = database.transaction(store, action === 'get' ? 'readonly' : 'readwrite'),
        request = action === 'get' ? tx.objectStore(store).get(key) : tx.objectStore(store).put(data, key);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    });
  return {
    getGuide(game, draft = false) {
      return operation(draft ? 'drafts' : 'published', 'get', game.id).then((g) => g || null);
    },
    async saveGuide(game, input) {
      const guide = checkGuidePages(game, cleanGuide(input)),
        old = await operation('drafts', 'get', game.id);
      if ((old?.revision || 0) !== guide.revision) throw new Error('O rascunho mudou em outra aba. Reabra o editor.');
      const next = { ...guide, revision: guide.revision + 1 };
      await operation('drafts', 'put', game.id, next);
      return next;
    },
    async publishGuide(game, input, expected) {
      const guide = checkGuidePages(game, cleanGuide(input)),
        old = await operation('published', 'get', game.id);
      if (!guide.reviewed || guide.sourceHash !== game.manual.sha256) throw new Error('Revise todas as seções e as páginas do PDF atual antes de publicar.');
      if ((old?.revision || 0) !== expected) throw new Error('A publicação mudou em outra aba.');
      const next = { ...guide, assets: publishedAssets(guide), revision: expected + 1 };
      await operation('published', 'put', game.id, next);
      return next;
    },
    async uploadGuideAsset(game, blob) {
      const id = `local-${crypto.randomUUID()}`;
      await operation('assets', 'put', `${game.id}/${id}`, blob);
      return { driveFileId: id, mimeType: blob.type };
    },
    async finalizeGuideAsset() {},
    async discardGuideAsset() {},
    getGuideAsset(game, id) {
      return operation('assets', 'get', `${game.id}/${id}`);
    },
    async deleteGuides(game) {
      await new Promise((resolve, reject) => {
        const tx = database.transaction(['drafts', 'published', 'assets'], 'readwrite');
        tx.objectStore('drafts').delete(game.id);
        tx.objectStore('published').delete(game.id);
        const keys = tx.objectStore('assets').openKeyCursor();
        keys.onsuccess = () => {
          const c = keys.result;
          if (!c) return;
          if (String(c.key).startsWith(`${game.id}/`)) tx.objectStore('assets').delete(c.key);
          c.continue();
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    },
    closeGuides() {
      database.close();
    },
  };
}
