import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyFirebaseToken, base64url, permissions, sealTicket, openTicket } from '../src/auth.js';
import { belongsToProject, safeDriveSession, validateUpload, parseRange, requirePermission } from '../src/services.js';

const project = 'isolated-test',
  now = Date.now();
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'test-key' };
const defaults = { sub: 'test-owner', aud: project, iss: `https://securetoken.google.com/${project}`, exp: Math.floor(now / 1000) + 3600, iat: Math.floor(now / 1000), auth_time: Math.floor(now / 1000) };
async function token(claims = {}, header = {}) {
  const encode = (value) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const input = `${encode({ alg: 'RS256', kid: jwk.kid, ...header })}.${encode({ ...defaults, ...claims })}`;
  return `${input}.${base64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input))))}`;
}
const verify = (value) => verifyFirebaseToken(value, project, { now, cache: false, fetcher: async () => Response.json({ keys: [jwk] }) });
const denied = (status) => (error) => error.status === status;

test('JWT exige assinatura RSA válida e projeto, prazo e UID corretos', async () => {
  assert.equal((await verify(await token())).sub, 'test-owner');
  for (const claims of [{ aud: 'other-project' }, { iss: 'https://attacker.invalid' }, { exp: Math.floor(now / 1000) - 1 }, { iat: Math.floor(now / 1000) + 3600 }, { sub: '' }]) await assert.rejects(verify(await token(claims)), denied(401));
  await assert.rejects(verify(await token({}, { alg: 'none' })), denied(401));
  const valid = await token(),
    parts = valid.split('.');
  parts[1] = base64url(new TextEncoder().encode(JSON.stringify({ ...defaults, sub: 'attacker' })));
  await assert.rejects(verify(parts.join('.')), denied(401));
});
test('indisponibilidade das chaves não libera o acesso', async () => {
  await assert.rejects(verifyFirebaseToken(await token(), project, { cache: false, fetcher: async () => new Response(null, { status: 503 }) }), denied(503));
});
test('permissões exigem perfil ativo e flag específica; UID proprietário sozinho não basta', () => {
  assert.deepEqual(permissions(null, 'owner', 'owner'), { read: false, add: false, edit: false, delete: false });
  assert.deepEqual(permissions({ uid: 'owner', status: 'blocked', role: 'superadmin' }, 'owner', 'owner'), { read: false, add: false, edit: false, delete: false });
  assert.deepEqual(permissions({ uid: 'sub', status: 'approved', role: 'subadmin', permissions: { addGames: true, editGames: true, deleteGames: true } }, 'sub', 'owner'), { read: true, add: true, edit: true, delete: false });
  assert.deepEqual(permissions({ uid: 'sub', status: 'approved', role: 'superadmin', permissions: { deleteGames: true } }, 'sub', 'owner'), { read: false, add: false, edit: false, delete: false });
});
test('cada autorização consulta o perfil atual pelo JWT Firebase, inclusive após revogação', async () => {
  let enabled = true,
    count = 0;
  const fetcher = async (url, init) => {
    count++;
    assert.match(url, /users\/sub$/);
    assert.equal(init.headers.Authorization, 'Bearer firebase-session');
    return Response.json({ fields: { uid: { stringValue: 'sub' }, status: { stringValue: enabled ? 'approved' : 'blocked' }, role: { stringValue: 'subadmin' }, permissions: { mapValue: { fields: { addGames: { booleanValue: true } } } } } });
  };
  const env = { FIREBASE_PROJECT_ID: project, OWNER_UID: 'owner' },
    identity = { uid: 'sub', token: 'firebase-session' };
  await requirePermission(env, identity, 'add', fetcher);
  enabled = false;
  await assert.rejects(requirePermission(env, identity, 'add', fetcher), denied(403));
  assert.equal(count, 2);
});
test('tickets criptografados vinculam UID/tipo/prazo e rejeitam alteração ou chave diferente', async () => {
  const secret = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const payload = { uid: 'owner', type: 'upload', expires: Date.now() + 60000, sessionURL: 'https://private-session.invalid' };
  const sealed = await sealTicket(payload, secret);
  assert.ok(!sealed.includes(payload.sessionURL));
  assert.deepEqual(await openTicket(sealed, secret, 'owner', 'upload'), payload);
  for (const [uid, type] of [
    ['subadmin', 'upload'],
    ['owner', 'receipt'],
  ])
    await assert.rejects(openTicket(sealed, secret, uid, type), denied(403));
  const altered = sealed.slice(0, 25) + (sealed[25] === 'A' ? 'B' : 'A') + sealed.slice(26);
  await assert.rejects(openTicket(altered, secret, 'owner', 'upload'), denied(403));
  await assert.rejects(openTicket(sealed, base64url(new Uint8Array(32)), 'owner', 'upload'), denied(403));
  await assert.rejects(openTicket(await sealTicket({ ...payload, expires: Date.now() - 1 }, secret), secret, 'owner', 'upload'), denied(403));
});
test('escopo de arquivo exige dono, pasta, projeto, jogo, tipo e nonce', () => {
  const env = { FIREBASE_PROJECT_ID: project, DRIVE_FOLDER_ID: 'folder123', DRIVE_OWNER_EMAIL: 'owner@example.test' };
  const file = { id: 'file123', owners: [{ me: true, emailAddress: env.DRIVE_OWNER_EMAIL }], parents: [env.DRIVE_FOLDER_ID], appProperties: { acervoProject: project, gameId: 'game', kind: 'manual', uploadNonce: 'nonce' } };
  const context = { gameId: 'game', kind: 'manual', nonce: 'nonce' };
  assert.equal(belongsToProject(file, env, context), true);
  for (const changed of [
    { ...file, trashed: true },
    { ...file, owners: [{ me: true, emailAddress: 'other@example.test' }] },
    { ...file, parents: ['personal-folder'] },
    { ...file, appProperties: { ...file.appProperties, gameId: 'other' } },
    { ...file, appProperties: { ...file.appProperties, kind: 'cover' } },
    { ...file, appProperties: { ...file.appProperties, uploadNonce: 'other' } },
  ])
    assert.equal(belongsToProject(changed, env, context), false);
});
test('sessões Drive bloqueiam outros hosts, credenciais e caminhos para impedir SSRF', () => {
  assert.equal(safeDriveSession('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc'), 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc');
  for (const url of [
    'https://attacker.invalid/upload/drive/v3/files?uploadType=resumable&upload_id=abc',
    'https://www.googleapis.com.evil.test/upload/drive/v3/files?uploadType=resumable&upload_id=abc',
    'https://user:pass@www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc',
    'https://www.googleapis.com/drive/v3/files?uploadType=resumable&upload_id=abc',
    'http://localhost:80',
  ])
    assert.throws(() => safeDriveSession(url), denied(502));
});
test('tamanho, formato e blocos respeitam 50 MiB, 8 MiB e múltiplos de 256 KiB', () => {
  const input = { gameId: '12345678-1234-1234-1234-123456789abc', kind: 'manual', mimeType: 'application/pdf', size: 52428800, name: 'manual.pdf' };
  for (const size of [50 * 1024 * 1024 - 1, 52428800]) {
    for (const kind of ['manual', 'document']) assert.equal(validateUpload({ ...input, kind, documentId: 'main', sourceHash: 'a'.repeat(64), size }, 52428800).size, size);
  }
  assert.throws(() => validateUpload({ ...input, size: 52428801 }, 52428800), denied(413));
  assert.throws(() => validateUpload({ ...input, mimeType: 'text/html' }, 52428800), denied(400));
  assert.equal(parseRange('bytes 0-262143/300000', 300000, 262144).length, 262144);
  assert.equal(parseRange('bytes 262144-299999/300000', 300000, 37856).length, 37856);
  assert.deepEqual(parseRange('bytes */300000', 300000, 0), { probe: true });
  for (const [range, length] of [
    ['bytes 0-299998/300000', 299999],
    ['bytes 0-262143/300001', 262144],
    ['bytes 0-262143/300000', 100],
    ['bytes 0-9000000/10000000', 9000001],
  ])
    assert.throws(() => parseRange(range, 300000, length), denied(400));
});
