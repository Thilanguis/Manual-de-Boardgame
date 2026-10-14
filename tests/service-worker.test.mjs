import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
function worker({ networkFails = false, cachedConfig = null } = {}) {
  const handlers = {},
    deleted = [],
    cached = [],
    responses = [],
    network = [];
  const cache = { addAll: async (assets) => cached.push(...assets), match: async () => (cachedConfig ? new Response(cachedConfig) : null), put: async () => {} };
  vm.runInNewContext(source, {
    URL,
    Response,
    AbortSignal,
    fetch: async (request, options) => {
      network.push({ request, options });
      if (networkFails) throw new Error('Offline');
      return new Response('ok');
    },
    caches: {
      open: async () => cache,
      keys: async () => [
        'buraco-v309',
        'other-app',
        'acervo-v0-shell',
        'acervo-v1.0.1-shell',
        'acervo-v1.1.0-shell',
        'acervo-v1.2.0-shell',
        'acervo-v1.2.1-shell',
        'acervo-v1.2.2-shell',
        'acervo-v1.2.3-shell',
        'acervo-v1.3.0-shell',
        `${source.match(/const VERSION = '([^']+)'/)[1]}-shell`,
        'acervo-sdk-13.0.0',
      ],
      delete: async (key) => deleted.push(key),
    },
    self: {
      location: { origin: 'https://example.com' },
      registration: { scope: 'https://example.com/' },
      clients: { claim: async () => {} },
      addEventListener: (event, callback) => (handlers[event] = callback),
      skipWaiting: () => responses.push('skipWaiting'),
    },
  });
  return { handlers, deleted, cached, responses, network };
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
  assert.deepEqual(context.deleted, ['acervo-v0-shell', 'acervo-v1.0.1-shell', 'acervo-v1.1.0-shell', 'acervo-v1.2.0-shell', 'acervo-v1.2.1-shell', 'acervo-v1.2.2-shell', 'acervo-v1.2.3-shell', 'acervo-v1.3.0-shell']);
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

test('configuração pública busca a rede mesmo quando uma configuração anterior está no cache', async () => {
  const context = worker({ cachedConfig: 'apiBase antiga' });
  let pending;
  context.handlers.fetch({ request: new Request('https://example.com/config/app-config.js'), respondWith: (promise) => (pending = promise) });
  assert.equal(await (await pending).text(), 'ok');
  assert.equal(context.network.length, 1);
  assert.equal(context.network[0].options.cache, 'no-store');
});

test('configuração pública mantém a última versão válida para abertura offline', async () => {
  const context = worker({ networkFails: true, cachedConfig: 'apiBase atual' });
  let pending;
  context.handlers.fetch({ request: new Request('https://example.com/config/app-config.js'), respondWith: (promise) => (pending = promise) });
  assert.equal(await (await pending).text(), 'apiBase atual');
});
