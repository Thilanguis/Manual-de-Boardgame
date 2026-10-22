import { MAX_PDF_BYTES } from '../../js/pdf-limits.js';
import { ApiError, permissions } from './auth.js';
import { DRIVE_FOLDER_ID } from '../../js/permissions.js';
import { driveError, driveResponseError } from './drive-errors.js';

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
  if (response.status === 429) throw new ApiError(429, 'A consulta atingiu o limite disponível. Tente novamente mais tarde.');
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
export function createDriveTokenProvider({ now = Date.now } = {}) {
  let state;
  return async function tokenFor(env, fetcher = fetch) {
    const simulated = env.FIREBASE_PROJECT_ID === 'demo-acervo' && env.LOCAL_SIMULATED_SERVICES === 'true' && env.DRIVE_FOLDER_ID === 'dev-acervo-folder';
    if (env.DRIVE_FOLDER_ID && env.DRIVE_FOLDER_ID !== DRIVE_FOLDER_ID && !simulated) throw driveError('drive/configuration');
    const credentials = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REFRESH_TOKEN, env.DRIVE_FOLDER_ID, env.DRIVE_OWNER_EMAIL];
    if (credentials.some((value) => !value)) throw driveError('drive/configuration');
    // Cache e falhas pertencem às credenciais atuais. Uma reconexão não herda a falha antiga.
    if (!state || credentials.some((value, i) => value !== state.credentials[i])) state = { credentials };
    const current = state;
    if (current.expires > now() + 60000) return current.token;
    if (current.retryAt > now()) throw current.failure;
    if (current.refreshing) return current.refreshing;
    current.refreshing = (async () => {
      let response;
      try {
        response = await fetcher('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' }),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw driveError('drive/unavailable');
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.error === 'invalid_grant') throw driveError('drive/oauth-expired');
        if (['invalid_client', 'unauthorized_client', 'invalid_scope'].includes(data.error)) throw driveError('drive/oauth-client');
        if (['access_denied', 'admin_policy_enforced'].includes(data.error)) throw driveError('drive/permission');
        throw driveError(response.status === 429 ? 'drive/rate-limit' : 'drive/unavailable');
      }
      if (typeof data.access_token !== 'string' || !data.access_token || !(Number(data.expires_in || 3600) > 0)) throw driveError('drive/unavailable');
      current.token = data.access_token;
      current.expires = now() + Number(data.expires_in || 3600) * 1000;
      current.failure = null;
      return current.token;
    })().catch((error) => {
      current.failure = error;
      current.retryAt = now() + error.retryAfter * 1000;
      throw error;
    });
    try {
      return await current.refreshing;
    } finally {
      current.refreshing = null;
    }
  };
}
export const driveToken = createDriveTokenProvider();
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
  const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,parents,appProperties,owners(emailAddress,me),trashed,permissions(type,role)`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  }).catch(() => {
    throw driveError('drive/unavailable');
  });
  if (response.status === 404) return null;
  if (!response.ok) throw await driveResponseError(response);
  return response.json();
}
export function belongsToProject(file, env, { gameId, kind, nonce, documentId, sourceHash, allowTrashed = false, allowPublic = false } = {}) {
  const owner = file?.owners?.some((owner) => owner.me === true && owner.emailAddress?.toLowerCase() === env.DRIVE_OWNER_EMAIL.toLowerCase());
  return (
    !!file &&
    (allowTrashed || file.trashed !== true) &&
    owner &&
    (allowPublic || !file.permissions?.some((permission) => ['anyone', 'domain'].includes(permission.type))) &&
    file.appProperties?.acervoProject === env.FIREBASE_PROJECT_ID &&
    (kind === 'folder'
      ? file.id === env.DRIVE_FOLDER_ID && file.mimeType === 'application/vnd.google-apps.folder'
      : file.parents?.includes(env.DRIVE_FOLDER_ID) &&
        file.appProperties?.gameId === gameId &&
        file.appProperties?.kind === kind &&
        (!nonce || file.appProperties?.uploadNonce === nonce) &&
        (!documentId || file.appProperties?.documentId === documentId) &&
        (!sourceHash || file.appProperties?.sourceHash === sourceHash))
  );
}
export async function requireProjectFile(env, id, context, fetcher = fetch) {
  const file = await driveMetadata(env, id, fetcher);
  if (!file) throw new ApiError(404, 'O arquivo não está disponível no Drive.');
  if (!context?.allowTrashed && file.permissions?.some((permission) => ['anyone', 'domain'].includes(permission.type))) throw new ApiError(403, 'O proprietário precisa remover o compartilhamento público deste arquivo no Drive.');
  if (!belongsToProject(file, env, { ...context, allowTrashed: true, allowPublic: context?.allowTrashed === true })) throw new ApiError(403, 'O arquivo não pertence à pasta e ao jogo autorizados.');
  if (file.trashed === true && !context?.allowTrashed) throw new ApiError(410, 'Este arquivo foi removido para a lixeira do Google Drive.');
  return file;
}
export async function deleteProjectFile(env, id, context, fetcher = fetch) {
  if (!id) return;
  const file = await driveMetadata(env, id, fetcher);
  if (!file) return;
  if (!belongsToProject(file, env, { ...context, allowTrashed: true, allowPublic: true })) throw new ApiError(403, 'A exclusão de arquivos fora da pasta do projeto foi bloqueada.');
  // O proprietário já removeu o arquivo. Preservar a possibilidade de restauração na lixeira.
  if (file.trashed === true) return;
  const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await driveToken(env, fetcher)}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok && response.status !== 404) throw new ApiError(502, 'Não foi possível concluir a exclusão no Drive. Tente novamente.');
}
export function validateUpload(input, maxPdfBytes) {
  if (!/^[a-f0-9-]{36}$/i.test(input.gameId) || !['manual', 'cover', 'guideAsset', 'document', 'documentIndex'].includes(input.kind)) throw new ApiError(400, 'Jogo ou tipo de arquivo inválido.');
  const max = ['manual', 'document'].includes(input.kind) ? Math.min(MAX_PDF_BYTES, maxPdfBytes || MAX_PDF_BYTES) : 8 * 1024 * 1024;
  const mimeTypes = input.kind === 'guideAsset' ? ['image/jpeg', 'application/gzip'] : input.kind === 'documentIndex' ? ['application/gzip'] : [['manual', 'document'].includes(input.kind) ? 'application/pdf' : 'image/jpeg'];
  if (['document', 'documentIndex'].includes(input.kind) && (!/^(main|[a-f0-9-]{36})$/.test(input.documentId || '') || !/^[a-f0-9]{64}$/.test(input.sourceHash || ''))) throw new ApiError(400, 'Documento ou versão inválidos.');
  if (!Number.isInteger(input.size) || input.size < 1) throw new ApiError(400, 'O tamanho do arquivo é inválido.');
  if (!mimeTypes.includes(input.mimeType)) throw new ApiError(400, 'O formato deste arquivo não é permitido.');
  if (input.size > max) throw new ApiError(413, `Este arquivo ultrapassa o limite de ${max / 1024 / 1024} MiB permitido pelo servidor.`);
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
