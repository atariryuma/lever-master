// LEVER MASTER Service Worker
// Version 1.0.7

const CACHE_NAME = 'lever-master-v18';

// Detect base path dynamically (works for both local and GitHub Pages)
const BASE_PATH = self.location.pathname.replace(/\/sw\.js$/, '');

// 自サイトの必須アセット
// ⚠️ main.js は ES module であり、import する全モジュールを列挙する必要がある。
//    1つでも漏れると、オフライン初回起動時に module の解決に失敗してゲームが起動しない。
const CORE_ASSETS = [
    `${BASE_PATH}/`,
    `${BASE_PATH}/index.html`,
    `${BASE_PATH}/src/css/styles.css`,
    // ES module 一式
    `${BASE_PATH}/src/js/main.js`,
    `${BASE_PATH}/src/js/constants.js`,
    `${BASE_PATH}/src/js/utils.js`,
    `${BASE_PATH}/src/js/game-logic.js`,
    `${BASE_PATH}/src/js/ui-generator.js`,
    `${BASE_PATH}/src/js/event-handlers.js`,
    `${BASE_PATH}/src/js/timeout-manager.js`,
    `${BASE_PATH}/src/js/error-handler.js`,
    `${BASE_PATH}/src/js/performance-monitor.js`,
    // PWA
    `${BASE_PATH}/public/manifest.json`,
    `${BASE_PATH}/public/icons/icon.svg`,
    `${BASE_PATH}/public/icons/icon-192.png`,
    `${BASE_PATH}/public/icons/icon-512.png`,
];

// 外部CDN（学校ネットワーク等で遮断されうるため、失敗してもインストールを止めない）
const CDN_ASSETS = [
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
    'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=M+PLUS+Rounded+1c:wght@400;700;800&display=swap',
];

// インストール時にアセットをキャッシュ
self.addEventListener('install', (event) => {
    console.log('[SW] Installing new version...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(async (cache) => {
                // 自サイトのアセットは全て揃わないと意味がないので addAll（失敗＝インストール失敗）
                console.log('[SW] Caching core assets');
                await cache.addAll(CORE_ASSETS);

                // CDNは1つずつ。失敗しても警告のみでインストールは継続する
                await Promise.all(CDN_ASSETS.map((url) =>
                    cache.add(url).catch((error) => {
                        console.warn('[SW] CDN asset skipped:', url, error);
                    }),
                ));
            })
            .then(() => {
                console.log('[SW] Skip waiting to activate immediately');
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('[SW] Cache failed:', error);
            }),
    );
});

// アクティベート時に古いキャッシュを削除
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
                        }),
                );
            })
            .then(() => {
                console.log('[SW] Claiming clients');
                // clients.claim()でcontrollerchangeイベントが発火し、
                // クライアント側でリロード処理が行われる
                return self.clients.claim();
            }),
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
                                    // response.clone()でキャッシュ用のコピーを作成
                                    const responseToCache = response.clone();
                                    caches.open(CACHE_NAME).then((cache) => {
                                        cache.put(event.request, responseToCache);
                                    });
                                }
                            })
                            .catch(() => { });
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
            }),
    );
});
