import { analyzePdf, indexMatches } from './pdf-index.js';
import { extendOcrIndex, ocrCoverage } from './pdf-knowledge.js';
import { cachedIndex, indexCacheKey } from './index-cache.js';
import { gameDocuments, documentGame } from './documents.js';
import { informationIdentity } from './information-identity.js';
import { profileUnavailable } from './profile-availability.js';

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
  async function prepare({ retry = false, cachedOnly = false } = {}) {
    const repository = getRepository(),
      current = structuredClone(getCurrent()),
      uid = repository.session.user?.uid;
    const documents = getDocuments();
    if (!uid || !current || current.id || !repository.session.canWrite || !repository.draftKnowledge || !documents.length || documents.some((d) => !d.manual || !d.blob)) return;
    const health = repository.session.storageStatus;
    const identity = informationIdentity(current, uid, documents);
    if (repository.session.cacheReady === false) {
      onStatus('Aguardando a conexão para analisar a ficha…');
      return;
    }
    const key = `draft-profile-result:v1:${uid}:${documents
      .map((d) => d.manual.sha256)
      .sort()
      .join(':')}`;
    if (flight && context === key) return flight;
    cancel(false);
    context = key;
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
      const show = (record) => {
        if (!active()) return;
        const rebound = record?.knowledge
          ? {
              ...record,
              knowledge: {
                ...record.knowledge,
                sources: record.knowledge.sources.map((s) => ({ ...s, documentId: documents.find((d) => d.manual.sha256 === s.sourceHash)?.id || s.documentId })),
                profile: Object.fromEntries(Object.entries(record.knowledge.profile || {}).map(([k, f]) => [k, { ...f, documentId: documents.find((d) => d.manual.sha256 === f.sourceHash)?.id || f.documentId }])),
              },
            }
          : record;
        const game = { ...getCurrent(), documents: Object.fromEntries(documents.map((d) => [d.id, { ...d, blob: undefined }])) };
        const version = `${key}:${record?.revision || record?.status}:${record?.knowledge?.generatedAt || ''}`;
        if (delivered !== version) {
          onRecord(rebound, game);
          delivered = version;
        }
        onStatus(
          record?.status === 'ready'
            ? 'Ficha analisada. Confira as informações.'
            : record?.status === 'running'
              ? 'Análise em andamento. Use Completar informações para conferir o resultado em instantes.'
              : record?.message || 'A análise está em andamento.',
        );
      };
      if (saved && (!retry || saved.status === 'ready')) {
        show(saved);
        return saved;
      }
      if (cachedOnly) return;
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
        if (ocrCoverage(index).pending)
          index = await extendOcrIndex(document.blob, game, index, {
            signal: control.signal,
            checkpoint,
            onProgress: () => {
              if (active()) onStatus('Reconhecendo as páginas escaneadas…');
            },
          });
        await checkpoint(index);
        if (active()) onIndex(index, document);
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
      const unavailable = profileUnavailable(health, { draft: true });
      if (unavailable) {
        onStatus(unavailable.message);
        return;
      }
      onStatus('Completando a ficha pelo manual…');
      const record = await repository.draftKnowledge({ title: current.title, edition: current.edition || '', documents: prepared, requestId: crypto.randomUUID(), retry }, { signal: control.signal });
      if (!active()) return;
      await cachedIndex(key, record);
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
      for (const d of gameDocuments(game)) {
        const index = await cachedIndex(cacheKey(uid, d.manual.sha256));
        if (index?.sourceHash === d.manual.sha256 && repo.session.canWrite)
          await cachedIndex(indexCacheKey(repo.session.storageStatus?.firebaseProject || repo.projectId || 'manual-de-boardgame', uid, documentGame(game, d)), { ...index, gameId: game.id, documentId: d.id });
      }
    },
  };
}
