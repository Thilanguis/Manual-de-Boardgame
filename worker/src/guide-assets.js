import { ApiError } from './auth.js';
import { getDocument, firestoreURL, deleteProjectFile } from './services.js';
// Limpeza retomável, em pequenos lotes para respeitar 50 subrequests no Workers Free.
export async function cleanupGuides(env, identity, id) {
  const path = `guideDeletion/${id}`,
    name = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  let checkpoint = await getDocument(env, path, identity.token);
  if (!checkpoint) {
    const draft = await getDocument(env, `guideDrafts/${id}`, identity.token),
      published = await getDocument(env, `gameGuides/${id}`, identity.token);
    const remaining = [...new Set([...Object.keys(draft?.assets || {}), ...Object.keys(published?.assets || {}), draft?.indexFileId, published?.indexFileId].filter(Boolean))];
    if (!draft && !published) return { pending: false, preserved: false };
    await save({ remaining, preserved: false }, { exists: false });
    checkpoint = await getDocument(env, path, identity.token);
  }
  const remaining = checkpoint.remaining || [],
    batch = remaining.slice(0, 8);
  let preserved = checkpoint.preserved === true;
  for (const fileId of batch) {
    try {
      await deleteProjectFile(env, fileId, { gameId: id, kind: 'guideAsset' });
    } catch (error) {
      if (error.status === 403 || error.status === 400) preserved = true;
      else throw error;
    }
  }
  const next = remaining.slice(batch.length);
  await save({ remaining: next, preserved }, { updateTime: checkpoint._updateTime });
  if (next.length) return { pending: true, remaining: next.length };
  for (const collection of ['guideDrafts', 'gameGuides', 'guideDeletion']) {
    const response = await fetch(firestoreURL(env, `${collection}/${id}`), { method: 'DELETE', headers: { Authorization: `Bearer ${identity.token}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok && response.status !== 404) throw new ApiError(503, 'A limpeza do guia não terminou. Repita a exclusão pendente.');
  }
  return { pending: false, preserved };
  async function save(data, precondition) {
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: [{ update: { name, fields: { remaining: { arrayValue: { values: data.remaining.map((stringValue) => ({ stringValue })) } }, preserved: { booleanValue: data.preserved } } }, currentDocument: precondition }] }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new ApiError(409, 'A limpeza do guia foi atualizada em outra sessão. Repita a exclusão.');
  }
}
