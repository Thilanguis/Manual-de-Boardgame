import { gameDocuments } from './documents.js';
import { currentKnowledgeStatus } from './knowledge-status.js';

// Apenas acompanhamento de uma requisição já autorizada; não guarda autorização.
const repositories = new WeakMap();
export function observeKnowledge(repository, game, { onRecord, onError = () => {}, interval = 2500 } = {}) {
  let entries = repositories.get(repository);
  if (!entries) repositories.set(repository, (entries = new Map()));
  const uid = repository.session.user?.uid || '';
  const key = JSON.stringify([uid, game.id, game.title, game.edition, gameDocuments(game).map((d) => [d.id, d.manual.sha256, d.manual.driveFileId])]);
  let entry = entries.get(key);
  if (!entry) {
    entry = { clients: new Set(), controller: new AbortController(), flight: null, timer: null };
    entries.set(key, entry);
  }
  const client = { onRecord, onError };
  entry.clients.add(client);
  const active = () => entry.clients.size && !entry.controller.signal.aborted && repository.session.canRead && (repository.session.user?.uid || '') === uid;
  function accept(record) {
    if (!active()) return;
    record = currentKnowledgeStatus(record);
    clearTimeout(entry.timer);
    for (const c of entry.clients) c.onRecord?.(record);
    if (record?.status === 'running') entry.timer = setTimeout(() => void refresh(), interval);
  }
  function refresh() {
    if (!active()) return Promise.resolve();
    clearTimeout(entry.timer);
    if (entry.flight) return entry.flight;
    const task = Promise.resolve()
      .then(() => repository.getKnowledge?.(game, { signal: entry.controller.signal }))
      .then(accept)
      .catch((error) => {
        if (active()) for (const c of entry.clients) c.onError(error);
      })
      .finally(() => {
        if (entry.flight === task) entry.flight = null;
      });
    entry.flight = task;
    return task;
  }
  return {
    refresh,
    update: accept,
    close() {
      entry.clients.delete(client);
      if (!entry.clients.size) {
        clearTimeout(entry.timer);
        entry.controller.abort();
        if (entries.get(key) === entry) entries.delete(key);
      }
    },
  };
}
