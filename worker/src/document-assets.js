import { gameDocuments, documentKind, findDocument, primaryDocumentId, withoutDocument } from '../../js/documents.js';
import { getDocument, firestoreURL, deleteProjectFile, requireProjectFile } from './services.js';
import { ApiError } from './auth.js';
function encoded(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encoded) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encoded(v)])) } };
}
export async function removeDocumentSafely(env, identity, gameId, documentId) {
  const path = `games/${gameId}/removals/${documentId}`;
  let pending = await getDocument(env, path, identity.token);
  const game = await getDocument(env, `games/${gameId}`, identity.token);
  if (!game) throw new ApiError(404, 'Jogo não encontrado.');
  const current = findDocument(game, documentId);
  if (game.deleting === true && !pending) throw new ApiError(409, 'Este jogo está sendo excluído. Nenhum documento adicional foi removido.');
  if (pending && current) throw new ApiError(409, 'Este documento foi cadastrado novamente. A limpeza foi interrompida para protegê-lo.');
  if (!pending && !current) return { ok: true };
  if (!pending && (gameDocuments(game).length < 2 || primaryDocumentId(game) === documentId)) throw new ApiError(409, 'Escolha outro manual principal antes de remover este documento.');
  const index = await getDocument(env, `games/${gameId}/indexes/${documentId}`, identity.token);
  const doc = pending?.document || current;
  const indexFileId = pending?.indexFileId ?? index?.fileId ?? '';
  const indexSourceHash = pending?.indexSourceHash ?? index?.sourceHash ?? '';
  if (pending && index?.fileId && index.fileId !== indexFileId) throw new ApiError(409, 'O índice mudou. Nenhum arquivo adicional foi removido.');
  const references = [
    [doc.manual.driveFileId, { gameId, kind: documentKind(doc), ...(documentKind(doc) === 'manual' ? {} : { documentId, sourceHash: doc.manual.sha256 }) }],
    [indexFileId, { gameId, kind: 'documentIndex', documentId, sourceHash: indexSourceHash }],
  ];
  for (const [id, context] of references)
    if (id) {
      try {
        await requireProjectFile(env, id, { ...context, allowTrashed: true });
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }
  // A exclusão física só começa depois da confirmação atômica no Firestore.
  if (!pending) {
    const next = withoutDocument(game, documentId),
      root = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    pending = { gameId, documentId, document: doc, indexFileId, indexSourceHash, removedBy: identity.uid };
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            update: { name: `${root}/games/${gameId}`, fields: { documents: encoded(next.documents), documentChanges: encoded([]) } },
            updateMask: { fieldPaths: ['documents', 'documentChanges'] },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            currentDocument: { updateTime: game._updateTime },
          },
          { update: { name: `${root}/${path}`, fields: encoded(pending).mapValue.fields }, currentDocument: { exists: false } },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new ApiError(response.status === 409 || response.status === 412 ? 409 : response.status === 403 ? 403 : 503, 'Não foi possível confirmar a remoção. Nenhum PDF foi excluído; tente novamente.');
  }
  const latest = await getDocument(env, `games/${gameId}`, identity.token);
  if (!latest || gameDocuments(latest).some((d) => d.id === documentId || d.manual.driveFileId === doc.manual.driveFileId)) throw new ApiError(409, 'O cadastro mudou. A limpeza foi interrompida para proteger os documentos.');
  for (const [id, context] of references) if (id) await deleteProjectFile(env, id, context);
  const indexResponse = await fetch(firestoreURL(env, `games/${gameId}/indexes/${documentId}`), { method: 'DELETE', headers: { Authorization: `Bearer ${identity.token}` } });
  if (!indexResponse.ok && indexResponse.status !== 404) throw new ApiError(503, 'O documento foi removido do jogo. A limpeza pendente pode ser retomada.');
  const response = await fetch(firestoreURL(env, path), { method: 'DELETE', headers: { Authorization: `Bearer ${identity.token}` } });
  if (!response.ok && response.status !== 404) throw new ApiError(503, 'O documento foi removido. Confirme a conclusão da limpeza pendente.');
  return { ok: true };
}
export async function cleanupDocuments(env, identity, game) {
  const docs = gameDocuments(game),
    path = `documentDeletion/${game.id}`;
  const previous = await getDocument(env, path, identity.token);
  const start = previous?.done || 0,
    end = Math.min(start + 2, docs.length);
  for (const doc of docs.slice(start, end)) {
    const index = await getDocument(env, `games/${game.id}/indexes/${doc.id}`, identity.token);
    for (const [fileId, context] of [
      [doc.manual.driveFileId, { gameId: game.id, kind: documentKind(doc), ...(documentKind(doc) === 'manual' ? {} : { documentId: doc.id, sourceHash: doc.manual.sha256 }) }],
      [index?.fileId, { gameId: game.id, kind: 'documentIndex', documentId: doc.id, sourceHash: index?.sourceHash }],
    ])
      if (fileId) {
        try {
          await deleteProjectFile(env, fileId, context);
        } catch (e) {
          if (![400, 403].includes(e.status)) throw e;
        }
      }
    const response = await fetch(firestoreURL(env, `games/${game.id}/indexes/${doc.id}`), { method: 'DELETE', headers: { Authorization: `Bearer ${identity.token}` } });
    if (!response.ok && response.status !== 404) throw new ApiError(503, 'A limpeza dos documentos precisa continuar.');
  }
  if (end < docs.length) {
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          { update: { name: `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`, fields: { done: { integerValue: String(end) } } }, currentDocument: previous ? { updateTime: previous._updateTime } : { exists: false } },
        ],
      }),
    });
    if (!response.ok) throw new ApiError(409, 'A exclusão foi atualizada em outra sessão. Tente novamente.');
    return { pending: true, remaining: docs.length - end };
  }
  if (previous) {
    const response = await fetch(firestoreURL(env, path), { method: 'DELETE', headers: { Authorization: `Bearer ${identity.token}` } });
    if (!response.ok && response.status !== 404) throw new ApiError(503, 'A limpeza precisa continuar.');
  }
  return { pending: false };
}
