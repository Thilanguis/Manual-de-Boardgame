// Gateway exclusivo de desenvolvimento + Worker real no workerd/Miniflare.
// Todas as saídas do workerd passam pelo transporte simulado; nenhuma rede real.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { relative } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from '../worker/node_modules/miniflare/dist/src/index.js';
import { workerFixture } from '../tests/worker-browser-fixture.mjs';
import { assertDevelopment, PROJECT, OWNER, FOLDER, DIRECTORY } from './dev-config.mjs';
assertDevelopment();
await mkdir(DIRECTORY, { recursive: true });
const records = JSON.parse(await readFile(resolve(DIRECTORY, 'files.json'), 'utf8').catch(() => '[]'));
const initialFiles = [];
for (const [id, file] of records) {
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(id)) throw new Error('Arquivo fictício inválido.');
  initialFiles.push([id, { ...file, bytes: file.byteFile ? await readFile(resolve(DIRECTORY, 'files', `${id}.bin`)) : Buffer.from(file.bytes, 'base64') }]);
}
let runtime;
const fixture = await workerFixture({
  project: PROJECT,
  ownerUid: OWNER,
  folderId: FOLDER,
  origin: 'http://localhost:4173,http://127.0.0.1:4173',
  port: 8787,
  initialFiles,
  enableKnowledge: true,
  interceptGlobal: false,
  handler: async (request) =>
    runtime.dispatchFetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      ...(!['GET', 'HEAD'].includes(request.method) ? { body: Buffer.from(await request.arrayBuffer()) } : {}),
    }),
});
const { GAME_KNOWLEDGE, ...bindings } = fixture.configuration;
bindings.LOCAL_SIMULATED_SERVICES = 'true';
const options = convertV4MiniflareOptions({
  modules: true,
  scriptPath: resolve('worker/.build/index.js'),
  compatibilityDate: '2026-10-14',
  bindings,
  durableObjects: { GAME_KNOWLEDGE: { className: 'KnowledgeStore', useSQLite: true } },
  resourcePersistencePath: resolve(DIRECTORY, 'sqlite'),
  telemetry: { enabled: false },
});
options.workers[0].dev.outboundService = {
  type: 'fetcher',
  handler: async (request) => {
    const headers = Object.fromEntries(request.headers);
    const response = await fixture.transport(request.url, {
      method: request.method,
      headers,
      ...(!['GET', 'HEAD'].includes(request.method) ? { body: Buffer.from(await request.arrayBuffer()) } : {}),
    });
    return new Response(response.body, { status: response.status, headers: response.headers });
  },
};
runtime = new Miniflare(options);
await runtime.ready;
const inspect = createServer(async (req, res) => {
  if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.headers.origin) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (req.url === '/metrics' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ...fixture.metrics, calls: fixture.calls, geminiCalls: fixture.knowledge.calls.length, files: fixture.files.size, runtime: 'Miniflare / SQLite local', project: PROJECT }));
  } else if (req.url === '/faults' && req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks));
    fixture.faults.firestore = [403, 429].includes(input.firestore) ? input.firestore : 0;
    fixture.knowledge.faults.quota = input.geminiQuota === true;
    res.end('{}');
  } else if (req.url === '/stop' && req.method === 'POST') {
    res.end('{}');
    setTimeout(stop, 20);
  } else if (req.url === '/fixtures' && req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks));
    const file = resolve('test-output/development-fixtures', input.name || '');
    if (!/^[-a-zA-Z0-9.]+\.pdf$/.test(input.name || '') || relative(resolve('test-output/development-fixtures'), file) !== input.name) {
      res.writeHead(400);
      res.end();
      return;
    }
    const bytes = await readFile(file);
    fixture.files.set(input.fileId, {
      id: input.fileId,
      name: input.name,
      bytes,
      size: String(bytes.length),
      mimeType: 'application/pdf',
      parents: [FOLDER],
      owners: [{ me: true, emailAddress: 'owner@example.test' }],
      permissions: [{ type: 'user', role: 'owner' }],
      appProperties: { acervoProject: PROJECT, gameId: input.gameId, kind: 'manual' },
    });
    res.end('{}');
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => inspect.listen(8788, '127.0.0.1', r));
async function stop() {
  inspect.closeAllConnections();
  inspect.close();
  await mkdir(resolve(DIRECTORY, 'files'), { recursive: true });
  const metadata = [];
  for (const [id, file] of fixture.files) {
    if (!/^[A-Za-z0-9_-]{6,200}$/.test(id)) throw new Error('Arquivo fictício inválido.');
    await writeFile(resolve(DIRECTORY, 'files', `${id}.bin`), file.bytes);
    const { bytes, ...rest } = file;
    metadata.push([id, { ...rest, byteFile: true }]);
  }
  await writeFile(resolve(DIRECTORY, 'files.json'), JSON.stringify(metadata));
  await fixture.close();
  await runtime.dispose();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log('Worker local pronto :8787 — Drive e Gemini simulados; SQLite persistente.');
