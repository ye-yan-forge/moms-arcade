// SeaQuest Service Worker — offline cache for mom's arcade
const CACHE_NAME = 'seaquest-v6';
const ASSETS = [
    './',
    './index.html',
    './game.js',
    './manifest.json',
    './icon.png',
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {})
    );
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    e.respondWith(
        caches.match(e.request).then(cached => {
            return cached || fetch(e.request).then(resp => {
                // Cache new requests for same-origin
                if (resp.ok && e.request.url.startsWith(self.location.origin)) {
                    const clone = resp.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
                }
                return resp;
            }).catch(() => cached);
        })
    );
});
