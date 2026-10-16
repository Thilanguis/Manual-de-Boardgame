import { MAX_PDF_READ_BYTES } from './pdf-limits.js';
import { isPortuguese, translatedValue } from './translation.js';
import { gameDocuments, findDocument, documentKind, documentGame, withDocument, withoutDocument, primaryDocumentId } from './documents.js';
import { packIndex, unpackIndex, indexMatches } from './pdf-index.js';
import { cachedIndex, indexCacheKey } from './index-cache.js';
let localDB;
async function localValue(key, value) {
  localDB ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('acervo-documents-local-v1', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const db = await localDB;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', value === undefined ? 'readonly' : 'readwrite'),
      store = tx.objectStore('files');
    const r = value === undefined ? store.get(key) : value === null ? store.delete(key) : store.put(value, key);
    tx.oncomplete = () => resolve(value === undefined ? r.result : value);
    tx.onerror = () => reject(tx.error);
  });
}
export function createDocumentRepository(repository, { files, db, sdk, auth, project = 'local' } = {}) {
  const preparationListeners = new Map();
  const announce = (game, document, state, index) => {
    for (const callback of preparationListeners.get(game.id) || []) callback([{ documentId: document.id, sourceHash: document.manual.sha256, state, readablePages: index.pages.filter((p) => p.text.trim().length >= 40).length }]);
  };
  const originalManual = repository.getManual.bind(repository),
    originalSource = repository.getManualSource?.bind(repository);
  const scope = () => `${project}:${repository.session.user?.uid || 'device'}`;
  const key = (game, doc) => `${game.id}:${doc.id}:${doc.manual.sha256}`;
  function requireRead() {
    if (!repository.session.canRead) throw new Error('Entre com uma conta aprovada.');
  }
  function requireEdit() {
    requireRead();
    if (!repository.session.canEdit) throw new Error('Sua conta não pode alterar documentos.');
  }
  function canPrepare(game) {
    return (
      repository.session.canRead &&
      (repository.mode !== 'firebase' || (repository.session.cacheReady === true && repository.session.storageStatus?.fileProtocol >= 2)) &&
      (repository.session.canEdit || (repository.session.canAdd && game.createdBy === repository.session.user?.uid))
    );
  }
  async function current(game) {
    if (!db) return game;
    const snapshot = await sdk.getDocFromServer(sdk.doc(db, 'games', game.id));
    if (!snapshot.exists()) throw new Error('Jogo não encontrado.');
    const record = snapshot.data();
    return { ...record, updatedAt: record.updatedAt?.toMillis?.() || 0, createdAt: record.createdAt?.toMillis?.() || 0 };
  }
  return {
    canPrepare,
    watchPreparation(game, callback, onError = () => {}) {
      requireRead();
      if (db)
        return sdk.onSnapshot(
          sdk.collection(db, 'games', game.id, 'indexes'),
          (snapshot) => {
            if (repository.session.canRead && !snapshot.metadata.fromCache) callback(snapshot.docs.map((doc) => doc.data()));
          },
          onError,
        );
      const listeners = preparationListeners.get(game.id) || new Set();
      listeners.add(callback);
      preparationListeners.set(game.id, listeners);
      return () => listeners.delete(callback);
    },
    getDocuments: gameDocuments,
    async latestGame(game) {
      requireRead();
      return current(game);
    },
    async getDocumentManual(game, document, options) {
      requireRead();
      const doc = findDocument(game, document?.id);
      if (!doc || doc.manual.sha256 !== document.manual.sha256) throw new Error('O documento mudou. Reabra o jogo.');
      if (files)
        return files.get(documentGame(game, doc), documentKind(doc) === 'manual' && doc.id === primaryDocumentId(game) && !(repository.session.storageStatus?.fileProtocol >= 2) ? 'manual' : `documents/${doc.id}/pdf`, MAX_PDF_READ_BYTES, options);
      if (documentKind(doc) === 'manual') return originalManual(game, options);
      const blob = await localValue(`pdf:${key(game, doc)}`);
      if (!blob) throw new Error('Documento indisponível.');
      return blob;
    },
    getManual(game, options = {}) {
      const doc = findDocument(game, options.documentId || game.documentId);
      return this.getDocumentManual(game, doc, options);
    },
    async getManualSource(game, options = {}) {
      requireRead();
      const doc = findDocument(game, options.documentId || game.documentId);
      if (!doc) throw new Error('Documento não encontrado.');
      return files ? files.readerSource({ ...documentGame(game, doc), legacyManual: documentKind(doc) === 'manual' && doc.id === primaryDocumentId(game) }) : originalSource ? originalSource(documentGame(game, doc)) : null;
    },
    async saveDocument(game, metadata, blob, onProgress = () => {}) {
      requireEdit();
      game = await current(game);
      if (!game.documents) game = (await repository.saveGame(withDocument(game, findDocument(game)))).game;
      const id = metadata.id || crypto.randomUUID(),
        previous = findDocument(game, id);
      const { expectedSourceHash, ...fields } = metadata;
      if (previous && expectedSourceHash && previous.manual.sha256 !== expectedSourceHash) throw new Error('Este PDF mudou em outra sessão. Reabra o documento antes de substituir.');
      if (previous && !blob && previous.manual.sha256 !== metadata.manual.sha256) throw new Error('Este documento foi atualizado. Reabra as informações antes de salvar.');
      const document = { ...fields, id };
      let receipt;
      try {
        if (blob) {
          document.manual = { ...document.manual, path: `games/${game.id}/documents/${id}.pdf` };
          if (files) {
            receipt = await files.put(document.manual.path, blob, onProgress, { kind: 'document', mimeType: 'application/pdf', name: document.manual.name, documentId: id, fingerprint: document.manual.sha256 });
            document.manual = { ...document.manual, driveFileId: receipt.driveFileId, storage: 'drive' };
          } else await localValue(`pdf:${key(game, document)}`, blob);
        } else if (!previous) throw new Error('Selecione um PDF.');
        const next = withDocument(game, document);
        const result = await repository.saveGame(next);
        if (receipt)
          await files.finalize(receipt).catch(() => {
            repository.fileWarning = 'Documento salvo. A limpeza do arquivo anterior está pendente; tente novamente antes de sair.';
          });
        return result.game;
      } catch (error) {
        if (receipt) await files.discard(receipt).catch(() => {});
        throw error;
      }
    },
    async setPrimaryDocument(game, id) {
      requireEdit();
      game = await current(game);
      const doc = findDocument(game, id);
      if (!doc) throw new Error('Documento não encontrado.');
      return (await repository.saveGame(withDocument(game, doc, { primary: true }))).game;
    },
    async removeDocument(game, id) {
      if (!repository.session.canDelete) throw new Error('Somente o proprietário pode excluir documentos.');
      game = await current(game);
      const doc = findDocument(game, id),
        next = withoutDocument(game, id);
      if (files) {
        if (!((await files.capabilities()).documentRemovalProtocol >= 2)) throw new Error('A conexão dos documentos precisa ser atualizada antes de remover PDFs. Nenhum arquivo foi excluído.');
        await files.deleteDocument(game, id);
        return current(game);
      } else {
        // Falha no cadastro não pode apagar o PDF local.
        const result = await repository.saveGame(next);
        await localValue(`pdf:${key(game, doc)}`, null);
        await localValue(`index:${key(game, doc)}`, null);
        return result.game;
      }
    },
    async pendingDocumentRemovals(game) {
      if (!repository.session.canDelete || !db) return [];
      const snapshot = await sdk.getDocs(sdk.collection(db, 'games', game.id, 'removals'));
      return snapshot.docs.map((doc) => doc.data());
    },
    async retryDocumentRemovals(game) {
      if (!repository.session.canDelete) throw new Error('Somente o proprietário pode concluir remoções.');
      for (const record of await this.pendingDocumentRemovals(game)) await files.deleteDocument(game, record.documentId);
      return current(game);
    },
    async getTechnicalIndex(game, document) {
      requireRead();
      const view = documentGame(game, document),
        cacheKey = indexCacheKey(project, repository.session.user?.uid, view);
      if (!db) return (await localValue(`index:${key(game, document)}`)) || (await cachedIndex(cacheKey));
      const snapshot = await sdk.getDocFromServer(sdk.doc(db, 'games', game.id, 'indexes', document.id));
      if (!snapshot.exists() || snapshot.data().sourceHash !== document.manual.sha256 || !snapshot.data().fileId) {
        if (document.id === 'main' && repository.getGuide) {
          const guides = repository.session.canEdit ? [await repository.getGuide(game, true), await repository.getGuide(game)] : [await repository.getGuide(game)];
          const legacy = guides.find((guide) => guide?.sourceHash === document.manual.sha256 && guide.indexFileId);
          if (legacy) {
            const index = await unpackIndex(await repository.getGuideAsset(game, legacy.indexFileId), view);
            index.legacyShared = true;
            return index;
          }
        }
        return null;
      }
      const record = snapshot.data();
      const cached = await cachedIndex(cacheKey);
      if (indexMatches(cached, view) && cached.sharedRevision === record.revision && cached.sharedFileId === record.fileId) return cached;
      const index = await unpackIndex(await files.get(view, `documents/${document.id}/index`, 8388608), view);
      index.sharedRevision = record.revision;
      index.sharedFileId = record.fileId;
      index.unsavedChanges = false;
      await cachedIndex(cacheKey, index);
      requireRead();
      return index;
    },
    async saveTechnicalIndex(game, document, index, { state = 'ready', signal } = {}) {
      if (!canPrepare(game)) throw new Error('Sua conta não pode preparar este documento.');
      const view = documentGame(game, document);
      if (!indexMatches(index, view)) throw new Error('O índice não corresponde a este PDF.');
      if (state === 'ready' && (index.analysisComplete === false || index.pages.some((p) => p.text.trim().length < 40 || (!isPortuguese(index.language) && p.text.trim() && !translatedValue(p.translation, p.text))))) state = 'partial';
      if (!db) {
        index.sharedRevision = (index.sharedRevision || 0) + 1;
        index.sharedFileId = `local-document-index:${key(game, document)}`;
        index.unsavedChanges = false;
        await localValue(`index:${key(game, document)}`, index);
        announce(game, document, state, index);
        return index;
      }
      const reference = sdk.doc(db, 'games', game.id, 'indexes', document.id);
      const previous = await sdk.getDocFromServer(reference);
      const expectedRevision = previous.data()?.revision || 0;
      const readablePages = index.pages.filter((p) => p.text.trim().length >= 40).length,
        translatedPages = index.pages.filter((p) => p.translation?.sourceText === p.text && p.translation?.text).length;
      if (previous.data()?.sourceHash === index.sourceHash && ((previous.data().readablePages || 0) > readablePages || (previous.data().translatedPages || 0) > translatedPages))
        throw new Error('Uma análise mais completa já foi salva. Reabra a consulta para carregá-la.');
      const receipt = await files.put(`games/${game.id}/indexes/${document.id}.gz`, await packIndex(index), () => {}, {
        kind: 'documentIndex',
        mimeType: 'application/gzip',
        documentId: document.id,
        sourceHash: document.manual.sha256,
        name: `${document.name} — índice.gz`,
        signal,
      });
      try {
        const ref = sdk.doc(db, 'games', game.id, 'indexes', document.id);
        await sdk.runTransaction(db, async (tx) => {
          const latest = await tx.get(sdk.doc(db, 'games', game.id)),
            old = await tx.get(ref);
          if ((old.data()?.revision || 0) !== expectedRevision) throw new Error('A análise mudou em outra sessão. Reabra a consulta antes de salvar.');
          if (!latest.exists() || findDocument(latest.data(), document.id)?.manual.sha256 !== document.manual.sha256) throw new Error('O PDF mudou durante a preparação.');
          tx.set(ref, {
            documentId: document.id,
            sourceHash: index.sourceHash,
            fileId: receipt.driveFileId,
            state,
            readablePages,
            translatedPages,
            revision: (old.data()?.revision || 0) + 1,
            updatedAt: sdk.serverTimestamp(),
            updatedBy: auth.currentUser.uid,
          });
        });
        index.unsavedChanges = false;
        index.sharedRevision = expectedRevision + 1;
        index.sharedFileId = receipt.driveFileId;
        await files.finalize(receipt).catch(() => {
          repository.fileWarning = 'Consulta pronta. A limpeza do índice anterior está pendente.';
        });
        announce(game, document, state, index);
        return index;
      } catch (error) {
        await files.discard(receipt).catch(() => {});
        throw error;
      }
    },
    scope,
  };
}
