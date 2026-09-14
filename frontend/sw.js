// Increment this version whenever a deployed asset or model changes.
const VERSION = 'v2.0.1';
const PREFIX = `edgepulse-${encodeURIComponent(self.registration.scope)}-`;
const CACHE = `${PREFIX}${VERSION}`;
const ASSETS = ['./', './index.html', './styles.css', './bootstrap.js', './app.js', './model.js', './pwa.js', './manifest.webmanifest', './model/model.json', './icons/logo.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];
const assetURLs = ASSETS.map(path => new URL(path, self.registration.scope).href);
self.addEventListener('install', event => {
  // Atomic install: any missing essential file prevents activation.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(assetURLs.map(url => new Request(url, { cache: 'reload' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Do not remove other apps' caches on a shared origin.
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (event.data?.type === 'CACHE_STATUS' && event.ports[0]) event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const present = await Promise.all(assetURLs.map(url => cache.match(url)));
    event.ports[0].postMessage({ ready: present.every(Boolean), version: VERSION });
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  // Only shell navigations get an HTML fallback. A missing .js/.json stays an error.
  const shell = event.request.mode === 'navigate' && [new URL('./', self.registration.scope).pathname, new URL('./index.html', self.registration.scope).pathname].includes(url.pathname);
  const canonical = new URL(url.pathname, self.location.origin).href;
  if (!shell && !assetURLs.includes(canonical)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(shell ? new URL('./index.html', self.registration.scope).href : canonical);
    if (cached) return cached;
    // Recovery for an evicted entry, without caching errors or opaque responses.
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type !== 'opaque') await cache.put(shell ? new URL('./index.html', self.registration.scope).href : canonical, response.clone());
      return response;
    } catch {
      return new Response('Ressource indisponible hors ligne. Rechargez après reconnexion.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
