import { ApiError, permissions } from './auth.js';
import { DRIVE_FOLDER_ID } from '../../js/permissions.js';

let oauthCache = null,
  refreshing = null;
export function decodeValue(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value || 'doubleValue' in value) return Number(value.integerValue ?? value.doubleValue);
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  return null;
}
export function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}
export function firestoreURL(env, path) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/${path}`;
}
export async function getDocument(env, path, token = '', fetcher = fetch) {
  const response = await fetcher(firestoreURL(env, path), { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return null;
  if (response.status === 403 || response.status === 401) throw new ApiError(403, 'Você não tem acesso a este conteúdo.');
  if (!response.ok) throw new ApiError(503, 'O Firestore não respondeu. Tente novamente.');
  const data = await response.json();
  return { ...decodeFields(data.fields || {}), _updateTime: data.updateTime };
}
export async function requirePermission(env, identity, action, fetcher = fetch) {
  if (!identity) throw new ApiError(401, 'Entre com a conta autorizada.');
  const profile = await getDocument(env, `users/${encodeURIComponent(identity.uid)}`, identity.token, fetcher);
  if (!permissions(profile, identity.uid, env.OWNER_UID)[action]) throw new ApiError(403, 'Sua conta não tem permissão para esta operação.');
  return profile;
}
export async function driveToken(env, fetcher = fetch) {
  if (env.DRIVE_FOLDER_ID && env.DRIVE_FOLDER_ID !== DRIVE_FOLDER_ID) throw new ApiError(503, 'O armazenamento deve usar a pasta PDFs indicada pelo proprietário.');
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN || !env.DRIVE_FOLDER_ID || !env.DRIVE_OWNER_EMAIL) throw new ApiError(503, 'O Drive central ainda precisa ser conectado pelo proprietário.');
  if (oauthCache?.expires > Date.now() + 60000) return oauthCache.token;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new ApiError(503, 'A autorização do Drive central expirou ou foi revogada. O proprietário precisa reconectar a conta.');
    const data = await response.json();
    if (!data.access_token) throw new ApiError(503, 'O Google não retornou a autorização do Drive.');
    oauthCache = { token: data.access_token, expires: Date.now() + Number(data.expires_in || 3600) * 1000 };
    return oauthCache.token;
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}
export function safeDriveSession(value) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://www.googleapis.com' || url.pathname !== '/upload/drive/v3/files' || url.searchParams.get('uploadType') !== 'resumable' || !url.searchParams.get('upload_id') || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new ApiError(502, 'O Google retornou uma sessão de upload inesperada.');
  }
}
export async function driveMetadata(env, id, fetcher = fetch) {
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(String(id))) throw new ApiError(400, 'Identificador de arquivo inválido.');
  const token = await driveToken(env, fetcher);
  const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,parents,appProperties,owners(emailAddress,me),trashed`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError(response.status === 429 || response.status === 403 ? 429 : 502, 'Não foi possível consultar o Drive central. Confira suas cotas e a autorização da pasta.');
  return response.json();
}
export function belongsToProject(file, env, { gameId, kind, nonce, allowTrashed = false } = {}) {
  const owner = file?.owners?.some((owner) => owner.me === true && owner.emailAddress?.toLowerCase() === env.DRIVE_OWNER_EMAIL.toLowerCase());
  return (
    !!file &&
    (allowTrashed || file.trashed !== true) &&
    owner &&
    file.appProperties?.acervoProject === env.FIREBASE_PROJECT_ID &&
    (kind === 'folder'
      ? file.id === env.DRIVE_FOLDER_ID && file.mimeType === 'application/vnd.google-apps.folder'
      : file.parents?.includes(env.DRIVE_FOLDER_ID) && file.appProperties?.gameId === gameId && file.appProperties?.kind === kind && (!nonce || file.appProperties?.uploadNonce === nonce))
  );
}
export async function requireProjectFile(env, id, context, fetcher = fetch) {
  const file = await driveMetadata(env, id, fetcher);
  if (!file) throw new ApiError(404, 'O arquivo não está disponível no Drive.');
  if (!belongsToProject(file, env, { ...context, allowTrashed: true })) throw new ApiError(403, 'O arquivo não pertence à pasta e ao jogo autorizados.');
  if (file.trashed === true && !context?.allowTrashed) throw new ApiError(410, 'Este arquivo foi removido para a lixeira do Google Drive.');
  return file;
}
export async function deleteProjectFile(env, id, context, fetcher = fetch) {
  if (!id) return;
  const file = await driveMetadata(env, id, fetcher);
  if (!file) return;
  if (!belongsToProject(file, env, { ...context, allowTrashed: true })) throw new ApiError(403, 'A exclusão de arquivos fora da pasta do projeto foi bloqueada.');
  // O proprietário já removeu o arquivo. Preservar a possibilidade de restauração na lixeira.
  if (file.trashed === true) return;
  const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await driveToken(env, fetcher)}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok && response.status !== 404) throw new ApiError(502, 'Não foi possível concluir a exclusão no Drive. Tente novamente.');
}
export function validateUpload(input, maxPdfBytes) {
  if (!/^[a-f0-9-]{36}$/i.test(input.gameId) || !['manual', 'cover'].includes(input.kind)) throw new ApiError(400, 'Jogo ou tipo de arquivo inválido.');
  const max = input.kind === 'manual' ? maxPdfBytes : 8 * 1024 * 1024;
  if (!Number.isInteger(input.size) || input.size < 1 || input.size > max || input.mimeType !== (input.kind === 'manual' ? 'application/pdf' : 'image/jpeg')) throw new ApiError(400, 'O arquivo tem tamanho ou formato não permitido.');
  const name = String(input.name || '')
    .replace(/[\r\n\x00-\x1f]/g, ' ')
    .trim()
    .slice(0, 160);
  if (!name) throw new ApiError(400, 'Informe o nome do arquivo.');
  return { ...input, name };
}
export function parseRange(value, size, bodySize) {
  if (value === `bytes */${size}` && bodySize === 0) return { probe: true };
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value || '');
  if (!match) throw new ApiError(400, 'Faixa de upload inválida.');
  const start = Number(match[1]),
    end = Number(match[2]),
    total = Number(match[3]),
    length = end - start + 1;
  if (!Number.isSafeInteger(start) || total !== size || start < 0 || end < start || end >= total || length > 8 * 1024 * 1024 || length !== bodySize || (end !== total - 1 && length % (256 * 1024) !== 0))
    throw new ApiError(400, 'O bloco de upload não corresponde ao arquivo.');
  return { start, end, length, probe: false };
}
