// Alterar VERSION a cada publicação que modificar arquivos do aplicativo.
const VERSION = 'acervo-v1.11.0-preferences-health-43';
const LOCAL_DEVELOPMENT = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);
const SHELL = `${VERSION}-shell`;
const SDK = 'acervo-sdk-13.0.0';
const ESSENTIAL = [
  './',
  './index.html',
  './sobre.html',
  './privacidade.html',
  './termos.html',
  './styles/public-pages.css',
  './styles/app.css',
  './styles/interface.css',
  './styles/hero-showcase.css',
  './styles/rule-conversation.css',
  './config/app-config.js',
  './manifest.webmanifest',
  './js/app.js',
  './js/account-panel.js',
  './js/game-steps.js',
  './js/model.js',
  './js/library-filter-model.js',
  './js/library-filters.js',
  './js/recognition.js',
  './js/pdf.js',
  './js/pdf-limits.js',
  './js/file-errors.js',
  './js/drive-diagnostics.js',
  './js/reader.js',
  './js/pdf-search.js',
  './js/pwa.js',
  './js/local-repository.js',
  './js/firebase-repository.js',
  './js/drive-storage.js',
  './js/permissions.js',
  './js/catalog-availability.js',
  './js/bgg-client.js',
  './js/research-client.js',
  './js/research-duration.js',
  './js/research-panel.js',
  './js/game-vocabulary.js',
  './js/research-knowledge.js',
  './js/research-enrichment.js',
  './js/metadata-consolidation.js',
  './js/metadata-consensus.js',
  './js/profile-facts.js',
  './js/draft-profile.js',
  './js/information-flow.js',
  './js/profile-availability.js',
  './js/information-identity.js',
  './js/pdf-profile.js',
  './js/metadata-form.js',
  './js/firestore-data.js',
  './js/research-store.js',
  './js/pdf-knowledge.js',
  './js/translation.js',
  './js/catalog-language.js',
  './js/research-presentation.js',
  './js/research-contract.js',
  './js/text-quality.js',
  './js/profile-diagnostics.js',
  './js/draft-reuse.js',
  './js/game-identities.js',
  './js/pdf-ocr.js',
  './js/ocr-metadata.js',
  './js/guide-model.js',
  './js/guide-repository.js',
  './js/guide-panel.js',
  './js/knowledge-panel.js',
  './js/knowledge-observer.js',
  './js/knowledge-model.js',
  './js/knowledge-status.js',
  './js/rule-relevance.js',
  './js/rule-topics.js',
  './js/rule-language.js',
  './js/rule-passages.js',
  './js/rule-layout.js',
  './js/rule-reading.js',
  './js/rule-assistant-contract.js',
  './js/rule-assistant-panel.js',
  './js/pdf-index.js',
  './js/index-cache.js',
  './js/private-cache.js',
  './js/preferences.js',
  './js/health-panel.js',
  './js/documents.js',
  './js/document-repository.js',
  './js/document-panel.js',
  './js/document-order.js',
  './js/preparation-queue.js',
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
  if (LOCAL_DEVELOPMENT) {
    event.waitUntil(self.skipWaiting());
    return;
  }
  // Uma instalação incompleta não substitui a versão funcional anterior.
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(ESSENTIAL.map((path) => new Request(new URL(path, self.registration.scope), { cache: 'reload' })))));
});
self.addEventListener('activate', (event) => {
  if (LOCAL_DEVELOPMENT) {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => /^acervo-.*-shell$/.test(key) || key === SDK).map((key) => caches.delete(key)));
        await self.registration.unregister();
      })(),
    );
    return;
  }
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
  if (LOCAL_DEVELOPMENT) return;
  const request = event.request,
    url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('range') || request.headers.has('authorization')) return;
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
  // Páginas públicas têm documento próprio; não devolver o index da biblioteca.
  if (['./sobre.html', './privacidade.html', './termos.html'].includes(relative)) return;
  const isShell = ESSENTIAL.includes(relative) || request.mode === 'navigate';
  const isPdfResource = /\/vendor\/pdfjs\/(cmaps|standard_fonts|wasm)\//.test(url.pathname);
  const isOcrResource = /\/vendor\/tesseract\//.test(url.pathname) && /(?:\.js|\.traineddata\.gz)$/.test(url.pathname);
  if (!isShell && !isPdfResource && !isOcrResource) return;
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
      const key = request.mode === 'navigate' && !['./sobre.html', './privacidade.html', './termos.html'].includes(relative) ? new URL('./index.html', self.registration.scope).href : new URL(url.pathname, self.location.origin).href;
      const cached = await cache.match(key);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(key, response.clone());
      return response;
    })().catch(unavailable),
  );
});
