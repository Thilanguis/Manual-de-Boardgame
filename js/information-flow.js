import { observeKnowledge } from './knowledge-observer.js';
import { gameDocuments, documentGame, primaryDocumentId } from './documents.js';
import { informationIdentity, knowledgeMatchesIdentity } from './information-identity.js';
import { hasStructuredProfile } from './knowledge-model.js';
import { cachedIndex, indexCacheKey } from './index-cache.js';
import { pdfIndexCandidate } from './pdf-profile.js';
import { indexMatches } from './pdf-index.js';
import { profileUnavailable } from './profile-availability.js';

// Somente o comando Completar informações pode iniciar uma geração.
// A abertura lê o resultado existente; o acompanhamento compartilhado só dura
// enquanto o editor estiver aberto e houver uma geração em andamento.
export function createInformationFlow({ getRepository, getCurrent, canUse, draftProfile, onRecord, onStatus, onPdf = () => {}, scope, getDocuments = gameDocuments, observe = observeKnowledge }) {
  let observation,
    record,
    key = '',
    flight,
    loading,
    requested = false,
    commandEpoch = 0,
    epoch = 0;
  const signature = (game) => informationIdentity(game, getRepository().session.user?.uid, getDocuments(game));
  let pdfFlight;
  async function loadPdfFacts(game, localOnly = false) {
    if (pdfFlight) return pdfFlight;
    const repo = getRepository(),
      token = epoch,
      identity = signature(game);
    const doc = gameDocuments(game).find((d) => d.id === primaryDocumentId(game));
    if (!doc || doc.manual.sha256 !== game.manual?.sha256) return;
    const task = (async () => {
      const cacheKey = indexCacheKey(scope || repo.session.storageStatus?.firebaseProject || repo.projectId || 'local', repo.session.user?.uid, documentGame(game, doc));
      let index = await cachedIndex(cacheKey);
      let candidate = pdfIndexCandidate(index, game, doc);
      if (!indexMatches(index, documentGame(game, doc)) && !localOnly && repo.getTechnicalIndex) {
        index = await repo.getTechnicalIndex(game, doc);
        candidate = pdfIndexCandidate(index, game, doc);
        if (indexMatches(index, documentGame(game, doc)) && token === epoch && canUse() && signature(getCurrent()) === identity) await cachedIndex(cacheKey, index);
      }
      if (token === epoch && canUse() && signature(getCurrent()) === identity && candidate) onPdf(candidate);
    })()
      .catch((error) => {
        if (!localOnly && token === epoch && canUse() && signature(getCurrent()) === identity) onStatus('Não foi possível recuperar os fatos do PDF. ' + error.message);
      })
      .finally(() => {
        if (pdfFlight === task) pdfFlight = null;
      });
    pdfFlight = task;
    return task;
  }
  function stop(internal = false) {
    if (!internal) ++commandEpoch;
    ++epoch;
    observation?.close();
    observation = null;
    key = '';
    record = flight = loading = null;
    pdfFlight = null;
    requested = false;
    draftProfile.cancel();
  }
  async function load() {
    const game = getCurrent();
    if (!game || !canUse()) return;
    if (!game.id) return draftProfile.prepare({ cachedOnly: true });
    const next = signature(game);
    if (next === key && observation) return loading;
    stop(true);
    key = next;
    const token = epoch;
    observation = observe(getRepository(), structuredClone(game), {
      onRecord(value) {
        if (token !== epoch || !canUse()) return;
        if (signature(getCurrent()) !== next) {
          stop();
          return;
        }
        if (!knowledgeMatchesIdentity(value?.knowledge, getCurrent())) {
          record = { status: 'identity_changed', knowledge: null };
          onRecord(record, getCurrent());
          onStatus('A identificação mudou. Salve o título, a edição e os PDFs antes de solicitar outra análise.');
          return;
        }
        record = value;
        onRecord(value, getCurrent());
        onStatus(
          value?.status === 'running'
            ? 'Analisando os manuais… Esta análise utiliza a cota de IA.'
            : value?.message ||
                (value?.knowledge ? (hasStructuredProfile(value.knowledge, getCurrent()) ? 'Análise salva disponível.' : 'As regras estão salvas, mas a ficha precisa de uma nova análise. Completar informações usará a cota de IA.') : ''),
        );
      },
      onError(error) {
        if (token === epoch && canUse() && signature(getCurrent()) === next) onStatus(error.message);
      },
    });
    loading = Promise.all([observation.refresh(), loadPdfFacts(structuredClone(game), true)]);
    return loading;
  }
  async function complete() {
    if (flight) return flight;
    const command = commandEpoch;
    const task = (async () => {
      await load();
      if (!canUse() || command !== commandEpoch) return;
      let game = getCurrent();
      if (!game.id) return draftProfile.prepare({ retry: true });
      await loadPdfFacts(structuredClone(game));
      if (!canUse() || command !== commandEpoch) return;
      game = structuredClone(getCurrent());
      const token = epoch;
      const identity = signature(game);
      if (record?.status === 'running' || hasStructuredProfile(record?.knowledge, game)) return record;
      if (record?.status === 'identity_changed') return record;
      if (record?.status === 'quota' && record.retryAt > Date.now()) {
        onStatus(record.message || 'A cota da IA foi atingida. Somente fatos encontrados no PDF e nas fontes poderão ser preenchidos.');
        return record;
      }
      const health = getRepository().session.storageStatus;
      const unavailable = profileUnavailable(health);
      if (unavailable) {
        onStatus(unavailable.message);
        return;
      }
      onStatus(record?.knowledge ? 'Atualizando a ficha ausente com IA. Esta análise utiliza a cota; suas correções serão preservadas.' : 'Analisando os manuais… Esta análise utiliza a cota de IA.');
      requested = true;
      try {
        const result = await getRepository().generateKnowledge(game, {
          force: !!record?.knowledge || ['attention', 'quota'].includes(record?.status),
          expectedIdentity: { title: game.title, edition: game.edition || '', manualHash: game.manual.sha256, documents: getDocuments(game).map((d) => [d.id, d.manual?.sha256 || '']) },
        });
        if (token === epoch && canUse() && signature(getCurrent()) === identity) observation?.update(result);
        return result;
      } catch (error) {
        if (token === epoch && canUse() && signature(getCurrent()) === identity) {
          if (error.record) observation?.update(error.record);
          onStatus(error.message);
        }
      }
    })().finally(() => {
      if (flight === task) flight = null;
    });
    flight = task;
    return task;
  }
  return {
    load,
    complete,
    stop,
    invalidate() {
      if (key && signature(getCurrent()) !== key) stop();
    },
    prepared() {
      if (requested && record?.status === 'waiting_index' && !flight && canUse()) return complete();
    },
    isBusy: () => !!flight || record?.status === 'running',
  };
}
