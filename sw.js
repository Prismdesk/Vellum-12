// Vellum service worker — enables offline use.
//
// Strategy:
//  - App shell (index.html, manifest.json, icons): network-first, falling back
//    to cache when offline, so online users always get the latest build while
//    offline users still get a working app.
//  - Everything else (Google Fonts CSS/font files, the xlsx and html2canvas
//    CDN scripts): cache-first, falling back to network. These are pinned to
//    specific versions in index.html, so once cached they never go stale.
//
// Bump CACHE_VERSION whenever the app shell list below changes, so old
// caches get cleaned up on activate instead of accumulating forever.
const CACHE_VERSION = 'v4';
const APP_CACHE = 'vellum-app-' + CACHE_VERSION;
const RUNTIME_CACHE = 'vellum-runtime-' + CACHE_VERSION;

const APP_SHELL = [
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {}) // don't block install if e.g. offline on first-ever visit
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((n) => n !== APP_CACHE && n !== RUNTIME_CACHE)
          .map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // don't intercept POSTs etc.

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isAppShellRequest = req.mode === 'navigate' ||
    (isSameOrigin && APP_SHELL.some((p) => url.pathname.endsWith(p.replace('./', ''))));

  if (isAppShellRequest) {
    // Network-first: try to get the freshest app shell, but fall back to
    // whatever we have cached (even if stale) when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(APP_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // Runtime cache for everything else: fonts, xlsx, html2canvas, etc.
  // Cache-first because these are version-pinned URLs that won't change.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached); // cached is undefined here, but keeps shape consistent
    })
  );
});
