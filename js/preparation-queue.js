import { gameDocuments, documentGame, findDocument } from './documents.js';
import { analyzePdf, indexMatches } from './pdf-index.js';
import { extendOcrIndex, ocrCoverage } from './pdf-knowledge.js';
import { createTextTranslator, translateIndex, isPortuguese, translatedValue } from './translation.js';
import { cachedIndex, indexCacheKey } from './index-cache.js';
import { normalizeText } from './model.js';
export const PREPARATION_LABELS = {
  waiting: 'Aguardando',
  analyzing: 'Preparando',
  ocr: 'Preparando',
  translating: 'Preparando',
  ready: 'Pronto para pesquisa',
  partial: 'Pesquisa disponível · parcial',
  attention: 'Precisa de atenção',
  paused: 'Pausado',
};
export function createPreparationQueue(repository, { scope = 'local', onChange = () => {}, analyze = analyzePdf, ocr = extendOcrIndex, translatorFactory = createTextTranslator, retryDelay = (attempts) => Math.min(60000, attempts * 10000) } = {}) {
  const jobs = new Map(),
    watchers = new Map();
  let games = [],
    activeKey,
    controller,
    running = false,
    timer,
    sequence = 0,
    account = '',
    loaded = false,
    restoring,
    catalogReady = false;
  let observedGameId = null;
  const key = (game, doc) => `${game.id}:${doc.id}:${doc.manual.sha256}`;
  const queueKey = () => `preparation:${scope}:${repository.session.user?.uid || 'device'}`;
  const permitted = (game) => repository.session.canRead && repository.canPrepare(game) && navigator.onLine;
  const persist = async () => {
    if (!repository.session.canRead) return;
    await cachedIndex(queueKey(), [...jobs.values()].slice(-144));
  };
  const notify = () => onChange([...jobs.values()]);
  async function requestKnowledge(game) {
    if (!(repository.session.storageStatus?.manualKnowledgeProtocol >= 1) || repository.session.storageStatus?.manualAiEnabled === false || !repository.generateKnowledge || !repository.session.canRead) return;
    const token = sequence,
      user = account;
    const ready = gameDocuments(game).map((document) => jobs.get(key(game, document)));
    const context = JSON.stringify([normalizeText(game.title), game.edition || '', gameDocuments(game).map((document) => [document.id, document.manual.sha256])]);
    if (ready.some((job) => !job || !['ready', 'partial'].includes(job.state)) || ready.every((job) => job.knowledgeContext === context)) return;
    // Marca antes da requisição para deduplicar notificações concorrentes e recargas.
    ready.forEach((job) => {
      job.knowledgeRequested = true;
      job.knowledgeContext = context;
    });
    await persist();
    if (token !== sequence || user !== account || !repository.session.canRead) return;
    try {
      const result = await repository.generateKnowledge(game, { reuseOnly: true });
      if (token !== sequence || user !== account || !repository.session.canRead) return;
      ready.forEach((job) => {
        job.knowledgeStatus = result?.status || 'requested';
      });
    } catch (error) {
      if (token !== sequence || user !== account || !repository.session.canRead) return;
      ready.forEach((job) => {
        job.knowledgeStatus = error.record?.status || 'attention';
      });
    }
    await persist();
    notify();
  }
  function schedule(delay = 0) {
    clearTimeout(timer);
    timer = setTimeout(() => void drain(), delay);
  }
  async function status(job, state, extra = {}) {
    Object.assign(job, { state, ...extra, updatedAt: Date.now() });
    notify();
    await persist();
  }
  async function drain() {
    if (running || !loaded || !repository.session.canRead || !navigator.onLine) return;
    const job = [...jobs.values()].find((job) => ['waiting', 'analyzing', 'ocr', 'translating'].includes(job.state) && (!job.retryAt || job.retryAt <= Date.now()) && games.some((game) => game.id === job.gameId && permitted(game)));
    if (!job) return;
    running = true;
    try {
      if (navigator.locks)
        await navigator.locks.request(`acervo-prepare:${scope}:${account}`, { ifAvailable: true }, async (lock) => {
          if (lock) await process(job);
          else schedule(3000);
        });
      else await process(job);
    } finally {
      running = false;
      if (!timer) schedule(50);
      else if (job.state !== 'waiting') schedule(50);
    }
  }
  async function process(job) {
    const token = sequence,
      user = account;
    activeKey = job.key;
    controller = new AbortController();
    const signal = controller.signal;
    let index, game, doc, translator;
    const active = () => token === sequence && account === user && repository.session.canRead;
    try {
      game = await repository.latestGame(games.find((game) => game.id === job.gameId));
      signal.throwIfAborted();
      if (!active()) return;
      doc = findDocument(game, job.documentId);
      if (!doc || doc.manual.sha256 !== job.sourceHash) {
        jobs.delete(job.key);
        await persist();
        return;
      }
      if (!permitted(game)) return;
      const view = documentGame(game, doc),
        cacheKey = indexCacheKey(scope, repository.session.user?.uid, view);
      const local = await cachedIndex(cacheKey);
      const shared = await repository.getTechnicalIndex(game, doc);
      signal.throwIfAborted();
      const localValid = indexMatches(local, view),
        sharedValid = indexMatches(shared, view);
      index = sharedValid && (!localValid || ocrCoverage(shared).readable > ocrCoverage(local).readable || (local.analysisComplete === false && shared.analysisComplete !== false)) ? shared : localValid ? local : shared;
      if (sharedValid && shared.analysisComplete !== false && !ocrCoverage(shared).pending && !job.retryFailed) {
        const c = ocrCoverage(shared);
        job.translationPending = !isPortuguese(shared.language) && shared.pages.some((p) => p.text.trim() && !translatedValue(p.translation, p.text));
        if (!job.translationPending) {
          if (shared.legacyShared) await repository.saveTechnicalIndex(game, doc, shared, { state: c.failed ? 'partial' : 'ready', signal });
          await status(job, c.failed ? 'partial' : 'ready', { current: c.readable, total: c.total, failedPages: c.failed });
          await requestKnowledge(game);
          return;
        }
      }
      const checkpoint = async (value) => {
        signal.throwIfAborted();
        index = value;
        await cachedIndex(cacheKey, value);
      };
      await status(job, 'analyzing', { error: '', current: 0, total: doc.manual.pages });
      const needsPdf = !indexMatches(index, view) || index.analysisComplete === false || ocrCoverage(index).pending > 0 || (job.retryFailed && ocrCoverage(index).failed > 0);
      const blob = needsPdf ? await repository.getDocumentManual(game, doc, { signal }) : null;
      signal.throwIfAborted();
      if (needsPdf)
        index = await analyze(blob, view, {
          signal,
          previous: index,
          checkpoint,
          onProgress: (p) => {
            job.current = p.current;
            job.total = p.total;
            notify();
          },
        });
      const coverage = ocrCoverage(index);
      if (coverage.pending || (job.retryFailed && coverage.failed)) {
        await status(job, 'ocr', { current: coverage.readable, total: coverage.total });
        index = await ocr(blob, view, index, {
          signal,
          checkpoint,
          retry: !!job.retryFailed && !coverage.pending,
          onProgress: () => {
            const c = ocrCoverage(index);
            job.current = c.readable;
            job.total = c.total;
            notify();
          },
        });
      }
      job.retryFailed = false;
      if (!isPortuguese(index.language)) {
        await status(job, 'translating');
        translator = translatorFactory({ scope: cacheKey });
        if ((await translator.availability(index.language)) === 'available') {
          await translateIndex(index, translator, { signal, checkpoint });
          job.translationPending = false;
        } else job.translationPending = true;
      }
      signal.throwIfAborted();
      if (!active()) return;
      const c = ocrCoverage(index),
        state = c.pending || c.failed || job.translationPending ? 'partial' : 'ready';
      if (needsPdf || !sharedValid || shared.legacyShared || !job.translationPending) await repository.saveTechnicalIndex(game, doc, index, { state, signal });
      await checkpoint(index);
      await status(job, state, { current: c.readable, total: c.total, failedPages: c.failed, attempts: 0 });
      await requestKnowledge(game);
    } catch (error) {
      if (!active()) return;
      if (signal.aborted) {
        await status(job, navigator.onLine ? 'paused' : 'waiting');
        if (index && game && doc && permitted(game)) {
          try {
            await repository.saveTechnicalIndex(game, doc, index, { state: 'partial' });
          } catch {
            /* O checkpoint local permanece retomável. */
          }
        }
      } else {
        const attempts = (job.attempts || 0) + 1;
        const permanent = [401, 403, 429].includes(error.status) || /permission-denied|resource-exhausted|unauthenticated/.test(error.code || '');
        const transient = !permanent && (!error.status || [502, 503, 504].includes(error.status));
        await status(job, transient && attempts < 3 ? 'waiting' : 'attention', { attempts, error: error.message, retryAt: Date.now() + retryDelay(attempts) });
        if (transient && attempts < 3) schedule(retryDelay(attempts));
      }
    } finally {
      translator?.destroy();
      controller = null;
      activeKey = null;
    }
  }
  async function update(nextGames, { loading = false } = {}) {
    const uid = repository.session.user?.uid || 'device';
    if (!repository.session.canRead) {
      stop();
      return;
    }
    // Uma lista vazia durante a inicialização não representa exclusão do catálogo.
    if (loading) return;
    games = nextGames;
    if (account !== uid) {
      stop();
      account = uid;
      loaded = false;
      jobs.clear();
    }
    catalogReady = true;
    const token = sequence;
    if (!loaded) {
      if (!restoring) {
        const pending = cachedIndex(queueKey())
          .then((saved) => {
            if (token !== sequence || !repository.session.canRead) return;
            for (const job of Array.isArray(saved) ? saved : []) jobs.set(job.key, { ...job, state: ['analyzing', 'ocr', 'translating'].includes(job.state) ? 'waiting' : job.state });
            loaded = true;
          })
          .finally(() => {
            if (restoring === pending) restoring = null;
          });
        restoring = pending;
      }
      await restoring;
      if (token !== sequence || !loaded || !repository.session.canRead) return;
    }
    for (const [id, stop] of watchers)
      if (id !== observedGameId || !games.some((game) => game.id === id)) {
        stop();
        watchers.delete(id);
      }
    for (const game of games.filter((item) => item.id === observedGameId))
      if (!watchers.has(game.id) && repository.watchPreparation)
        watchers.set(
          game.id,
          repository.watchPreparation(game, (records) => {
            if (!repository.session.canRead) return;
            const current = games.find((item) => item.id === game.id);
            if (!current) return;
            for (const record of records) {
              const doc = findDocument(current, record.documentId);
              if (!doc || doc.manual.sha256 !== record.sourceHash) continue;
              const job = jobs.get(key(current, doc));
              if (job && !['analyzing', 'ocr', 'translating'].includes(job.state))
                Object.assign(job, {
                  remoteRevision: record.revision,
                  state: job.state === 'paused' || (record.state === 'partial' && repository.canPrepare(current) && ['waiting', 'attention'].includes(job.state)) ? job.state : record.state,
                  current: record.readablePages || 0,
                  total: doc.manual.pages,
                  translationPending: !isPortuguese(doc.language) && (record.translatedPages || 0) < (record.readablePages || doc.manual.pages),
                });
            }
            notify();
            void persist();
          }),
        );
    for (const game of games)
      for (const doc of gameDocuments(game)) {
        const id = key(game, doc);
        if (!jobs.has(id)) jobs.set(id, { key: id, gameId: game.id, documentId: doc.id, sourceHash: doc.manual.sha256, state: 'waiting', attempts: 0, current: 0, total: doc.manual.pages });
      }
    for (const [id, job] of jobs) if (!games.some((game) => game.id === job.gameId && findDocument(game, job.documentId)?.manual.sha256 === job.sourceHash)) jobs.delete(id);
    if (activeKey && (!jobs.has(activeKey) || !games.some((game) => game.id === jobs.get(activeKey)?.gameId && permitted(game)))) controller?.abort();
    notify();
    await persist();
    for (const game of games) if (permitted(game)) await requestKnowledge(game);
    schedule();
  }
  function stop() {
    for (const stop of watchers.values()) stop();
    watchers.clear();
    ++sequence;
    clearTimeout(timer);
    timer = null;
    controller?.abort();
    jobs.clear();
    loaded = false;
    restoring = null;
    catalogReady = false;
  }
  const onOffline = () => controller?.abort();
  const onOnline = () => schedule();
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);
  return {
    observeGame(game) {
      observedGameId = game?.id || null;
      for (const [id, stop] of watchers)
        if (id !== observedGameId) {
          stop();
          watchers.delete(id);
        }
      if (repository.session.canRead && catalogReady) void update(games);
    },
    update,
    stop,
    destroy() {
      stop();
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    },
    entries: () => [...jobs.values()],
    blockedReason() {
      if (!navigator.onLine) return 'Conecte-se à internet para continuar.';
      if (repository.mode === 'firebase' && !repository.session.cacheReady) return 'A preparação está sem acesso ao cache privado. O manual original continua disponível.';
      if (repository.mode === 'firebase' && !(repository.session.storageStatus?.fileProtocol >= 2)) return 'A conexão dos documentos precisa ser atualizada.';
      return '';
    },
    pause(game, doc) {
      const job = jobs.get(key(game, doc));
      if (!job) return;
      job.state = 'paused';
      if (controller && activeKey === job.key) controller.abort();
      void persist();
      notify();
    },
    resume(game, doc, { retryFailed = false } = {}) {
      const job = jobs.get(key(game, doc));
      if (!job) return;
      job.state = 'waiting';
      job.retryFailed = retryFailed || job.retryFailed || false;
      job.error = '';
      job.retryAt = 0;
      job.attempts = 0;
      void persist();
      notify();
      schedule();
    },
  };
}
