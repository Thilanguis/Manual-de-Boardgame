// Alterar VERSION a cada publicação que modificar arquivos do aplicativo.
const VERSION = 'acervo-v1.3.0';
const SHELL = `${VERSION}-shell`;
const SDK = 'acervo-sdk-13.0.0';
const ESSENTIAL = [
  './',
  './index.html',
  './styles/app.css',
  './config/app-config.js',
  './manifest.webmanifest',
  './js/app.js',
  './js/model.js',
  './js/recognition.js',
  './js/pdf.js',
  './js/reader.js',
  './js/pwa.js',
  './js/local-repository.js',
  './js/firebase-repository.js',
  './js/drive-storage.js',
  './js/permissions.js',
  './js/catalog-availability.js',
  './js/bgg-client.js',
  './js/guide-model.js',
  './js/guide-repository.js',
  './js/guide-panel.js',
  './js/pdf-index.js',
  './js/index-cache.js',
  './js/rule-search-worker.js',
  './js/admin-panel.js',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
  './vendor/pdfjs/pdf.mjs',
  './vendor/pdfjs/pdf.worker.mjs',
  './vendor/pdfjs/text-layer.css',
];

self.addEventListener('install', (event) => {
  // Uma instalação incompleta não substitui a versão funcional anterior.
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(ESSENTIAL)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('acervo-') && ![SHELL, SDK].includes(key)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
function unavailable() {
  return new Response('Este recurso precisa de conexão.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
self.addEventListener('fetch', (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('range')) return;
  // Nunca interceptar arquivos do Storage, APIs, PDFs ou capas remotas.
  if (url.origin !== self.location.origin) {
    if (url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/13.0.0/') && url.pathname.endsWith('.js')) {
      event.respondWith(
        (async () => {
          const cache = await caches.open(SDK),
            cached = await cache.match(request);
          if (cached) return cached;
          const response = await fetch(request);
          if (response.ok && response.type !== 'opaque') await cache.put(request, response.clone());
          return response;
        })().catch(unavailable),
      );
    }
    return;
  }
  if (/\.pdf$/i.test(url.pathname)) return;
  const relative = './' + url.pathname.slice(new URL('./', self.registration.scope).pathname.length);
  const isShell = ESSENTIAL.includes(relative) || request.mode === 'navigate';
  const isPdfResource = /\/vendor\/pdfjs\/(cmaps|standard_fonts|wasm)\//.test(url.pathname);
  if (!isShell && !isPdfResource) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL);
      // O endereço público do backend pode ser configurado depois de instalar a PWA.
      // Buscar a configuração atual evita manter apiBase vazia após a conexão.
      if (relative === './config/app-config.js') {
        const key = new URL(url.pathname, self.location.origin).href;
        try {
          const response = await fetch(request, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
          if (response.ok) {
            await cache.put(key, response.clone());
            return response;
          }
        } catch {
          // Preservar abertura offline com a última configuração pública válida.
        }
        return (await cache.match(key)) || unavailable();
      }
      // Arquivos de uma versão são servidos juntos. Atualizações entram pelo novo SW.
      const key = request.mode === 'navigate' ? new URL('./index.html', self.registration.scope).href : new URL(url.pathname, self.location.origin).href;
      const cached = await cache.match(key);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(key, response.clone());
      return response;
    })().catch(unavailable),
  );
});
