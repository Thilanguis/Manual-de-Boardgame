// Serviços simulados em processo isolado; nenhum arquivo ou token real é usado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/index.js';
import { base64url, openTicket } from '../src/auth.js';
import { DRIVE_FOLDER_ID } from '../../js/permissions.js';

const id = '12345678-1234-1234-1234-123456789abc';
const env = {
  FIREBASE_PROJECT_ID: 'isolated-api-test',
  OWNER_UID: 'owner',
  ALLOWED_ORIGINS: 'https://site.example.test',
  MAX_PDF_BYTES: '52428800',
  GOOGLE_CLIENT_ID: 'fake-client',
  GOOGLE_CLIENT_SECRET: 'fake-secret',
  GOOGLE_REFRESH_TOKEN: 'fake-refresh',
  DRIVE_FOLDER_ID,
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
  const guides = new Map();
  if (options.guideAssets) {
    const assets = {};
    for (let i = 0; i < options.guideAssets; i++) {
      const assetId = `asset-${String(i).padStart(6, '0')}`;
      assets[assetId] = { mimeType: 'image/jpeg' };
      files.set(assetId, owned(assetId, 'guideAsset'));
    }
    guides.set(`guideDrafts/${id}`, { assets });
    if (!options.draftOnly) guides.set(`gameGuides/${id}`, { assets });
  }
  let game = options.noGame ? null : { id, deleting: false, isPublic: true, manual: { driveFileId: 'manual123' }, cover: { driveFileId: 'cover123' } },
    upload,
    received = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    calls.push({ url, ...init });
    if (url.includes('/jwk/')) return Response.json({ keys: [jwk] });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'fake-owner-access', expires_in: 3600 });
    if (url.includes('/documents/users/owner'))
      return Response.json({ fields: value({ uid: 'owner', status: options.enabled !== false ? 'approved' : 'blocked', role: options.role || 'superadmin', permissions: options.permissions || {} }).mapValue.fields });
    if (url.endsWith('/documents/settings/library')) return Response.json({ fields: value({ publicRead: options.publicRead !== false }).mapValue.fields });
    if (url.includes('/documents:commit')) {
      if (options.conflict) return Response.json({ error: 'ABORTED' }, { status: 409 });
      const body = JSON.parse(init.body);
      if (body.writes[0].delete) {
        assert.equal(body.writes[0].delete, `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/games/${id}`);
        assert.equal(body.writes[0].currentDocument.updateTime, '2026-10-14T00:00:00Z');
        game = null;
        return Response.json({ writeResults: [{}] });
      }
      if (body.writes[0].update.name.includes('/documentDeletion/')) {
        guides.set(`documentDeletion/${id}`, { done: Number(body.writes[0].update.fields.done.integerValue) });
        return Response.json({ writeResults: [{}] });
      }
      if (body.writes[0].update.name.includes('/guideDeletion/')) {
        const fields = body.writes[0].update.fields;
        guides.set(`guideDeletion/${id}`, { remaining: fields.remaining.arrayValue.values.map((v) => v.stringValue), preserved: fields.preserved.booleanValue });
        return Response.json({ writeResults: [{}] });
      }
      assert.equal(body.writes[0].currentDocument.updateTime, '2026-10-14T00:00:00Z');
      assert.deepEqual(body.writes[0].updateMask.fieldPaths, ['deleting', 'deleteRequestedBy']);
      game = { ...game, deleting: true, deleteRequestedBy: 'owner' };
      return Response.json({ writeResults: [{}] });
    }
    const guidePath = /\/documents\/((?:guideDrafts|gameGuides|guideDeletion|documentDeletion|gameResearch)\/[^?]+)/.exec(url)?.[1];
    if (guidePath) {
      if (init.method === 'DELETE') {
        guides.delete(guidePath);
        return new Response(null, { status: 204 });
      }
      if (guidePath.startsWith('guideDrafts') && !init.headers?.Authorization) return new Response(null, { status: 403 });
      const data = guides.get(guidePath);
      return data ? Response.json({ fields: value(data).mapValue.fields, updateTime: '2026-10-14T00:00:00Z' }) : new Response(null, { status: 404 });
    }
    const indexPath = /\/documents\/(games\/[^/]+\/indexes\/[^?]+)/.exec(url)?.[1];
    if (indexPath) {
      if (init.method === 'DELETE') {
        guides.delete(indexPath);
        return new Response(null, { status: 204 });
      }
      const index = guides.get(indexPath);
      return index ? Response.json({ fields: value(index).mapValue.fields, updateTime: '2026-10-14T00:00:00Z' }) : new Response(null, { status: 404 });
    }
    if (url.includes(`/documents/games/${id}`)) {
      if (init.method === 'DELETE') {
        assert.match(url, /currentDocument.updateTime=/);
        game = null;
        return new Response(null, { status: 204 });
      }
      if (options.privateRead) return new Response(null, { status: 403 });
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
      if (options.metadataFailure) return new Response(null, { status: 503 });
      return Response.json(file);
    }
    throw new Error(`Unexpected test URL: ${url}`);
  };
  return {
    calls,
    files,
    guides,
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

test('API inicia sessão Drive de até 50 MiB e recusa excesso antes de tocar no Drive', async () => {
  await isolated({}, async ({ calls }) => {
    for (const size of [52428799, 52428800]) {
      for (const kind of ['manual', 'document']) {
        const input = { gameId: id, kind, size, mimeType: 'application/pdf', name: 'grande.pdf', documentId: 'main', sourceHash: 'a'.repeat(64) };
        const response = await handleRequest(request('/v1/uploads', { method: 'POST', json: input }), env);
        assert.equal(response.status, 200, await response.clone().text());
        const ticket = await openTicket((await response.json()).ticket, env.TICKET_KEY, 'owner', 'upload');
        assert.equal(ticket.size, size);
        const driveCall = calls.filter((c) => c.url.includes('uploadType=resumable')).at(-1);
        assert.equal(driveCall.headers['X-Upload-Content-Length'], String(size));
      }
    }
    const before = calls.filter((c) => c.url.includes('googleapis.com/upload')).length;
    for (const kind of ['manual', 'document']) {
      const response = await handleRequest(request('/v1/uploads', { method: 'POST', json: { gameId: id, kind, size: 52428801, mimeType: 'application/pdf', name: 'grande.pdf', documentId: 'main', sourceHash: 'a'.repeat(64) } }), env);
      assert.equal(response.status, 413);
    }
    assert.equal(calls.filter((c) => c.url.includes('googleapis.com/upload')).length, before);
  });
});

test('chave configurada não autoriza envio de manuais sem consentimento do proprietário', async () => {
  await isolated({}, async ({ calls }) => {
    env.KNOWLEDGE_FROM_MANUAL = 'true';
    env.GEMINI_API_KEY = 'fixture-key';
    env.GAME_KNOWLEDGE = { idFromName: () => 'fixture', get: () => ({ fetch: async () => Response.json(null) }) };
    try {
      for (const method of ['GET', 'POST']) {
        const result = await handleRequest(request(`/v1/games/${id}/knowledge`, { method, ...(method === 'POST' ? { json: { requestId: crypto.randomUUID() } } : {}) }), env);
        assert.equal(result.status, 200);
        assert.equal((await result.json()).status, 'pending_authorization');
      }
      assert.equal(calls.filter((c) => /generativelanguage|drive\/v3/.test(c.url)).length, 0);
    } finally {
      delete env.KNOWLEDGE_FROM_MANUAL;
      delete env.GEMINI_API_KEY;
      delete env.GAME_KNOWLEDGE;
    }
  });
});

test('pesquisa exige JWT e perfil atual; disponibilidade fica restrita à conta aprovada', async () => {
  await isolated({}, async () => {
    const response = await handleRequest(request('/v1/research/sources'), env);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.sources.find((s) => s.id === 'wikidata').enabled, true);
    assert.equal(data.sources.find((s) => s.id === 'ludopedia').enabled, false);
    const denied = await handleRequest(request('/v1/research/wikidata', { method: 'POST', auth: false, json: { action: 'search', query: 'Catan', protocol: 2 } }), env);
    assert.equal(denied.status, 401);
  });
  await isolated({ enabled: false }, async ({ calls }) => {
    const response = await handleRequest(request('/v1/research/wikidata', { method: 'POST', json: { action: 'search', query: 'Catan', protocol: 2 } }), env);
    assert.equal(response.status, 403);
    assert(!calls.some((c) => c.url.includes('wikidata.org')));
  });
});
test('manual principal com SHA-256 conserva a versão do PDF até concluir o upload', async () => {
  for (const tamper of [false, true])
    await isolated({}, async (s) => {
      const sourceHash = 'a'.repeat(64);
      const start = await handleRequest(request('/v1/uploads', { method: 'POST', json: { gameId: id, kind: 'manual', sourceHash, size: 262147, mimeType: 'application/pdf', name: 'manual.pdf' } }), env);
      assert.equal(start.status, 200);
      const metadata = JSON.parse(s.calls.find((c) => c.url.includes('/upload/drive/v3/files') && c.method === 'POST').body);
      assert.equal(metadata.appProperties.sourceHash, sourceHash);
      assert.equal(metadata.appProperties.documentId, undefined);
      const { ticket } = await start.json();
      // Mantém a sessão válida, mas altera a versão que o Worker deverá conferir.
      if (tamper) {
        const original = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
          const response = await original(url, init);
          if (String(url).includes('upload_id=test') && response.ok) {
            const data = await response.json();
            data.appProperties.sourceHash = 'b'.repeat(64);
            return Response.json(data);
          }
          return response;
        };
      }
      const completed = await handleRequest(request('/v1/uploads/chunk', { method: 'PUT', headers: { 'X-Upload-Ticket': ticket, 'Content-Range': 'bytes 0-262146/262147', 'Content-Length': '262147' }, body: new Uint8Array(262147) }), env);
      assert.equal(completed.status, tamper ? 502 : 200);
      if (!tamper) assert.equal((await completed.json()).complete, true);
    });
});

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

test('conhecimento é privado; falta de chave não quebra leitura e leitor não gera IA', async () => {
  await isolated({}, async () => {
    assert.equal((await handleRequest(request(`/v1/games/${id}/knowledge`, { auth: false }), env)).status, 401);
    const result = await handleRequest(request(`/v1/games/${id}/knowledge`), env);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).status, 'pending_configuration');
  });
  await isolated({ enabled: false }, async () => assert.equal((await handleRequest(request(`/v1/games/${id}/knowledge`), env)).status, 403));
  await isolated({ role: 'user' }, async () => {
    assert.equal((await handleRequest(request(`/v1/games/${id}/knowledge`), env)).status, 200);
    assert.equal((await handleRequest(request(`/v1/games/${id}/knowledge`, { method: 'POST', json: { requestId: crypto.randomUUID() } }), env)).status, 403);
  });
  await isolated({ role: 'subadmin', permissions: { editGames: true } }, async () => assert.equal((await handleRequest(request(`/v1/games/${id}/knowledge`, { method: 'POST', json: { requestId: crypto.randomUUID() } }), env)).status, 200));
});
test('imagem publicada pode ser lida; imagem exclusiva de rascunho exige edição', async () => {
  await isolated({ guideAssets: 1 }, async () => {
    assert.equal((await handleRequest(request(`/v1/games/${id}/guide-assets/asset-000000`), env)).status, 200);
  });
  await isolated({ guideAssets: 1, draftOnly: true }, async (s) => {
    assert.equal((await handleRequest(request(`/v1/games/${id}/guide-assets/asset-000000`, { auth: false }), env)).status, 401);
    assert.equal(
      s.calls.some((call) => call.url.includes('alt=media')),
      false,
    );
    assert.equal((await handleRequest(request(`/v1/games/${id}/guide-assets/asset-000000`), env)).status, 200);
  });
});
test('imagem de outro jogo e imagem sem referência não vazam pelo guia', async () =>
  isolated({ guideAssets: 1 }, async (s) => {
    s.files.get('asset-000000').appProperties.gameId = 'another-game';
    assert.equal((await handleRequest(request(`/v1/games/${id}/guide-assets/asset-000000`), env)).status, 403);
    assert.equal((await handleRequest(request(`/v1/games/${id}/guide-assets/unknown-file`, { auth: false }), env)).status, 401);
    assert.equal(
      s.calls.some((call) => call.url.includes('alt=media')),
      false,
    );
  }));
test('exclusão de guia é retomável em lotes abaixo do limite de subrequests gratuitos', async () =>
  isolated({ guideAssets: 10 }, async (s) => {
    const first = await handleRequest(request(`/v1/games/${id}`, { method: 'DELETE' }), env);
    assert.equal(first.status, 202);
    assert.equal((await first.json()).remaining, 2);
    assert.equal(s.game.deleting, true);
    assert.ok(s.calls.length < 50);
    let final;
    do {
      final = await handleRequest(request(`/v1/games/${id}`, { method: 'DELETE' }), env);
    } while (final.status === 202);
    assert.equal(final.status, 200);
    assert.equal(s.game, null);
    assert.equal(s.files.size, 0);
    assert.equal(s.guides.size, 0);
  }));
test('índice gzip usa upload retomável privado e só fica legível após publicação', async () =>
  isolated({}, async (s) => {
    const start = await handleRequest(request('/v1/uploads', { method: 'POST', json: { gameId: id, kind: 'guideAsset', size: 262147, mimeType: 'application/gzip', name: 'indice.json.gz' } }), env);
    assert.equal(start.status, 200);
    const { ticket } = await start.json();
    const completed = await (
      await handleRequest(request('/v1/uploads/chunk', { method: 'PUT', headers: { 'X-Upload-Ticket': ticket, 'Content-Range': 'bytes 0-262146/262147', 'Content-Length': '262147' }, body: new Uint8Array(262147) }), env)
    ).json();
    assert.equal(completed.complete, true);
    const finalize = () => handleRequest(request('/v1/uploads/finalize', { method: 'POST', json: { receipt: completed.receipt } }), env);
    assert.equal((await finalize()).status, 409);
    const document = { assets: { [completed.driveFileId]: { mimeType: 'application/gzip' } } };
    s.guides.set(`guideDrafts/${id}`, document);
    assert.equal((await finalize()).status, 200);
    assert.equal(s.files.has('manual123'), true);
    assert.equal((await handleRequest(request(`/v1/games/${id}/guide-assets/${completed.driveFileId}`, { auth: false }), env)).status, 401);
    s.guides.set(`gameGuides/${id}`, document);
    const response = await handleRequest(request(`/v1/games/${id}/guide-assets/${completed.driveFileId}`), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/gzip');
  }));
test('perfil revogado bloqueia exclusão mesmo com JWT válido', async () =>
  isolated({ enabled: false }, async (s) => {
    assert.equal((await handleRequest(request(`/v1/games/${id}`, { method: 'DELETE' }), env)).status, 403);
    assert.equal(
      s.calls.some((call) => call.method === 'DELETE'),
      false,
    );
  }));
test('leitura aprovada usa autorização Firestore e Range sem expor OAuth', async () =>
  isolated({}, async (s) => {
    const response = await handleRequest(request(`/v1/games/${id}/manual`, { headers: { Range: 'bytes=0-8' } }), env);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), 'bytes 0-8/9');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://site.example.test');
    assert.equal(response.headers.get('Authorization'), null);
    assert.equal(await response.text(), '%PDF-test');
    assert.equal(s.calls.find((call) => call.url.includes('/documents/games/')).headers.Authorization, `Bearer ${jwt}`);
  }));
test('arquivo privado negado pelo Firestore não gera leitura Drive', async () =>
  isolated({ privateRead: true }, async (s) => {
    assert.equal((await handleRequest(request(`/v1/games/${id}/manual`), env)).status, 403);
    assert.equal(
      s.calls.some((call) => call.url.includes('/drive/')),
      false,
    );
  }));
test('referência adulterada não permite ler outro jogo ou documento pessoal', async () =>
  isolated({}, async (s) => {
    s.files.get('manual123').parents = ['personal-folder'];
    assert.equal((await handleRequest(request(`/v1/games/${id}/manual`), env)).status, 403);
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
    const finalDelete = s.calls.find((call) => call.url.includes('/documents:commit') && JSON.parse(call.body).writes[0].delete);
    assert.ok(finalDelete, 'A exclusão final deve usar a precondição no corpo do commit.');
    assert.equal(s.game, null);
    assert.equal(s.files.size, 0);
  }));
test('PDF na lixeira deixa de ser legível e não impede excluir o cadastro', async () =>
  isolated({}, async (s) => {
    s.files.get('manual123').trashed = true;
    assert.equal((await handleRequest(request(`/v1/games/${id}/manual`), env)).status, 410);
    assert.equal((await handleRequest(request(`/v1/games/${id}`, { method: 'DELETE' }), env)).status, 200);
    assert.equal(s.game, null);
    assert.equal(s.files.get('manual123').trashed, true);
    assert.equal(s.files.has('cover123'), false);
    assert.equal(
      s.calls.some((call) => call.method === 'DELETE' && call.url.includes('/drive/v3/files/manual123')),
      false,
    );
  }));
test('PDF já removido definitivamente permite limpar o cadastro e a capa', async () =>
  isolated({}, async (s) => {
    s.files.delete('manual123');
    assert.equal((await handleRequest(request(`/v1/games/${id}`, { method: 'DELETE' }), env)).status, 200);
    assert.equal(s.game, null);
    assert.equal(s.files.size, 0);
  }));
test('excluir cadastro com referência adulterada preserva o arquivo de outro jogo', async () =>
  isolated({}, async (s) => {
    s.files.get('manual123').appProperties.gameId = 'another-game';
    const response = await handleRequest(request(`/v1/games/${id}`, { method: 'DELETE' }), env);
    assert.equal(response.status, 200);
    assert.match((await response.json()).warning, /preservados/);
    assert.equal(s.game, null);
    assert.equal(s.files.has('manual123'), true);
    assert.equal(s.files.has('cover123'), false);
  }));
test('consulta de disponibilidade diferencia PDF ativo, lixeira e ausência; capa não oculta jogo', async () =>
  isolated({}, async (s) => {
    const check = async () => (await (await handleRequest(request('/v1/catalog/status', { method: 'POST', json: { gameIds: [id] } }), env)).json()).games[0];
    s.files.delete('cover123');
    assert.deepEqual(await check(), { id, available: true, reason: 'available' });
    s.files.get('manual123').trashed = true;
    assert.deepEqual(await check(), { id, available: false, reason: 'trashed' });
    s.files.delete('manual123');
    assert.deepEqual(await check(), { id, available: false, reason: 'missing' });
    assert.equal(
      s.calls.some((call) => call.method === 'DELETE'),
      false,
    );
  }));
test('disponibilidade não consulta Drive quando regras Firestore negam a leitura', async () =>
  isolated({ privateRead: true }, async (s) => {
    const response = await handleRequest(request('/v1/catalog/status', { method: 'POST', json: { gameIds: [id] } }), env);
    assert.deepEqual((await response.json()).games, [{ id, available: false, reason: 'unavailable' }]);
    assert.equal(
      s.calls.some((call) => call.url.includes('/drive/')),
      false,
    );
  }));
test('falha transitória do Drive não é reportada como PDF excluído', async () =>
  isolated({ metadataFailure: true }, async (s) => {
    const response = await handleRequest(request('/v1/catalog/status', { method: 'POST', json: { gameIds: [id] } }), env);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).games, undefined);
    assert.equal((await handleRequest(request(`/v1/games/${id}`, { method: 'DELETE' }), env)).status, 502);
    assert.equal(s.game.deleting, false);
  }));
test('disponibilidade limita lote antes de consultar serviços', async () =>
  isolated({}, async (s) => {
    assert.equal((await handleRequest(request('/v1/catalog/status', { method: 'POST', json: { gameIds: Array(21).fill(id) } }), env)).status, 400);
    assert.equal(s.calls.filter((call) => !call.url.includes('/documents/users/') && !call.url.includes('/jwk/')).length, 0);
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
    assert.equal((await handleRequest(request(`/v1/games/${id}/manual`), env)).status, 410);
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

test('nenhum endpoint de conteúdo aceita visitante, pendente ou bloqueado, mesmo conhecendo IDs', async () => {
  for (const options of [{}, { enabled: false }])
    await isolated(options, async (s) => {
      for (const path of [`/v1/games/${id}/manual`, `/v1/games/${id}/cover`, `/v1/games/${id}/documents/main/pdf`, `/v1/games/${id}/documents/main/index`, `/v1/games/${id}/guide-assets/asset-000000`, '/v1/research/sources']) {
        const response = await handleRequest(request(path, { auth: options.enabled === false }), env);
        assert.equal(response.status, options.enabled === false ? 403 : 401);
      }
      assert.equal(
        s.calls.some((call) => call.url.includes('/drive/')),
        false,
      );
    });
});
test('mesmo JWT perde leitura imediatamente após bloqueio do perfil; conta comum não envia arquivos', async () => {
  const options = { role: 'user' };
  await isolated(options, async (s) => {
    assert.equal((await handleRequest(request(`/v1/games/${id}/manual`), env)).status, 200);
    assert.equal((await handleRequest(request('/v1/uploads', { method: 'POST', json: { gameId: id, kind: 'manual', name: 'manual.pdf', mimeType: 'application/pdf', size: 10 } }), env)).status, 403);
    options.enabled = false;
    const before = s.calls.length;
    assert.equal((await handleRequest(request(`/v1/games/${id}/manual`), env)).status, 403);
    assert(!s.calls.slice(before).some((call) => call.url.includes('/drive/')));
  });
});
test('documentos e índices exigem vínculo exato de jogo, documento e hash; não dependem de guia', async () =>
  isolated({}, async (s) => {
    const documentId = '22345678-1234-1234-1234-123456789abc',
      hash = 'b'.repeat(64);
    s.game = {
      ...s.game,
      documents: {
        main: { id: 'main', manual: { ...s.game.manual, path: `games/${id}/manual.pdf`, sha256: 'a'.repeat(64) } },
        [documentId]: { id: documentId, manual: { path: `games/${id}/documents/${documentId}.pdf`, sha256: hash, driveFileId: 'second-pdf' } },
      },
      primaryDocumentId: 'main',
    };
    s.files.set('second-pdf', { ...owned('second-pdf', 'document'), mimeType: 'application/pdf', appProperties: { acervoProject: env.FIREBASE_PROJECT_ID, gameId: id, kind: 'document', documentId, sourceHash: hash } });
    s.files.set('second-index', { ...owned('second-index', 'documentIndex'), mimeType: 'application/gzip', appProperties: { acervoProject: env.FIREBASE_PROJECT_ID, gameId: id, kind: 'documentIndex', documentId, sourceHash: hash } });
    s.guides.set(`games/${id}/indexes/${documentId}`, { sourceHash: hash, fileId: 'second-index' });
    const pdfPath = `/v1/games/${id}/documents/${documentId}/pdf`,
      indexPath = `/v1/games/${id}/documents/${documentId}/index`;
    assert.equal((await handleRequest(request(pdfPath), env)).status, 200);
    const index = await handleRequest(request(indexPath), env);
    assert.equal(index.status, 200);
    assert.equal(index.headers.get('Cache-Control'), 'no-store');
    assert.equal(index.headers.get('Content-Type'), 'application/gzip');
    s.files.get('second-pdf').appProperties.documentId = 'another-document';
    assert.equal((await handleRequest(request(pdfPath), env)).status, 403);
    s.game.documents[documentId].manual.sha256 = 'c'.repeat(64);
    assert.equal((await handleRequest(request(indexPath), env)).status, 404);
    assert(s.files.has('manual123'));
  }));
test('arquivo compartilhado publicamente no Drive é rejeitado na biblioteca privada', async () =>
  isolated({}, async (s) => {
    s.files.get('manual123').permissions = [{ type: 'anyone', role: 'reader' }];
    assert.equal((await handleRequest(request(`/v1/games/${id}/manual`), env)).status, 403);
    assert(!s.calls.some((call) => call.url.includes('alt=media')));
  }));

test('hash esperado impede abrir página antiga no PDF substituído', async () =>
  isolated({}, async (s) => {
    s.game.manual.sha256 = 'b'.repeat(64);
    const response = await handleRequest(request(`/v1/games/${id}/documents/main/pdf`, { headers: { 'X-Document-Hash': 'a'.repeat(64) } }), env);
    assert.equal(response.status, 409);
    assert(!s.calls.some((call) => call.url.includes('alt=media')));
  }));

test('trocar principal por documento adicional mantém disponibilidade do catálogo', async () =>
  isolated({}, async (s) => {
    const documentId = '22345678-1234-1234-1234-123456789abc',
      hash = 'c'.repeat(64),
      manual = { driveFileId: 'new-principal', path: `games/${id}/documents/${documentId}.pdf`, sha256: hash };
    s.game = { ...s.game, manual, primaryDocumentId: documentId, documents: { [documentId]: { id: documentId, manual } } };
    s.files.set('new-principal', { ...owned('new-principal', 'document'), appProperties: { acervoProject: env.FIREBASE_PROJECT_ID, gameId: id, kind: 'document', documentId, sourceHash: hash } });
    const response = await handleRequest(request('/v1/catalog/status', { method: 'POST', json: { gameIds: [id] } }), env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).games[0].available, true);
  }));

test('configuração global antiga preserva leitura apenas para aprovados, sem liberar visitante ou jogo restrito', async () => {
  for (const available of [true, false])
    await isolated({ role: 'user', publicRead: available }, async (s) => {
      s.game.isPublic = false;
      assert.equal((await handleRequest(request(`/v1/games/${id}/manual`), env)).status, available ? 200 : 403);
      assert.equal((await handleRequest(request(`/v1/games/${id}/manual`, { auth: false }), env)).status, 401);
    });
});
