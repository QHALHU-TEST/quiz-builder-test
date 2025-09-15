/* Quiz Builder PWA Service Worker
   (MADE BY ALI HUSSAIN ALQAHTANI) */

const CACHE_NAME = 'qb-cache-v3';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// CDN libs we fetch at runtime (opaque responses are fine)
const RUNTIME_CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/',
  'https://cdnjs.cloudflare.com/ajax/libs/mammoth/'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

// Network-first for HTML (so updates show), cache-first for other assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET
  if (request.method !== 'GET') return;

  // Handle CDN runtime caching (cache-first)
  if (RUNTIME_CDN.some(prefix => request.url.startsWith(prefix))) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request, { mode: 'cors' }).then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(()=>{});
          return resp;
        }).catch(() => cached || new Response('', { status: 504 }));
      })
    );
    return;
  }

  // HTML pages: network-first with fallback to cache
  if (request.destination === 'document' || request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(()=>{});
        return resp;
      }).catch(() => caches.match(request).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Other same-origin assets: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(()=>{});
          return resp;
        }).catch(() => cached || new Response('', { status: 504 }));
      })
    );
  }
});
