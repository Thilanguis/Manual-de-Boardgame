// Serviços simulados em processo isolado; nenhum arquivo ou token real é usado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/index.js';
import { base64url, openTicket } from '../src/auth.js';

const id = '12345678-1234-1234-1234-123456789abc';
const env = {
  FIREBASE_PROJECT_ID: 'isolated-api-test',
  OWNER_UID: 'owner',
  ALLOWED_ORIGINS: 'https://site.example.test',
  MAX_PDF_BYTES: '52428800',
  GOOGLE_CLIENT_ID: 'fake-client',
  GOOGLE_CLIENT_SECRET: 'fake-secret',
  GOOGLE_REFRESH_TOKEN: 'fake-refresh',
  DRIVE_FOLDER_ID: 'folder123',
  DRIVE_OWNER_EMAIL: 'owner@example.test',
  TICKET_KEY: base64url(crypto.getRandomValues(new Uint8Array(32))),
};
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'api-test-key' };
const seconds = Math.floor(Date.now() / 1000),
  encode = (value) => base64url(new TextEncoder().encode(JSON.stringify(value)));
const unsigned = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode({ sub: 'owner', aud: env.FIREBASE_PROJECT_ID, iss: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`, exp: seconds + 3600, iat: seconds, auth_time: seconds })}`;
const jwt = `${unsigned}.${base64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned))))}`;
function value(data) {
  if (typeof data === 'boolean') return { booleanValue: data };
  if (typeof data === 'number') return { integerValue: String(data) };
  if (typeof data === 'string') return { stringValue: data };
  if (data === null) return { nullValue: null };
  if (Array.isArray(data)) return { arrayValue: { values: data.map(value) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(data).map(([key, val]) => [key, value(val)])) } };
}
const owned = (fileId, kind = 'manual') => ({
  id: fileId,
  name: kind === 'manual' ? 'manual.pdf' : 'capa.jpg',
  mimeType: kind === 'manual' ? 'application/pdf' : 'image/jpeg',
  size: '262147',
  owners: [{ me: true, emailAddress: env.DRIVE_OWNER_EMAIL }],
  parents: [env.DRIVE_FOLDER_ID],
  appProperties: { acervoProject: env.FIREBASE_PROJECT_ID, gameId: id, kind },
});
function services(options = {}) {
  const calls = [],
    files = new Map([
      ['manual123', owned('manual123')],
      ['cover123', owned('cover123', 'cover')],
    ]);
  let game = options.noGame ? null : { deleting: false, isPublic: true, manual: { driveFileId: 'manual123' }, cover: { driveFileId: 'cover123' } },
    upload,
    received = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    calls.push({ url, ...init });
    if (url.includes('/jwk/')) return Response.json({ keys: [jwk] });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'fake-owner-access', expires_in: 3600 });
    if (url.includes('/documents/admins/owner')) return Response.json({ fields: value({ enabled: options.enabled !== false, role: 'admin' }).mapValue.fields });
    if (url.includes('/documents:commit')) {
      if (options.conflict) return Response.json({ error: 'ABORTED' }, { status: 409 });
      const body = JSON.parse(init.body);
      assert.equal(body.writes[0].currentDocument.updateTime, '2026-10-14T00:00:00Z');
      assert.deepEqual(body.writes[0].updateMask.fieldPaths, ['deleting', 'deleteRequestedBy']);
      game = { ...game, deleting: true, deleteRequestedBy: 'owner' };
      return Response.json({ writeResults: [{}] });
    }
    if (url.includes(`/documents/games/${id}`)) {
      if (init.method === 'DELETE') {
        assert.match(url, /currentDocument.updateTime=/);
        game = null;
        return new Response(null, { status: 204 });
      }
      if (options.privateRead && !init.headers?.Authorization) return new Response(null, { status: 403 });
      return game ? Response.json({ fields: value(game).mapValue.fields, updateTime: '2026-10-14T00:00:00Z' }) : new Response(null, { status: 404 });
    }
    if (url.includes('/upload/drive/v3/files') && init.method === 'POST') {
      upload = { ...JSON.parse(init.body), id: 'uploaded123', size: '262147', owners: [{ me: true, emailAddress: env.DRIVE_OWNER_EMAIL }] };
      assert.equal(init.headers.Authorization, 'Bearer fake-owner-access');
      return new Response(null, { status: 200, headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test' } });
    }
    if (url.includes('upload_id=test') && init.method === 'PUT') {
      const bytes = init.body ? new Uint8Array(await new Response(init.body).arrayBuffer()) : new Uint8Array();
      assert.equal(bytes.length, Number(init.headers['Content-Length']));
      received += bytes.length;
      if (received < 262147) return new Response(null, { status: 308, headers: received ? { Range: `bytes=0-${received - 1}` } : {} });
      files.set(upload.id, upload);
      return Response.json(upload);
    }
    if (url.includes(`/drive/v3/files/${env.DRIVE_FOLDER_ID}`))
      return Response.json({ id: env.DRIVE_FOLDER_ID, mimeType: 'application/vnd.google-apps.folder', owners: [{ me: true, emailAddress: env.DRIVE_OWNER_EMAIL }], appProperties: { acervoProject: env.FIREBASE_PROJECT_ID } });
    const fileId = /\/drive\/v3\/files\/([^?]+)/.exec(url)?.[1];
    if (fileId) {
      const file = files.get(fileId);
      if (!file) return new Response(null, { status: 404 });
      if (init.method === 'DELETE') {
        if (options.deleteFailure) return new Response(null, { status: 503 });
        files.delete(fileId);
        return new Response(null, { status: 204 });
      }
      if (url.includes('alt=media')) {
        assert.equal(init.headers.Authorization, 'Bearer fake-owner-access');
        return new Response('%PDF-test', { status: init.headers.Range ? 206 : 200, headers: { 'Content-Length': '9', ...(init.headers.Range ? { 'Content-Range': 'bytes 0-8/9' } : {}) } });
      }
      return Response.json(file);
    }
    throw new Error(`Unexpected test URL: ${url}`);
  };
  return {
    calls,
    files,
    get game() {
      return game;
    },
    set game(val) {
      game = val;
    },
    restore() {
      globalThis.fetch = oldFetch;
    },
  };
}
function request(path, { method = 'GET', auth = true, json, body, headers = {} } = {}) {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: { Origin: 'https://site.example.test', ...(auth ? { Authorization: `Bearer ${jwt}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json ? JSON.stringify(json) : body,
  });
}
async function isolated(options, run) {
  const fixture = services(options);
  try {
    await run(fixture);
  } finally {
    fixture.restore();
  }
}
test('CORS e ausência de autenticação bloqueiam mutações sem tocar no Drive', async () =>
  isolated({}, async (s) => {
    assert.equal((await handleRequest(new Request('https://api.example.test/v1/uploads', { method: 'POST', headers: { Origin: 'https://evil.example.test' } }), env)).status, 403);
    const r = await handleRequest(request('/v1/uploads', { method: 'POST', auth: false, json: { gameId: id, kind: 'manual', size: 10, mimeType: 'application/pdf', name: 'manual.pdf' } }), env);
    assert.equal(r.status, 401);
    assert.equal(
      s.calls.some((call) => call.url.includes('/drive/')),
      false,
    );
  }));
test('perfil revogado bloqueia exclusão mesmo com JWT válido', async () =>
  isolated({ enabled: false }, async (s) => {
    assert.equal((await handleRequest(request(`/v1/games/${id}`, { method: 'DELETE' }), env)).status, 403);
    assert.equal(
      s.calls.some((call) => call.method === 'DELETE'),
      false,
    );
  }));
test('leitura pública usa autorização Firestore e Range sem expor OAuth', async () =>
  isolated({}, async (s) => {
    const response = await handleRequest(request(`/v1/games/${id}/manual`, { auth: false, headers: { Range: 'bytes=0-8' } }), env);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), 'bytes 0-8/9');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://site.example.test');
    assert.equal(response.headers.get('Authorization'), null);
    assert.equal(await response.text(), '%PDF-test');
    assert.equal(s.calls.find((call) => call.url.includes('/documents/games/')).headers.Authorization, undefined);
  }));
test('arquivo privado negado pelo Firestore não gera leitura Drive', async () =>
  isolated({ privateRead: true }, async (s) => {
    assert.equal((await handleRequest(request(`/v1/games/${id}/manual`, { auth: false }), env)).status, 403);
    assert.equal(
      s.calls.some((call) => call.url.includes('/drive/')),
      false,
    );
  }));
test('referência adulterada não permite ler outro jogo ou documento pessoal', async () =>
  isolated({}, async (s) => {
    s.files.get('manual123').parents = ['personal-folder'];
    assert.equal((await handleRequest(request(`/v1/games/${id}/manual`, { auth: false }), env)).status, 403);
    assert.equal(
      s.calls.some((call) => call.url.includes('alt=media')),
      false,
    );
  }));
test('exclusão aplica CAS antes de remover qualquer PDF ou capa', async () =>
  isolated({}, async (s) => {
    assert.equal((await handleRequest(request(`/v1/games/${id}`, { method: 'DELETE' }), env)).status, 200);
    const lockIndex = s.calls.findIndex((call) => call.url.includes('/documents:commit'));
    const deleteIndex = s.calls.findIndex((call) => call.method === 'DELETE' && call.url.includes('/drive/'));
    assert.ok(lockIndex >= 0 && lockIndex < deleteIndex);
    assert.equal(s.game, null);
    assert.equal(s.files.size, 0);
  }));
test('conflito de versão interrompe exclusão e preserva todos os arquivos', async () =>
  isolated({ conflict: true }, async (s) => {
    assert.equal((await handleRequest(request(`/v1/games/${id}`, { method: 'DELETE' }), env)).status, 409);
    assert.equal(
      s.calls.some((call) => call.method === 'DELETE'),
      false,
    );
    assert.equal(s.files.size, 2);
    assert.equal(s.game.deleting, false);
  }));
test('falha de exclusão preserva marca pendente e impede leitura e novos uploads', async () =>
  isolated({ deleteFailure: true }, async (s) => {
    assert.equal((await handleRequest(request(`/v1/games/${id}`, { method: 'DELETE' }), env)).status, 502);
    assert.equal(s.game.deleting, true);
    assert.equal((await handleRequest(request(`/v1/games/${id}/manual`, { auth: false }), env)).status, 410);
    assert.equal((await handleRequest(request('/v1/uploads', { method: 'POST', json: { gameId: id, kind: 'manual', size: 10, mimeType: 'application/pdf', name: 'manual.pdf' } }), env)).status, 409);
  }));
test('upload retomável usa OAuth proprietário e só remove arquivo anterior após vínculo salvo', async () =>
  isolated({}, async (s) => {
    const start = await handleRequest(request('/v1/uploads', { method: 'POST', json: { gameId: id, kind: 'manual', size: 262147, mimeType: 'application/pdf', name: 'novo.pdf' } }), env);
    assert.equal(start.status, 200);
    const { ticket } = await start.json();
    assert.equal((await openTicket(ticket, env.TICKET_KEY, 'owner', 'upload')).oldFileId, 'manual123');
    const chunk = await handleRequest(request('/v1/uploads/chunk', { method: 'PUT', headers: { 'X-Upload-Ticket': ticket, 'Content-Range': 'bytes 0-262143/262147', 'Content-Length': '262144' }, body: new Uint8Array(262144) }), env);
    assert.equal((await chunk.json()).received, 262144);
    const probe = await handleRequest(request('/v1/uploads/status', { method: 'POST', headers: { 'X-Upload-Ticket': ticket } }), env);
    assert.equal((await probe.json()).received, 262144);
    const final = await handleRequest(request('/v1/uploads/chunk', { method: 'PUT', headers: { 'X-Upload-Ticket': ticket, 'Content-Range': 'bytes 262144-262146/262147', 'Content-Length': '3' }, body: new Uint8Array(3) }), env);
    const completed = await final.json();
    assert.equal(completed.complete, true);
    const finish = () => handleRequest(request('/v1/uploads/finalize', { method: 'POST', json: { receipt: completed.receipt } }), env);
    assert.equal((await finish()).status, 409);
    assert.equal(s.files.has('manual123'), true);
    s.game.manual.driveFileId = completed.driveFileId;
    assert.equal((await handleRequest(request('/v1/uploads/discard', { method: 'POST', json: { receipt: completed.receipt } }), env)).status, 409);
    assert.equal((await finish()).status, 200);
    assert.equal(s.files.has('manual123'), false);
    assert.equal(s.files.has(completed.driveFileId), true);
  }));
