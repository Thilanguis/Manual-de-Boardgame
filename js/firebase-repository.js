import { createDriveStorage } from './drive-storage.js';
import { safeImageUrl } from './model.js';
const SDK = 'https://www.gstatic.com/firebasejs/13.0.0';
const OWNER_UID = '7TitBObtb8a0W8GisSstSM1RHiX2';

export async function createFirebaseRepository(config) {
  const [appSDK, authSDK, dbSDK] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`)]);
  const app = appSDK.initializeApp(config.firebase),
    auth = authSDK.getAuth(app),
    db = dbSDK.getFirestore(app);
  const files = createDriveStorage(
    { ...config.fileStorage, projectId: config.firebase.projectId },
    () => auth.currentUser?.getIdToken(),
    () => auth.currentUser?.uid,
  );
  const gameListeners = new Set(),
    sessionListeners = new Set(),
    errorListeners = new Set(),
    urls = new Map();
  let unsubscribe = null,
    sessionSequence = 0;
  const repository = {
    mode: 'firebase',
    fileProvider: 'drive',
    session: { mode: 'firebase', canRead: false, canWrite: false, canAdd: false, canEdit: false, canDelete: false, user: null },
    subscribeSession(callback) {
      sessionListeners.add(callback);
      callback(this.session);
      return () => sessionListeners.delete(callback);
    },
    subscribeGames(callback, onError) {
      gameListeners.add(callback);
      if (onError) errorListeners.add(onError);
      if (this.games) callback(this.games);
      return () => {
        gameListeners.delete(callback);
        errorListeners.delete(onError);
      };
    },
    async login(email, password) {
      await authSDK.signInWithEmailAndPassword(auth, email, password);
    },
    async loginGoogle() {
      const provider = new authSDK.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await authSDK.signInWithPopup(auth, provider);
    },
    async linkGoogle() {
      if (!auth.currentUser) throw new Error('Entre na conta existente antes de vincular o Google.');
      await authSDK.linkWithPopup(auth.currentUser, new authSDK.GoogleAuthProvider());
    },
    async logout() {
      await authSDK.signOut(auth);
    },
    async lookup(action, value) {
      requireWrite();
      const endpoint = config.bggEndpoint || (config.fileStorage.apiBase ? `${config.fileStorage.apiBase.replace(/\/$/, '')}/v1/bgg` : '');
      if (!config.enableBgg || !endpoint) throw new Error('A consulta ao BGG ainda não foi ativada neste acervo.');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await auth.currentUser.getIdToken()}` },
        body: JSON.stringify(action === 'search' ? { action, query: value } : { action, id: value }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível consultar o BGG.');
      return result;
    },
    fetchBggCover(id) {
      requireWrite();
      return files.bggCover(id);
    },
    async getCoverURL(game) {
      if (game.cover?.url && !game.cover.driveFileId) return safeImageUrl(game.cover.url);
      if (!game.cover?.driveFileId) return '';
      const key = game.cover.driveFileId;
      if (urls.has(key)) return urls.get(key);
      const blob = await files.get(game, 'cover', 8 * 1024 * 1024),
        url = URL.createObjectURL(blob);
      urls.set(key, url);
      return url;
    },
    getManual(game) {
      return files.get(game, 'manual', config.maxPdfBytes);
    },
    getManualSource(game) {
      return files.readerSource(game);
    },
    async reserveGameId(fingerprint) {
      requireWrite('add');
      const pending = files.pendingGameId(fingerprint);
      if (pending && !(await dbSDK.getDocFromServer(dbSDK.doc(db, 'games', pending))).exists()) return pending;
      return crypto.randomUUID();
    },
    async saveGame(game, { manualBlob, coverBlob, onProgress = () => {} } = {}) {
      const id = game.id || crypto.randomUUID(),
        docRef = dbSDK.doc(db, 'games', id);
      const snapshot = await dbSDK.getDocFromServer(docRef),
        previous = snapshot.exists() ? snapshot.data() : null;
      if (previous?.deleting === true) throw new Error('Este jogo está em processo de exclusão. Conclua a exclusão pendente antes de editar.');
      requireWrite(previous ? 'edit' : 'add');
      if (!previous && !manualBlob) throw new Error('Selecione um manual para adicionar o jogo.');
      const expected = previous?.updatedAt?.toMillis?.() || 0;
      if (previous && game.updatedAt && game.updatedAt !== expected) throw new Error('Este jogo foi atualizado em outro dispositivo. Reabra as informações antes de editar.');
      const uploaded = [],
        record = {
          ...game,
          id,
          isPublic: game.isPublic === true,
          deleting: false,
          schemaVersion: 1,
          createdBy: previous?.createdBy || auth.currentUser.uid,
          createdAt: previous?.createdAt || dbSDK.serverTimestamp(),
          updatedAt: dbSDK.serverTimestamp(),
        };
      try {
        if (manualBlob) {
          const path = `games/${id}/manual.pdf`,
            reference = await files.put(path, manualBlob, onProgress, { name: game.manual.name, fingerprint: game.manual.sha256 });
          uploaded.push(reference);
          record.manual = { ...game.manual, path, storage: 'drive', driveFileId: reference.driveFileId };
        }
        if (coverBlob) {
          const path = `games/${id}/cover-${crypto.randomUUID()}.jpg`,
            reference = await files.put(path, coverBlob, () => {}, { name: `${game.title} — capa.jpg` });
          uploaded.push(reference);
          record.cover = { ...game.cover, url: '', path, storage: 'drive', driveFileId: reference.driveFileId };
        }
        await dbSDK.runTransaction(db, async (transaction) => {
          const latest = await transaction.get(docRef);
          if (latest.exists() !== !!previous || (latest.exists() && latest.data().updatedAt?.toMillis?.() !== expected)) throw new Error('O jogo mudou durante o envio. Reabra o cadastro e tente novamente.');
          transaction.set(docRef, record);
        });
      } catch (error) {
        const results = await Promise.allSettled(uploaded.map((reference) => files.discard(reference)));
        if (results.some((result) => result.status === 'rejected')) error.message += ' A limpeza de um arquivo enviado não terminou. Confira a pasta exclusiva do projeto no Drive.';
        throw error;
      }
      let warning = '';
      const cleanup = await Promise.allSettled(uploaded.map((reference) => files.finalize(reference)));
      if (cleanup.some((result) => result.status === 'rejected')) warning = 'Jogo salvo e manual disponível. A remoção de um arquivo anterior não terminou; confira a pasta do Acervo no Drive.';
      revokeURLs();
      return { game: { ...record, createdAt: previous?.createdAt?.toMillis?.() || Date.now() }, warning };
    },
    async deleteGame(game) {
      requireWrite('delete');
      await files.deleteGame(game);
      revokeURLs();
    },
    close() {
      unsubscribe?.();
      stopAuth();
      revokeURLs();
    },
  };
  function revokeURLs() {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  }
  function requireWrite(action) {
    if (!auth.currentUser || !repository.session.canWrite || (action && !repository.session[`can${action[0].toUpperCase()}${action.slice(1)}`])) throw new Error('Sua conta não tem permissão para esta operação.');
  }
  function report(error) {
    for (const callback of errorListeners) callback(error);
  }
  const stopAuth = authSDK.onAuthStateChanged(auth, async (user) => {
    const sequence = ++sessionSequence;
    unsubscribe?.();
    unsubscribe = null;
    revokeURLs();
    repository.games = [];
    repository.session = { mode: 'firebase', user, canRead: false, canWrite: false, canAdd: false, canEdit: false, canDelete: false };
    for (const callback of gameListeners) callback([]);
    for (const callback of sessionListeners) callback(repository.session);
    try {
      const [settings, admin] = await Promise.all([dbSDK.getDocFromServer(dbSDK.doc(db, 'settings', 'library')), user ? dbSDK.getDocFromServer(dbSDK.doc(db, 'admins', user.uid)) : null]);
      if (sequence !== sessionSequence) return;
      const profile = admin?.data(),
        enabled = profile?.enabled === true,
        full = enabled && (user.uid === OWNER_UID || profile.role === 'admin');
      const rights = {
        canAdd: full || (enabled && profile.role === 'subadmin' && profile.permissions?.add === true),
        canEdit: full || (enabled && profile.role === 'subadmin' && profile.permissions?.edit === true),
        canDelete: full || (enabled && profile.role === 'subadmin' && profile.permissions?.delete === true),
      };
      const canWrite = Object.values(rights).some(Boolean),
        publicRead = settings.data()?.publicRead === true,
        canReadAll = enabled && (user.uid === OWNER_UID || ['admin', 'subadmin'].includes(profile.role));
      repository.session = { mode: 'firebase', user, ...rights, canWrite, canRead: true, publicRead, publicOnly: !canReadAll && !publicRead, role: profile?.role || (full ? 'admin' : 'visitor') };
      for (const callback of sessionListeners) callback(repository.session);
      const collection = dbSDK.collection(db, 'games'),
        query = canReadAll ? collection : repository.session.publicOnly ? dbSDK.query(collection, dbSDK.where('isPublic', '==', true), dbSDK.where('deleting', '==', false)) : dbSDK.query(collection, dbSDK.where('deleting', '==', false));
      unsubscribe = dbSDK.onSnapshot(
        query,
        (snapshot) => {
          repository.games = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id, createdAt: doc.data().createdAt?.toMillis?.() || 0, updatedAt: doc.data().updatedAt?.toMillis?.() || 0 }));
          for (const callback of gameListeners) callback(repository.games);
        },
        report,
      );
    } catch (error) {
      if (sequence === sessionSequence) report(error);
    }
  });
  return repository;
}
