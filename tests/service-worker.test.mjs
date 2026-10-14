import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
function worker() {
  const handlers = {},
    deleted = [],
    cached = [],
    responses = [];
  const cache = { addAll: async (assets) => cached.push(...assets), match: async () => null, put: async () => {} };
  vm.runInNewContext(source, {
    URL,
    Response,
    fetch: async (request) => new Response('ok'),
    caches: { open: async () => cache, keys: async () => ['buraco-v309', 'other-app', 'acervo-v0-shell', 'acervo-v1.0.1-shell', 'acervo-v1.1.0-shell', 'acervo-v1.2.0-shell', 'acervo-sdk-13.0.0'], delete: async (key) => deleted.push(key) },
    self: {
      location: { origin: 'https://example.com' },
      registration: { scope: 'https://example.com/' },
      clients: { claim: async () => {} },
      addEventListener: (event, callback) => (handlers[event] = callback),
      skipWaiting: () => responses.push('skipWaiting'),
    },
  });
  return { handlers, deleted, cached, responses };
}
test('cache essencial não contém manuais; instalação valida todos os recursos', async () => {
  const context = worker();
  let pending;
  context.handlers.install({ waitUntil: (promise) => (pending = promise) });
  await pending;
  assert.ok(context.cached.includes('./index.html'));
  assert.ok(context.cached.includes('./vendor/pdfjs/pdf.worker.mjs'));
  assert.equal(
    context.cached.some((file) => /\.pdf$/i.test(file)),
    false,
  );
});
test('ativação preserva caches de outros aplicativos e limpa somente versões Acervo', async () => {
  const context = worker();
  let pending;
  context.handlers.activate({ waitUntil: (promise) => (pending = promise) });
  await pending;
  assert.deepEqual(context.deleted, ['acervo-v0-shell', 'acervo-v1.0.1-shell', 'acervo-v1.1.0-shell']);
});
test('PDFs, Storage, APIs e range não são interceptados', () => {
  const context = worker();
  for (const request of [
    new Request('https://example.com/manual.pdf'),
    new Request('https://firebasestorage.googleapis.com/v0/b/bucket/o/manual.pdf'),
    new Request('https://example.com/index.html', { headers: { range: 'bytes=0-100' } }),
    new Request('https://firestore.googleapis.com/v1/projects/test'),
  ]) {
    let intercepted = false;
    context.handlers.fetch({ request, respondWith: () => (intercepted = true) });
    assert.equal(intercepted, false, request.url);
  }
});
test('worker novo aguarda mensagem de atualização', () => {
  const context = worker();
  context.handlers.message({ data: 'skipWaiting' });
  assert.deepEqual(context.responses, ['skipWaiting']);
});
