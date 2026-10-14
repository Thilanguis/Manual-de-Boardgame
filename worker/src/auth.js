import { accessFor } from '../../js/permissions.js';
const keysURL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let cachedKeys = null;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export function decode64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new ApiError(401, 'Token inválido.');
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}
export async function verifyFirebaseToken(token, project, { fetcher = fetch, now = Date.now(), cache = true } = {}) {
  try {
    if (typeof token !== 'string' || token.length > 16384) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    const header = JSON.parse(new TextDecoder().decode(decode64(parts[0]))),
      claims = JSON.parse(new TextDecoder().decode(decode64(parts[1])));
    const seconds = Math.floor(now / 1000);
    if (
      header.alg !== 'RS256' ||
      typeof header.kid !== 'string' ||
      header.kid.length > 200 ||
      claims.aud !== project ||
      claims.iss !== `https://securetoken.google.com/${project}` ||
      !Number.isInteger(claims.exp) ||
      claims.exp <= seconds ||
      !Number.isInteger(claims.iat) ||
      claims.iat > seconds + 30 ||
      !Number.isInteger(claims.auth_time) ||
      claims.auth_time > seconds + 30 ||
      typeof claims.sub !== 'string' ||
      !claims.sub.length ||
      claims.sub.length > 128
    )
      throw new Error();
    let keys = cache ? cachedKeys : null;
    if (!keys || keys.expires <= now || (!keys.values.has(header.kid) && now - keys.fetchedAt > 60000)) {
      const response = await fetcher(keysURL, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new ApiError(503, 'Não foi possível verificar o login agora.');
      const data = await response.json();
      const maxAge = Math.min(21600, Math.max(60, Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1]) || 3600));
      keys = { values: new Map((data.keys || []).map((key) => [key.kid, key])), expires: now + maxAge * 1000, fetchedAt: now, imported: new Map() };
      if (cache) cachedKeys = keys;
    }
    const jwk = keys.values.get(header.kid);
    if (!jwk || jwk.kty !== 'RSA') throw new Error();
    let key = keys.imported.get(header.kid);
    if (!key) {
      key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      keys.imported.set(header.kid, key);
    }
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode64(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)))) throw new Error();
    return claims;
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) throw error;
    throw new ApiError(401, 'Sessão inválida ou expirada. Entre novamente.');
  }
}
export function bearer(request) {
  const header = request.headers.get('Authorization') || '';
  return /^Bearer ([^\s]+)$/i.exec(header)?.[1] || '';
}
export function permissions(profile, uid, ownerUid) {
  const rights = accessFor(profile, uid, ownerUid);
  return { add: rights.canAdd, edit: rights.canEdit, delete: rights.canDelete };
}
async function ticketKey(secret) {
  if (!secret) throw new ApiError(503, 'A API de arquivos ainda precisa ser configurada.');
  const bytes = decode64(secret);
  if (bytes.length !== 32) throw new ApiError(503, 'A chave de sessões da API é inválida.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealTicket(payload, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12)),
    key = await ticketKey(secret);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('acervo-drive-v1') }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return `${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}
export async function openTicket(value, secret, uid, type) {
  try {
    if (typeof value !== 'string' || value.length > 8192) throw new Error();
    const parts = value.split('.');
    if (parts.length !== 2) throw new Error();
    const decoded = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode64(parts[0]), additionalData: new TextEncoder().encode('acervo-drive-v1') }, await ticketKey(secret), decode64(parts[1]));
    const payload = JSON.parse(new TextDecoder().decode(decoded));
    if (payload.uid !== uid || payload.type !== type || !Number.isFinite(payload.expires) || payload.expires < Date.now()) throw new Error();
    return payload;
  } catch {
    throw new ApiError(403, 'A sessão de upload é inválida, foi alterada ou expirou.');
  }
}
