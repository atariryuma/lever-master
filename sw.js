// LEVER MASTER Service Worker
// Version 1.0.2

const CACHE_NAME = 'lever-master-v3';
const BASE_PATH = '/lever-master';

const ASSETS_TO_CACHE = [
    `${BASE_PATH}/`,
    `${BASE_PATH}/index.html`,
    `${BASE_PATH}/src/js/main.js`,
    `${BASE_PATH}/src/css/styles.css`,
    `${BASE_PATH}/public/manifest.json`,
    `${BASE_PATH}/public/icons/icon.svg`,
    `${BASE_PATH}/public/icons/icon-192.png`,
    `${BASE_PATH}/public/icons/icon-512.png`,
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
    'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=M+PLUS+Rounded+1c:wght@400;700;800&display=swap'
];

// インストール時にアセットをキャッシュ
self.addEventListener('install', (event) => {
    console.log('[SW] Installing new version...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching assets');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => {
                console.log('[SW] Skip waiting to activate immediately');
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('[SW] Cache failed:', error);
            })
    );
});

// アクティベート時に古いキャッシュを削除してクライアントに通知
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating new version...');
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name.startsWith('lever-master-') && name !== CACHE_NAME)
                        .map((name) => {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('[SW] Claiming clients');
                return self.clients.claim();
            })
            .then(() => {
                // 全クライアントに更新完了を通知
                return self.clients.matchAll({ type: 'window' });
            })
            .then((clients) => {
                clients.forEach((client) => {
                    client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME });
                });
            })
    );
});

// メッセージ受信（手動更新リクエストなど）
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        console.log('[SW] Received skip waiting request');
        self.skipWaiting();
    }
});

// フェッチ時にキャッシュを優先（ネットワークフォールバック）
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip cross-origin requests except for CDN assets
    const url = new URL(event.request.url);
    const isSameOrigin = url.origin === location.origin;
    const isAllowedCDN = url.hostname === 'cdnjs.cloudflare.com' ||
        url.hostname === 'fonts.googleapis.com' ||
        url.hostname === 'fonts.gstatic.com';

    if (!isSameOrigin && !isAllowedCDN) return;

    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    // バックグラウンドでネットワークから更新をチェック（stale-while-revalidate）
                    if (isSameOrigin) {
                        fetch(event.request)
                            .then((response) => {
                                if (response && response.status === 200) {
                                    caches.open(CACHE_NAME).then((cache) => {
                                        cache.put(event.request, response);
                                    });
                                }
                            })
                            .catch(() => {});
                    }
                    return cachedResponse;
                }

                return fetch(event.request)
                    .then((response) => {
                        // Don't cache non-successful responses
                        if (!response || response.status !== 200) {
                            return response;
                        }

                        // Clone and cache the response
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    })
                    .catch(() => {
                        // Offline fallback for navigation requests
                        if (event.request.mode === 'navigate') {
                            return caches.match(`${BASE_PATH}/index.html`);
                        }
                        return new Response('Offline', { status: 503 });
                    });
            })
    );
});
