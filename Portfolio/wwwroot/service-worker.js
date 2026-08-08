const cachePrefix = 'offline-cache-';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key.startsWith(cachePrefix))
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
