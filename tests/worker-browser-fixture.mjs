// Backend de teste: Worker real + Firestore/Auth emulados + Drive/OAuth simulados.
// Escuta apenas em loopback. Nunca aceita configuração de produção.
import { createServer } from 'node:http';
import { handleRequest } from '../worker/src/index.js';
import { base64url } from '../worker/src/auth.js';
import { DRIVE_FOLDER_ID, OWNER_UID } from '../js/permissions.js';
import { knowledgeFixture } from './knowledge-fixture.mjs';
export async function workerFixture({ project, origin, initialFiles, enableKnowledge = false, ownerUid = OWNER_UID, folderId = DRIVE_FOLDER_ID, port = 0, handler, interceptGlobal = true }) {
  if (project !== 'demo-acervo' || !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Exige projeto e emuladores de teste.');
  for (const host of [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_AUTH_EMULATOR_HOST]) if (!/^127\.0\.0\.1:\d+$/.test(host || '')) throw new Error('Somente emuladores em loopback.');
  const originalFetch = globalThis.fetch,
    files = new Map(initialFiles),
    uploads = new Map(),
    faults = {},
    calls = [];
  const knowledge = enableKnowledge ? knowledgeFixture() : null;
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'regression-worker' };
  const env = {
    FIREBASE_PROJECT_ID: project,
    OWNER_UID: ownerUid,
    ALLOWED_ORIGINS: origin,
    MAX_PDF_BYTES: '52428800',
    DRIVE_FOLDER_ID: folderId,
    DRIVE_OWNER_EMAIL: 'owner@example.test',
    GOOGLE_CLIENT_ID: 'fixture',
    GOOGLE_CLIENT_SECRET: 'fixture',
    GOOGLE_REFRESH_TOKEN: 'fixture',
    TICKET_KEY: base64url(crypto.getRandomValues(new Uint8Array(32))),
    ...(knowledge?.env || {}),
  };
  const metadata = (id, input = {}) => ({
    id,
    name: input.name || 'arquivo',
    mimeType: input.mimeType || 'application/pdf',
    size: String(input.bytes?.length || 0),
    parents: [folderId],
    owners: [{ me: true, emailAddress: env.DRIVE_OWNER_EMAIL }],
    permissions: [{ type: 'user', role: 'owner' }],
    ...input,
  });
  for (const [id, input] of files) files.set(id, metadata(id, input));
  const metrics = { firestore: {}, errors: {}, blockedOutbound: [], total: 0 };
  const transport = async (value, init = {}) => {
    const url = String(value);
    if (knowledge) {
      const result = await knowledge.fetch(value, init);
      if (result) return result;
    }
    if (url.includes('/jwk/')) return Response.json({ keys: [jwk] });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'owner-fixture-token', expires_in: 3600 });
    if (url.startsWith('https://firestore.googleapis.com/')) {
      if (!new URL(url).pathname.startsWith('/v1/projects/demo-acervo/')) throw new Error('Projeto externo bloqueado no transporte local.');
      const key = `${init.method || 'GET'} ${new URL(url).pathname}`;
      metrics.total++;
      metrics.firestore[key] = (metrics.firestore[key] || 0) + 1;
      if (faults.firestore) return Response.json({ error: { message: 'Falha simulada', status: faults.firestore === 429 ? 'RESOURCE_EXHAUSTED' : 'PERMISSION_DENIED' } }, { status: faults.firestore });
      if (faults.commit && url.endsWith('documents:commit')) return new Response(null, { status: faults.commit });
      return originalFetch(url.replace('https://firestore.googleapis.com', `http://${process.env.FIRESTORE_EMULATOR_HOST}`), init);
    }
    if (url.includes('/upload/drive/v3/files') && init.method === 'POST') {
      const id = `fixture-${crypto.randomUUID()}`;
      uploads.set(id, { ...JSON.parse(init.body), id, parts: [], received: 0 });
      return new Response(null, { headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${id}` } });
    }
    if (url.includes('upload_id=')) {
      const id = new URL(url).searchParams.get('upload_id'),
        upload = uploads.get(id);
      if (!upload) return new Response(null, { status: 404 });
      const content = init.body ? Buffer.from(await new Response(init.body).arrayBuffer()) : Buffer.alloc(0);
      upload.parts.push(content);
      upload.received += content.length;
      const total = Number(/\/(\d+)$/.exec(new Headers(init.headers).get('Content-Range'))?.[1]);
      if (upload.received < total) return new Response(null, { status: 308, headers: upload.received ? { Range: `bytes=0-${upload.received - 1}` } : {} });
      upload.bytes = Buffer.concat(upload.parts);
      delete upload.parts;
      const result = metadata(id, upload);
      files.set(id, result);
      uploads.delete(id);
      return Response.json(Object.fromEntries(Object.entries(result).filter(([k]) => k !== 'bytes')));
    }
    if (url.includes('/drive/v3/files/')) {
      const id = decodeURIComponent(/\/files\/([^?]+)/.exec(url)[1]);
      if (id === folderId) return Response.json(metadata(id, { mimeType: 'application/vnd.google-apps.folder', parents: [], appProperties: { acervoProject: project } }));
      const file = files.get(id);
      if (!file) return new Response(null, { status: 404 });
      if (init.method === 'DELETE') {
        if (faults.delete) {
          faults.delete--;
          return new Response(null, { status: 503 });
        }
        files.delete(id);
        return new Response(null, { status: 204 });
      }
      if (url.includes('alt=media')) {
        const range = /^bytes=(\d+)-(\d*)$/.exec(new Headers(init.headers).get('Range') || ''),
          begin = range ? Number(range[1]) : 0,
          end = range?.[2] ? Math.min(Number(range[2]), file.bytes.length - 1) : file.bytes.length - 1;
        return new Response(file.bytes.subarray(begin, end + 1), { status: range ? 206 : 200, headers: { 'Content-Length': String(end - begin + 1), ...(range ? { 'Content-Range': `bytes ${begin}-${end}/${file.bytes.length}` } : {}) } });
      }
      return Response.json(Object.fromEntries(Object.entries(file).filter(([k]) => k !== 'bytes')));
    }
    const target = new URL(url);
    if (target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname)) return originalFetch(value, init);
    metrics.blockedOutbound.push(target.origin + target.pathname);
    throw new Error('Conexão externa bloqueada no ambiente isolado.');
  };
  if (interceptGlobal) globalThis.fetch = transport;
  async function signed(token) {
    const response = await originalFetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=fixture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    });
    const user = (await response.json()).users?.[0];
    if (!user) return token;
    const now = Math.floor(Date.now() / 1000),
      encode = (v) => base64url(new TextEncoder().encode(JSON.stringify(v)));
    const input = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode({ sub: user.localId, aud: project, iss: `https://securetoken.google.com/${project}`, iat: now, auth_time: now, exp: now + 3600 })}`;
    return `${input}.${base64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input))))}`;
  }
  const server = createServer(async (req, res) => {
    try {
      const headers = new Headers(req.headers);
      if (headers.get('Authorization')?.startsWith('Bearer ')) headers.set('Authorization', `Bearer ${await signed(headers.get('Authorization').slice(7))}`);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      let response = await (handler || handleRequest)(
        new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, ...(!['GET', 'HEAD'].includes(req.method) && chunks.length ? { body: Buffer.concat(chunks) } : {}) }),
        faults.maxPdfBytes ? { ...env, MAX_PDF_BYTES: String(faults.maxPdfBytes) } : env,
      );
      if (faults.legacy) {
        const headers = new Headers(response.headers);
        headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,Content-Range,X-Upload-Ticket');
        if (req.url === '/health') response = Response.json({ ok: true, apiVersion: '1.7.5', researchProtocol: 2 }, { headers });
        else if (req.url.includes('/documents/')) response = Response.json({ error: 'Operação não encontrada.' }, { status: 404, headers });
        else response = new Response(response.body, { status: response.status, headers });
      }
      calls.push({ path: req.url, method: req.method, status: response.status, range: req.headers.range || '', hashHeader: !!req.headers['x-document-hash'] });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    transport,
    metrics,
    signed,
    apiBase: `http://127.0.0.1:${server.address().port}`,
    files,
    faults,
    calls,
    knowledge,
    configuration: env,
    async close() {
      const done = new Promise((r) => server.close(r));
      server.closeAllConnections();
      await done;
      if (interceptGlobal) globalThis.fetch = originalFetch;
    },
  };
}
