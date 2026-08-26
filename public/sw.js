const CACHE_VERSION = 'spindel-scheduler-v2';

self.addEventListener('install', (event) => {
  const scopePath = new URL(self.registration.scope).pathname;
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll([
        scopePath,
        `${scopePath}manifest.webmanifest`,
        `${scopePath}favicon.svg`,
      ]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  const networkFirst = () =>
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match(new URL(self.registration.scope).pathname)));

  if (
    request.mode === 'navigate' ||
    request.destination === 'script' ||
    request.destination === 'style'
  ) {
    event.respondWith(
      networkFirst()
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
      return response;
    }))
  );
});
