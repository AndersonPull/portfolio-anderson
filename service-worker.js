const cacheNamePrefix = 'offline-cache-';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key.startsWith(cacheNamePrefix))
                    .map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);

    if (requestUrl.origin === self.location.origin) {
        event.respondWith(fetch(event.request, { cache: 'no-store' }));
    }
});
/* Manifest version: s9gTGnCQ */
