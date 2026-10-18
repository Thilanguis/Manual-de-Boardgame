import { assertIsolatedConfiguration, checkDevelopmentServices } from './development.js';
import { instrumentFirestore } from './development-metrics.js';
import { MAX_PDF_READ_BYTES } from './pdf-limits.js';
import { createDocumentRepository } from './document-repository.js';
import { primaryDocumentId, gameDocuments } from './documents.js';
import { requirePrivateCache, unlockPrivateCache, lockPrivateCache, purgePrivateCaches, privateCacheUnlocked } from './private-cache.js';
import { createResearchStore } from './research-store.js';
import { createDriveStorage } from './drive-storage.js';
import { safeImageUrl } from './model.js';
import { OWNER_UID, accessFor, emptyPermissions, profileSummary, userChange } from './permissions.js';
import { annotateAvailability } from './catalog-availability.js';
import { requestBgg } from './bgg-client.js';
import { createGuideRepository } from './guide-repository.js';
import { researchRequest } from './research-client.js';
import { withoutUndefined } from './firestore-data.js';
const SDK = 'https://www.gstatic.com/firebasejs/13.0.0';

export async function createFirebaseRepository(config) {
  assertIsolatedConfiguration(config, location.hostname);
  await checkDevelopmentServices(config);
  const ownerUid = config.ownerUid || OWNER_UID;
  requirePrivateCache();
  await purgePrivateCaches({ legacyOnly: true });
  const sdkBase = config.sdkBase || SDK;
  const [appSDK, authSDK, rawSDK] = await Promise.all([import(`${sdkBase}/firebase-app.js`), import(`${sdkBase}/firebase-auth.js`), import(`${sdkBase}/firebase-firestore.js`)]);
  const dbSDK = instrumentFirestore(rawSDK, config.development);
  const app = appSDK.initializeApp(config.firebase),
    auth = authSDK.getAuth(app),
    db = dbSDK.initializeFirestore(app, { localCache: dbSDK.memoryLocalCache() });
  if (config.emulators) {
    if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('Emuladores só podem ser usados no ambiente local.');
    authSDK.connectAuthEmulator(auth, config.emulators.auth, { disableWarnings: true });
    dbSDK.connectFirestoreEmulator(db, config.emulators.host, config.emulators.port);
  }
  const files = createDriveStorage(
    { ...config.fileStorage, projectId: config.firebase.projectId },
    () => auth.currentUser?.getIdToken(),
    () => auth.currentUser?.uid,
  );
  const gameListeners = new Set(),
    sessionListeners = new Set(),
    errorListeners = new Set(),
    urls = new Map(),
    coverRequests = new Map(),
    coverErrors = new Map();
  let unsubscribe = null,
    stopProfile = null,
    queryKey = '',
    querySequence = 0,
    sessionSequence = 0,
    sessionResolving = true,
    cacheError = '',
    cachePreparing = null,
    cacheAttempted = false,
    availabilityBlocked = false,
    availabilityCheckedAt = 0,
    storageStatus = null,
    profile = null,
    publicRead = false,
    stopSettings = null,
    settingsLoaded = false,
    settingsPreparing = null,
    requestedName = '',
    rawGames = [],
    availabilitySequence = 0,
    availabilityTimer = null,
    closed = false;
  const availability = new Map();
  const repository = {
    mode: 'firebase',
    fileProvider: 'drive',
    draftKnowledge(input, options) {
      requireWrite();
      return files.draftKnowledge(input, options);
    },
    getKnowledge(game, options) {
      requireRead();
      return files.knowledge(game, undefined, options);
    },
    generateKnowledge(game, { force = false, reuseOnly = false, expectedIdentity, requestId = crypto.randomUUID() } = {}) {
      requireWrite(force ? 'edit' : undefined);
      return files.knowledge(game, { force, reuseOnly, requestId, ...(expectedIdentity ? { expectedIdentity } : {}) });
    },
    reviewKnowledge(game, revision, sections) {
      requireWrite('edit');
      return files.knowledge(game, { revision, sections });
    },
    refreshAvailability,
    retryCovers() {
      coverErrors.clear();
    },
    async retryPreparation() {
      requireRead();
      const user = auth.currentUser,
        sequence = sessionSequence;
      cacheAttempted = false;
      availabilityBlocked = false;
      try {
        await prepareCache(user, sequence);
      } catch (error) {
        cacheError = `${error.message}${error.status ? ` (${error.status})` : ''}`;
      }
      storageStatus = await files.capabilities(true).catch(() => ({ error: 'Não foi possível conferir a conexão dos documentos.' }));
      if (sequence === sessionSequence) publishSession(user);
    },
    session: { mode: 'firebase', resolving: true, canRead: false, canWrite: false, canAdd: false, canEdit: false, canDelete: false, user: null },
    subscribeSession(callback) {
      sessionListeners.add(callback);
      callback(this.session);
      return () => sessionListeners.delete(callback);
    },
    subscribeGames(callback, onError) {
      gameListeners.add(callback);
      if (onError) errorListeners.add(onError);
      if (this.games) callback(this.games, { loading: !this.gamesReady });
      return () => {
        gameListeners.delete(callback);
        errorListeners.delete(onError);
      };
    },
    async login(email, password) {
      await authSDK.signInWithEmailAndPassword(auth, email, password);
    },
    async register(name, email, password) {
      requestedName = String(name).trim().slice(0, 100);
      if (!requestedName) throw new Error('Informe seu nome.');
      try {
        const credential = await authSDK.createUserWithEmailAndPassword(auth, String(email).trim().toLowerCase(), password);
        await authSDK.updateProfile(credential.user, { displayName: requestedName });
        await ensureProfile(credential.user);
      } finally {
        requestedName = '';
      }
    },
    async resetPassword(email) {
      await authSDK.sendPasswordResetEmail(auth, String(email).trim());
    },
    async retryProfile() {
      if (!auth.currentUser) throw new Error('Entre na conta primeiro.');
      await ensureProfile(auth.currentUser);
    },
    subscribePending(callback, onError) {
      let initial = true;
      return dbSDK.onSnapshot(
        dbSDK.query(dbSDK.collection(db, 'users'), dbSDK.where('status', '==', 'pending')),
        (snapshot) => {
          callback(snapshot.docs.map(toProfile), {
            initial,
            fromCache: snapshot.metadata.fromCache,
            added: snapshot
              .docChanges()
              .filter((change) => change.type === 'added')
              .map((change) => toProfile(change.doc)),
          });
          if (!snapshot.metadata.fromCache) initial = false;
        },
        onError,
      );
    },
    subscribePeople(callback, onError) {
      return dbSDK.onSnapshot(dbSDK.collection(db, 'users'), (snapshot) => callback(snapshot.docs.map(toProfile)), onError);
    },
    subscribeAudit(callback, onError) {
      return dbSDK.onSnapshot(
        dbSDK.query(dbSDK.collection(db, 'auditEvents'), dbSDK.orderBy('createdAt', 'desc'), dbSDK.limit(50)),
        (snapshot) => callback(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id, createdAt: doc.data().createdAt?.toMillis?.() || 0 }))),
        onError,
      );
    },
    async changeUser(uid, action, permissions) {
      if (!auth.currentUser || uid === auth.currentUser.uid || uid === ownerUid) throw new Error('Esta conta está protegida e não pode ser alterada.');
      if (['approve', 'reject'].includes(action) ? !this.session.canApproveUsers : !this.session.canManageUsers) throw new Error('Sua conta não tem permissão para esta operação.');
      const ref = dbSDK.doc(db, 'users', uid),
        eventId = crypto.randomUUID();
      await dbSDK.runTransaction(db, async (tx) => {
        const current = (await tx.get(ref)).data();
        if (!current) throw new Error('Conta não encontrada.');
        const change = userChange(current, action, permissions),
          version = current.version + 1;
        tx.update(ref, { ...change, version, lastEventId: eventId, updatedAt: dbSDK.serverTimestamp() });
        tx.set(dbSDK.doc(db, 'auditEvents', eventId), { id: eventId, targetType: 'user', targetId: uid, actorUid: auth.currentUser.uid, action, before: profileSummary(current), after: change, version, createdAt: dbSDK.serverTimestamp() });
      });
    },
    async setLibraryPublic(value) {
      if (!this.session.canConfigure) throw new Error('Somente o proprietário pode alterar a biblioteca.');
      const eventId = crypto.randomUUID(),
        ref = dbSDK.doc(db, 'settings', 'library');
      await dbSDK.runTransaction(db, async (tx) => {
        const current = (await tx.get(ref)).data();
        if (!current?.version) throw new Error('Execute o procedimento seguro de preparação do proprietário.');
        const version = current.version + 1;
        tx.update(ref, { publicRead: value === true, version, lastEventId: eventId, updatedAt: dbSDK.serverTimestamp() });
        tx.set(dbSDK.doc(db, 'auditEvents', eventId), {
          id: eventId,
          targetType: 'settings',
          targetId: 'library',
          actorUid: auth.currentUser.uid,
          action: 'librarySettings',
          before: { publicRead: current.publicRead },
          after: { publicRead: value === true },
          version,
          createdAt: dbSDK.serverTimestamp(),
        });
      });
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
      sessionResolving = true;
      profile = null;
      publishSession(auth.currentUser);
      await purgePrivateCaches();
      await authSDK.signOut(auth);
    },
    async lookup(action, value) {
      requireWrite();
      const endpoint = config.bggEndpoint || (config.fileStorage.apiBase ? `${config.fileStorage.apiBase.replace(/\/$/, '')}/v1/bgg` : '');
      if (!config.enableBgg || !endpoint) throw new Error('A consulta ao BGG ainda não foi ativada neste acervo.');
      return requestBgg(endpoint, () => auth.currentUser.getIdToken(), action === 'search' ? { action, query: value } : { action, id: value });
    },
    fetchBggCover(id) {
      requireWrite();
      return files.bggCover(id);
    },
    research(source, input, options) {
      if (!config.fileStorage?.apiBase) throw new Error('Configure o endereço da API para pesquisar fontes externas.');
      requireWrite();
      return researchRequest(config.fileStorage.apiBase, () => auth.currentUser?.getIdToken(), source, input, options);
    },
    async getCoverURL(game) {
      requireRead();
      const sequence = sessionSequence;
      if (game.cover?.url && !game.cover.driveFileId) return safeImageUrl(game.cover.url);
      if (!game.cover?.driveFileId) return '';
      const key = game.cover.driveFileId;
      if (urls.has(key)) return urls.get(key);
      if (coverErrors.has(key)) throw coverErrors.get(key);
      if (coverRequests.has(key)) return coverRequests.get(key);
      const pending = (async () => {
        const blob = await files.get(game, 'cover', 8 * 1024 * 1024),
          url = URL.createObjectURL(blob);
        if (sequence !== sessionSequence || !repository.session.canRead) {
          URL.revokeObjectURL(url);
          throw new Error('Sua sessão mudou. Entre novamente.');
        }
        urls.set(key, url);
        return url;
      })()
        .catch((error) => {
          if (sequence === sessionSequence && [401, 403, 429].includes(error.status)) coverErrors.set(key, error);
          throw error;
        })
        .finally(() => {
          if (coverRequests.get(key) === pending) coverRequests.delete(key);
        });
      coverRequests.set(key, pending);
      return pending;
    },
    getManual(game, options) {
      requireRead();
      return files.get(game, 'manual', MAX_PDF_READ_BYTES, options);
    },
    getManualSource(game) {
      requireRead();
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
      const uploaded = [];
      let record = {
        ...Object.fromEntries(Object.entries(game).filter(([key]) => key !== '_driveAvailability')),
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
        if (record.documents && manualBlob) {
          const id = primaryDocumentId(record);
          record.documents = { ...record.documents, [id]: { ...record.documents[id], manual: record.manual, language: record.language } };
        }
        record = withoutUndefined(record);
        await dbSDK.runTransaction(db, async (transaction) => {
          const latest = await transaction.get(docRef);
          if (latest.exists() !== !!previous || (latest.exists() && latest.data().updatedAt?.toMillis?.() !== expected)) throw new Error('O jogo mudou durante o envio. Reabra o cadastro e tente novamente.');
          transaction.set(docRef, record);
        });
      } catch (error) {
        const results = await Promise.allSettled(uploaded.map((reference) => files.discard(reference)));
        if (manualBlob?.size > 50 * 1024 * 1024 && error.code === 'permission-denied') {
          error.message = 'O envio terminou, mas o cadastro não foi autorizado. Confira as permissões de cadastro. Seus dados continuam preenchidos.';
          error.uploadContext = 'large-pdf';
        }
        if (results.some((result) => result.status === 'rejected')) error.message += ' A limpeza de um arquivo enviado não terminou. Confira a pasta exclusiva do projeto no Drive.';
        throw error;
      }
      let warning = '';
      const cleanup = await Promise.allSettled(uploaded.map((reference) => files.finalize(reference)));
      if (cleanup.some((result) => result.status === 'rejected')) warning = 'Jogo salvo e manual disponível. A remoção de um arquivo anterior não terminou; confira a pasta do Acervo no Drive.';
      revokeURLs();
      return { game: { ...record, createdAt: previous?.createdAt?.toMillis?.() || Date.now() }, warning, created: !previous };
    },
    async deleteGame(game) {
      requireWrite('delete');
      const result = await files.deleteGame(game);
      revokeURLs();
      return result;
    },
    close() {
      closed = true;
      ++sessionSequence;
      ++querySequence;
      repository.session = { ...repository.session, canRead: false, canWrite: false, canAdd: false, canEdit: false, canDelete: false };
      ++availabilitySequence;
      clearTimeout(availabilityTimer);
      window.removeEventListener('focus', scheduleAvailability);
      document.removeEventListener('visibilitychange', scheduleAvailability);
      unsubscribe?.();
      stopProfile?.();
      stopSettings?.();
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      files.close();
      lockPrivateCache();
      stopAuth();
      revokeURLs();
    },
  };
  function publishGames() {
    repository.games = annotateAvailability(rawGames, availability);
    for (const callback of gameListeners) callback(repository.games, { loading: !repository.gamesReady });
  }
  async function refreshAvailability() {
    if (availabilityBlocked) throw new Error('A atualização foi pausada após uma falha de acesso ou limite de consultas. Confira sua conta antes de tentar novamente.');
    if (closed || !repository.session.canRead || !config.fileStorage?.apiBase || !rawGames.length) return;
    availabilityCheckedAt = Date.now();
    const sequence = ++availabilitySequence,
      query = querySequence,
      candidates = rawGames.filter((game) => !game.deleting),
      manualIds = new Map(candidates.map((game) => [game.id, game.manual?.driveFileId]));
    try {
      const results = await files.checkGames(candidates);
      if (closed || query !== querySequence || sequence !== availabilitySequence) return;
      for (const result of results) if (manualIds.has(result.id) && typeof result.available === 'boolean') availability.set(result.id, { manualId: manualIds.get(result.id), result });
      publishGames();
    } catch (error) {
      if ([401, 403, 429].includes(error.status)) availabilityBlocked = true;
      // Falha transitória não significa que o arquivo foi removido.
      if (!closed && query === querySequence && sequence === availabilitySequence) report(error);
      throw error;
    }
  }
  function scheduleAvailability() {
    if (document.visibilityState !== 'visible' || closed || availabilityBlocked || Date.now() - availabilityCheckedAt < 60000) return;
    clearTimeout(availabilityTimer);
    availabilityTimer = setTimeout(() => refreshAvailability().catch(() => {}), 350);
  }
  window.addEventListener('focus', scheduleAvailability);
  document.addEventListener('visibilitychange', scheduleAvailability);
  function revokeURLs() {
    coverRequests.clear();
    coverErrors.clear();
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  }
  function requireRead() {
    if (!repository.session.canRead || !auth.currentUser) throw new Error('Entre com uma conta aprovada para acessar o Acervo.');
  }
  function requireWrite(action) {
    if (!auth.currentUser || !repository.session.canWrite || (action && !repository.session[`can${action[0].toUpperCase()}${action.slice(1)}`])) throw new Error('Sua conta não tem permissão para esta operação.');
  }
  function report(error) {
    for (const callback of errorListeners) callback(error);
  }
  function toProfile(doc) {
    const p = doc.data();
    return { ...p, uid: doc.id, createdAt: p.createdAt?.toMillis?.() || 0, updatedAt: p.updatedAt?.toMillis?.() || 0 };
  }
  async function ensureProfile(user) {
    if (user.uid === ownerUid) return; // O proprietário só é provisionado via IAM local.
    const name = (requestedName || user.displayName || user.email?.split('@')[0] || 'Usuário').trim().slice(0, 100);
    const ref = dbSDK.doc(db, 'users', user.uid);
    await dbSDK.runTransaction(db, async (tx) => {
      if ((await tx.get(ref)).exists()) return;
      tx.set(ref, { uid: user.uid, name, email: user.email, role: 'user', status: 'pending', permissions: emptyPermissions(), createdAt: dbSDK.serverTimestamp(), updatedAt: dbSDK.serverTimestamp(), version: 1, lastEventId: '' });
    });
  }
  function publishSession(user) {
    const rights = accessFor(navigator.onLine ? profile : null, user?.uid, ownerUid);
    const lostAccess = repository.session.canRead && !rights.canRead;
    if (lostAccess) {
      cacheAttempted = false;
      cachePreparing = null;
      settingsLoaded = false;
      stopSettings?.();
      stopSettings = null;
      files.resetSession();
      revokeURLs();
      lockPrivateCache();
      if (navigator.onLine) void purgePrivateCaches();
    }
    repository.session = {
      mode: 'firebase',
      user,
      profile,
      resolving: sessionResolving,
      cacheError,
      storageStatus,
      ...rights,
      cacheReady: privateCacheUnlocked(),
      publicRead,
      settingsLoaded: true,
      publicOnly: !rights.canReadAll && !publicRead,
      role: profile?.role || 'visitor',
      status: profile?.status || 'missing',
    };
    for (const callback of sessionListeners) callback(repository.session);
    const key = `${user?.uid || 'visitor'}:${rights.canRead ? (rights.canReadAll ? 'all' : publicRead ? 'approvedAll' : 'approved') : 'denied'}`;
    if (key === queryKey) return;
    queryKey = key;
    unsubscribe?.();
    revokeURLs();
    const sequence = ++querySequence;
    ++availabilitySequence;
    availability.clear();
    rawGames = [];
    repository.games = [];
    repository.gamesReady = false;
    for (const callback of gameListeners) callback([], { loading: true });
    if (!rights.canRead) {
      repository.gamesReady = true;
      return;
    }
    const collection = dbSDK.collection(db, 'games');
    const query = rights.canReadAll ? collection : publicRead ? dbSDK.query(collection, dbSDK.where('deleting', '==', false)) : dbSDK.query(collection, dbSDK.where('isPublic', '==', true), dbSDK.where('deleting', '==', false));
    unsubscribe = dbSDK.onSnapshot(
      query,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (sequence !== querySequence) return;
        const wasReady = repository.gamesReady,
          changed = snapshot.docChanges().length > 0;
        repository.gamesReady = !snapshot.metadata.fromCache || snapshot.size > 0;
        if (wasReady === repository.gamesReady && !changed) return;
        rawGames = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id, createdAt: doc.data().createdAt?.toMillis?.() || 0, updatedAt: doc.data().updatedAt?.toMillis?.() || 0 }));
        publishGames();
        if (changed) refreshAvailability().catch(() => {});
      },
      (error) => {
        if (sequence === querySequence) report(error);
      },
    );
  }
  function onOffline() {
    sessionResolving = false;
    publishSession(auth.currentUser);
  }
  function onOnline() {
    if (auth.currentUser) void refreshProfile();
  }
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);
  function watchSettings(user, sequence) {
    if (stopSettings || !repository.session.canRead) return;
    stopSettings = dbSDK.onSnapshot(
      dbSDK.doc(db, 'settings', 'library'),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (sequence !== sessionSequence || snapshot.metadata.fromCache || !repository.session.canRead) return;
        publicRead = !snapshot.exists() || snapshot.data().publicRead === true;
        publishSession(user);
      },
      (error) => {
        if (sequence === sessionSequence) {
          publicRead = false;
          publishSession(user);
          report(error);
        }
      },
    );
  }
  function readSettings() {
    if (settingsLoaded) return Promise.resolve();
    if (settingsPreparing) return settingsPreparing;
    const sequence = sessionSequence;
    const pending = dbSDK
      .getDocFromServer(dbSDK.doc(db, 'settings', 'library'))
      .then((snapshot) => {
        if (sequence !== sessionSequence || closed) return;
        settingsLoaded = true;
        publicRead = !snapshot.exists() || snapshot.data().publicRead === true;
      })
      .finally(() => {
        if (settingsPreparing === pending) settingsPreparing = null;
      });
    settingsPreparing = pending;
    return pending;
  }
  function prepareCache(user, sequence) {
    if (cachePreparing?.sequence === sequence) return cachePreparing.promise;
    if (privateCacheUnlocked() || cacheAttempted) return Promise.resolve();
    cacheAttempted = true;
    const pending = { sequence, promise: null };
    pending.promise = prepareCacheOnce(user, sequence).finally(() => {
      if (cachePreparing === pending) cachePreparing = null;
    });
    cachePreparing = pending;
    return pending.promise;
  }
  async function prepareCacheOnce(user, sequence) {
    const origin = config.emulators ? `http://${config.emulators.host}:${config.emulators.port}` : 'https://firestore.googleapis.com';
    const root = `${origin}/v1/projects/${config.firebase.projectId}/databases/(default)/documents`;
    const headers = { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' };
    const cacheFetch = (url, options) => {
      if (config.development) {
        const m = globalThis.__ACERVO_METRICS__;
        m.rest ||= {};
        const key = `${options.method || 'GET'} cacheKeys`;
        m.rest[key] = (m.rest[key] || 0) + 1;
      }
      return fetch(url, options);
    };
    let response = await cacheFetch(`${root}/cacheKeys/${user.uid}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (response.status === 404) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const value = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      response = await cacheFetch(`${root}/cacheKeys?documentId=${user.uid}`, { method: 'POST', headers, signal: AbortSignal.timeout(10000), body: JSON.stringify({ fields: { key: { stringValue: value } } }) });
      if (response.status === 409) response = await cacheFetch(`${root}/cacheKeys/${user.uid}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    }
    if (!response.ok)
      throw Object.assign(
        new Error(
          response.status === 403
            ? 'A preparação não tem acesso ao cache privado. Confira as regras de acesso do servidor.'
            : response.status === 401
              ? 'A sessão não foi aceita para preparar os documentos. Entre novamente.'
              : 'A preparação está sem conexão com o cache privado.',
        ),
        { status: response.status, code: 'private-cache/access' },
      );
    const value = (await response.json()).fields?.key?.stringValue;
    if (!/^[a-f0-9]{64}$/.test(value || '')) throw new Error('Cache privado inválido.');
    if (sequence !== sessionSequence || profile?.status !== 'approved') return;
    await unlockPrivateCache(
      user.uid,
      Uint8Array.from(value.match(/../g), (h) => parseInt(h, 16)),
    );
    cacheError = '';
  }
  async function refreshProfile() {
    const user = auth.currentUser,
      sequence = sessionSequence;
    if (!user) return;
    try {
      const snapshot = await dbSDK.getDocFromServer(dbSDK.doc(db, 'users', user.uid));
      if (sequence !== sessionSequence) return;
      profile = snapshot.exists() ? snapshot.data() : null;
      if (accessFor(profile, user.uid, ownerUid).canRead) {
        await readSettings().catch((error) => {
          publicRead = false;
          report(error);
        });
        try {
          await prepareCache(user, sequence);
        } catch (error) {
          cacheError = `${error.message}${error.status ? ` (${error.status})` : ''}`;
        }
      }
      if (sequence === sessionSequence) {
        sessionResolving = false;
        publishSession(user);
        watchSettings(user, sequence);
      }
    } catch (error) {
      if (sequence === sessionSequence) {
        profile = null;
        publishSession(user);
        report(error);
      }
    }
  }
  const stopAuth = authSDK.onAuthStateChanged(auth, async (user) => {
    const sequence = ++sessionSequence;
    sessionResolving = !!user && navigator.onLine;
    cacheError = '';
    cacheAttempted = false;
    cachePreparing = null;
    settingsLoaded = false;
    settingsPreparing = null;
    availabilityBlocked = false;
    stopProfile?.();
    stopProfile = null;
    profile = null;
    stopSettings?.();
    stopSettings = null;
    files.resetSession();
    lockPrivateCache();
    publishSession(user);
    if (!user) return;
    let provisionAttempted = false;
    stopProfile = dbSDK.onSnapshot(
      dbSDK.doc(db, 'users', user.uid),
      { includeMetadataChanges: true },
      async (snapshot) => {
        if (sequence !== sessionSequence || snapshot.metadata.fromCache) return;
        profile = snapshot.exists() ? snapshot.data() : null;
        if (!profile && user.uid !== ownerUid && !provisionAttempted) {
          provisionAttempted = true;
          try {
            await ensureProfile(user);
          } catch (error) {
            if (sequence === sessionSequence) {
              sessionResolving = false;
              publishSession(user);
              report(error);
            }
          }
          return;
        }
        if (!accessFor(profile, user.uid, ownerUid).canRead) {
          sessionResolving = false;
          publishSession(user);
          return;
        }
        await readSettings().catch((error) => {
          publicRead = false;
          report(error);
        });
        try {
          await prepareCache(user, sequence);
        } catch (error) {
          cacheError = `${error.message}${error.status ? ` (${error.status})` : ''}`;
        }
        storageStatus = await files.capabilities().catch(() => ({ error: 'Não foi possível conferir a conexão dos documentos.' }));
        if (sequence === sessionSequence) {
          sessionResolving = false;
          publishSession(user);
          watchSettings(user, sequence);
        }
      },
      (error) => {
        if (sequence === sessionSequence) {
          sessionResolving = false;
          profile = null;
          publishSession(user);
          report(error);
        }
      },
    );
  });
  Object.assign(repository, createGuideRepository(repository, { db, dbSDK, auth, files }));
  Object.assign(repository, createResearchStore(repository, { project: config.firebase.projectId, db, sdk: dbSDK, auth }));
  Object.assign(repository, createDocumentRepository(repository, { files, db, sdk: dbSDK, auth, project: config.firebase.projectId }));
  return repository;
}
