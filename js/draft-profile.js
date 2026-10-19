import { analyzePdf, indexMatches } from './pdf-index.js';
import { extendOcrIndex, ocrCoverage, needsCoverRecovery } from './pdf-knowledge.js';
import { cachedIndex, indexCacheKey } from './index-cache.js';
import { gameDocuments, documentGame } from './documents.js';
import { informationIdentity } from './information-identity.js';
import { profileUnavailable } from './profile-availability.js';
import { recontextualizeDraft } from './draft-reuse.js';
import { hasCompleteProfile } from './knowledge-model.js';
import { combinedProfileComplete } from './profile-facts.js';

export function createDraftProfile({ getRepository, getCurrent, getDocuments, onRecord = () => {}, onIndex = () => {}, onStatus = () => {} }) {
  let controller,
    flight,
    sequence = 0,
    context = '',
    delivered = '';
  const cacheKey = (uid, hash) => `draft-profile-index:${uid}:${hash}`;
  function cancel(clear = true) {
    ++sequence;
    controller?.abort();
    flight = null;
    context = '';
    if (clear) delivered = '';
  }
  async function prepare({ retry = false, cachedOnly = false, includePublic = false, research } = {}) {
    const repository = getRepository(),
      uid = repository.session.user?.uid;
    let current = structuredClone(getCurrent());
    const documents = getDocuments();
    if (!uid || !current || current.id || !repository.session.canWrite || !repository.draftKnowledge || !documents.length || documents.some((d) => !d.manual || !d.blob)) return;
    const health = repository.session.storageStatus;
    let identity = informationIdentity(current, uid, documents);
    if (repository.session.cacheReady === false) {
      onStatus('Aguardando a conexão para analisar a ficha…');
      return;
    }
    const key = `draft-profile-result:v1:${uid}:${documents
      .map((d) => d.manual.sha256)
      .sort()
      .join(':')}`;
    if (flight && context === identity) return flight;
    cancel(false);
    context = identity;
    const token = sequence,
      control = (controller = new AbortController());
    const active = () =>
      token === sequence &&
      repository.session.canWrite &&
      repository.session.user?.uid === uid &&
      informationIdentity(getCurrent(), uid, getDocuments()) === identity &&
      getCurrent()?.manual?.sha256 === current.manual.sha256 &&
      getDocuments()
        .map((d) => d.manual?.sha256)
        .sort()
        .join(':') ===
        documents
          .map((d) => d.manual.sha256)
          .sort()
          .join(':');
    const task = (async () => {
      const saved = await cachedIndex(key);
      if (!active()) return;
      const show = (record, origin) => {
        if (!active()) return;
        const rebound = { ...recontextualizeDraft(record, getCurrent(), documents), analysisOrigin: origin || record?.analysisOrigin || 'stored' };
        const game = { ...getCurrent(), documents: Object.fromEntries(documents.map((d) => [d.id, { ...d, blob: undefined }])) };
        const version = `${identity}:${record?.revision || record?.status}:${record?.knowledge?.generatedAt || ''}:${rebound.analysisOrigin}`;
        if (delivered !== version) {
          onRecord(rebound, game);
          delivered = version;
        }
        onStatus(rebound?.status === 'ready' ? '' : rebound?.status === 'running' ? 'Análise em andamento. Use Completar informações para conferir o resultado em instantes.' : rebound?.message || 'A análise está em andamento.');
      };
      const target = { ...current, documents: Object.fromEntries(documents.map((d) => [d.id, d])) };
      const cachedRecord = recontextualizeDraft(saved, target, documents);
      const readyCache = saved?.status === 'ready' && hasCompleteProfile(cachedRecord?.knowledge, target) && (!includePublic || combinedProfileComplete(cachedRecord.knowledge));
      let repairCover = false;
      if (retry && readyCache)
        for (const document of documents) {
          const existing = await cachedIndex(cacheKey(uid, document.manual.sha256));
          if (existing?.sourceHash === document.manual.sha256 && needsCoverRecovery(existing)) repairCover = true;
        }
      if (saved && (!retry || (readyCache && !repairCover))) {
        show(saved, 'local-cache');
        return saved;
      }
      if (cachedOnly) return;
      const compatibility = profileUnavailable(health, { draft: true, combined: includePublic });
      if (compatibility?.reason === 'server-update') {
        if (saved) show(saved, 'local-cache');
        onStatus(compatibility.message);
        return { status: 'server_update', message: compatibility.message, knowledge: cachedRecord?.knowledge || null };
      }
      const prepared = [];
      for (const document of documents) {
        control.signal.throwIfAborted();
        const game = { id: `draft:${uid}`, documentId: document.id, manual: document.manual, language: document.language };
        let index = await cachedIndex(cacheKey(uid, document.manual.sha256));
        if (index?.sourceHash === document.manual.sha256) index = { ...index, gameId: game.id, documentId: document.id };
        const checkpoint = async (value) => {
          control.signal.throwIfAborted();
          if (active()) await cachedIndex(cacheKey(uid, document.manual.sha256), value);
        };
        onStatus(`Lendo ${document.name || document.manual.name}…`);
        if (!indexMatches(index, game) || index.analysisComplete === false)
          index = await analyzePdf(document.blob, game, {
            signal: control.signal,
            previous: index,
            checkpoint,
            onProgress: (p) => {
              if (active()) onStatus(`Lendo manual · ${p.current} de ${p.total} páginas`);
            },
          });
        if (ocrCoverage(index).pending || (retry && needsCoverRecovery(index)))
          index = await extendOcrIndex(document.blob, game, index, {
            coverRecovery: retry,
            signal: control.signal,
            checkpoint,
            onProgress: () => {
              if (active()) onStatus('Reconhecendo as páginas escaneadas…');
            },
          });
        await checkpoint(index);
        if (active()) {
          onIndex(index, document);
          // A consolidação síncrona do próprio índice pode completar título/edição.
          // Incorpora esses fatos antes da requisição. Edições externas durante os
          // awaits continuam invalidando active() e nunca recebem respostas antigas.
          if (token === sequence) {
            const updated = getCurrent();
            current = { ...current, title: updated?.title, edition: updated?.edition || '', gameType: updated?.gameType || '' };
            identity = informationIdentity(current, uid, documents);
            context = identity;
          }
        }
        prepared.push({
          id: document.id,
          hash: document.manual.sha256,
          name: (document.name || document.manual.name).slice(0, 160),
          language: document.language,
          documentType: document.documentType || 'principal',
          edition: document.edition || '',
          pages: index.pages.map((p) => ({ page: p.page, text: p.text })),
        });
      }
      if (!active()) return;
      if (readyCache && repairCover && hasCompleteProfile(recontextualizeDraft(saved, getCurrent(), documents)?.knowledge, { ...getCurrent(), documents: target.documents })) {
        show(saved, 'local-cache');
        onStatus('Análise salva reutilizada. Os dados da capa foram conferidos localmente, sem nova geração de IA.');
        return saved;
      }
      const unavailable = profileUnavailable(health, { draft: true, combined: includePublic });
      if (unavailable) {
        onStatus(unavailable.message);
        return;
      }
      onStatus('Completando a ficha com IA… Esta análise utiliza a cota.');
      const record = await repository.draftKnowledge(
        { title: current.title, edition: current.edition || '', gameType: current.gameType || '', documents: prepared, requestId: crypto.randomUUID(), retry, ...(includePublic ? { includePublic: true, ...(research ? { research } : {}) } : {}) },
        { signal: control.signal },
      );
      if (!active()) return;
      if (!['identity_changed', 'evidence_changed'].includes(record?.status)) await cachedIndex(key, record);
      show(record);
      return record;
    })()
      .catch(async (error) => {
        if (active() && error.name !== 'AbortError') {
          const record = error.record || { status: 'attention', message: error.message, knowledge: null };
          await cachedIndex(key, record);
          onStatus(error.message);
        }
      })
      .finally(() => {
        if (flight === task) flight = null;
      });
    flight = task;
    return task;
  }
  return {
    prepare,
    cancel,
    async seedIndexes(game) {
      const repo = getRepository(),
        uid = repo.session.user?.uid;
      const documents = gameDocuments(game),
        indexes = [];
      for (const d of documents) {
        const index = await cachedIndex(cacheKey(uid, d.manual.sha256));
        if (index?.sourceHash === d.manual.sha256 && repo.session.canWrite) {
          await cachedIndex(indexCacheKey(repo.session.storageStatus?.firebaseProject || repo.projectId || 'manual-de-boardgame', uid, documentGame(game, d)), { ...index, gameId: game.id, documentId: d.id });
          indexes.push({ document: d, index: { ...index, gameId: game.id, documentId: d.id } });
        }
      }
      if (repo.mode !== 'firebase' || !repo.session.canWrite || !repo.canPrepare?.(game) || !repo.saveTechnicalIndex || !repo.generateKnowledge || indexes.length !== documents.length) return;
      const record = await cachedIndex(
        `draft-profile-result:v1:${uid}:${documents
          .map((d) => d.manual.sha256)
          .sort()
          .join(':')}`,
      );
      if (record?.status !== 'ready' || !recontextualizeDraft(record, game, documents)?.knowledge) return;
      try {
        for (const { document, index } of indexes) {
          if (repo.session.user?.uid !== uid || !repo.session.canWrite) return;
          const coverage = ocrCoverage(index);
          await repo.saveTechnicalIndex(game, document, index, { state: coverage.failed || coverage.pending ? 'partial' : 'ready' });
        }
        if (repo.session.user?.uid !== uid || !repo.session.canWrite) return;
        const linked = await repo.generateKnowledge(game, { reuseOnly: true });
        if (linked?.status !== 'ready') return { warning: 'Jogo salvo. O conhecimento preparado ainda está sendo vinculado aos manuais.' };
        return { knowledgeReady: true };
      } catch {
        return { warning: 'Jogo salvo. A preparação continuará quando a conexão estiver disponível.' };
      }
    },
  };
}
