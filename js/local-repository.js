import { createDocumentRepository } from './document-repository.js';
import { createResearchStore } from './research-store.js';
import { createLocalGuides } from './guide-repository.js';
const DATABASE = 'acervo-library-v1';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('games', { keyPath: 'id' });
      db.createObjectStore('files');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Não foi possível abrir a biblioteca local. Confira se o navegador permite armazenamento neste site.'));
  });
}

function transact(db, stores, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    let result;
    transaction.oncomplete = () => resolve(result?.result ?? result);
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Não foi possível salvar. O armazenamento do dispositivo pode estar cheio.'));
    try {
      result = operation(transaction);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

export async function createLocalRepository() {
  const db = await openDatabase();
  const listeners = new Set(),
    errors = new Set(),
    urls = new Map();
  const list = () => transact(db, ['games'], 'readonly', (tx) => tx.objectStore('games').getAll());
  const emit = async () => {
    try {
      const games = await list();
      repository.games = games;
      for (const listener of listeners) listener(games);
    } catch (error) {
      for (const listener of errors) listener(error);
    }
  };
  const revoke = (id) => {
    for (const key of [`${id}/cover`, `${id}/manual`]) {
      if (urls.has(key)) URL.revokeObjectURL(urls.get(key));
      urls.delete(key);
    }
  };
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(DATABASE) : null;
  if (channel)
    channel.onmessage = (event) => {
      if (event.data?.id) revoke(event.data.id);
      emit();
    };
  const changed = (id) => {
    revoke(id);
    channel?.postMessage({ id });
    emit();
  };
  const repository = {
    mode: 'local',
    session: { mode: 'local', canRead: true, canWrite: true, canAdd: true, canEdit: true, canDelete: true, user: null },
    subscribeSession(callback) {
      callback(this.session);
      return () => {};
    },
    subscribeGames(callback, onError) {
      listeners.add(callback);
      if (onError) errors.add(onError);
      emit();
      return () => {
        listeners.delete(callback);
        errors.delete(onError);
      };
    },
    async saveGame(game, { manualBlob, coverBlob } = {}) {
      const id = game.id || crypto.randomUUID();
      const existing = await transact(db, ['games'], 'readonly', (tx) => tx.objectStore('games').get(id));
      if (!existing && !manualBlob) throw new Error('Selecione o manual antes de salvar.');
      const record = { ...game, id, createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(), schemaVersion: 1 };
      await transact(db, ['games', 'files'], 'readwrite', (tx) => {
        if (manualBlob) tx.objectStore('files').put(manualBlob, `${id}/manual`);
        if (coverBlob) tx.objectStore('files').put(coverBlob, `${id}/cover`);
        tx.objectStore('games').put(record);
      });
      changed(id);
      return { game: record, warning: '' };
    },
    getManual(game) {
      return transact(db, ['files'], 'readonly', (tx) => tx.objectStore('files').get(`${game.id}/manual`)).then((blob) => {
        if (!blob) throw new Error('O manual não está mais armazenado neste dispositivo.');
        return blob;
      });
    },
    async getCoverURL(game) {
      if (game.cover?.url) return game.cover.url;
      const key = `${game.id}/cover`;
      if (urls.has(key)) return urls.get(key);
      const blob = await transact(db, ['files'], 'readonly', (tx) => tx.objectStore('files').get(key));
      if (!blob) return '';
      const url = URL.createObjectURL(blob);
      urls.set(key, url);
      return url;
    },
    async deleteGame(game) {
      await repository.deleteGuides(game);
      await transact(db, ['games', 'files'], 'readwrite', (tx) => {
        tx.objectStore('games').delete(game.id);
        tx.objectStore('files').delete(`${game.id}/manual`);
        tx.objectStore('files').delete(`${game.id}/cover`);
      });
      changed(game.id);
    },
    async login() {
      throw new Error('Configure o novo projeto Firebase para entrar como administrador.');
    },
    async logout() {},
    async lookup() {
      throw new Error('A consulta ao BoardGameGeek precisa do Firebase e da função opcional configurados.');
    },
    close() {
      channel?.close();
      for (const url of urls.values()) URL.revokeObjectURL(url);
      db.close();
      repository.closeGuides?.();
    },
  };
  Object.assign(repository, await createLocalGuides(repository));
  Object.assign(repository, createResearchStore(repository));
  Object.assign(repository, createDocumentRepository(repository));
  return repository;
}
