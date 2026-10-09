// Keeps a copy of the app on the phone so it opens and works with no internet.
// VERSION and FILES are filled in by tools/build.mjs.
const VERSION = '__VERSION__';
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mangal-bill-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function fromCacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  if (request.mode === 'navigate') {
    const page = await cache.match('index.html');
    if (page) return page;
  }
  return fetch(request);
}

async function fromNetworkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    return hit || new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // the rate sheet always comes straight from the internet
  if (url.pathname.endsWith('/settings.json')) event.respondWith(fromNetworkFirst(request));
  else event.respondWith(fromCacheFirst(request));
});
