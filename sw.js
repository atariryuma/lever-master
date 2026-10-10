/* てこマスター Service Worker
 * - インストール時に全ファイルをキャッシュ（初回からオフラインで遊べる）
 * - ページもファイルもネットワーク優先（新旧が混ざらない）。オフラインのときはキャッシュ
 * リリースのたびに VERSION を上げてください。
 */

const VERSION = '2.8.8';
const CACHE = `lever-master-${VERSION}`;

const ASSETS = [
    './',
    'index.html',
    'src/css/styles.css',
    'src/js/main.js',
    'src/js/ui.js',
    'src/js/widgets.js',
    'src/js/fx.js',
    'src/js/icons.js',
    'src/js/keep.js',
    'src/js/rules-tour.js',
    'src/js/audio.js',
    'src/js/storage.js',
    'src/js/players.js',
    'src/js/engine/lever.js',
    'src/js/engine/battle.js',
    'src/js/engine/ai.js',
    'src/js/engine/puzzles.js',
    'src/js/view/lever-view.js',
    'src/js/view/lever-view-3d.js',
    'src/vendor/three.js',
    'src/js/view/weight-art.js',
    'src/js/screens/lab.js',
    'src/js/screens/puzzles.js',
    'src/js/screens/battle.js',
    'public/manifest.json',
    'public/icons/icon.svg',
    'public/icons/icon-192.png',
    'public/icons/icon-512.png',
    'public/icons/apple-touch-icon.png',
    'public/fonts/orbitron-700.woff2',
    'public/fonts/orbitron-900.woff2',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k.startsWith('lever-master-') && k !== CACHE).map(k => caches.delete(k)),
            ))
            .then(() => self.clients.claim()),
    );
});

function putInCache(request, response) {
    if (response && response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
}

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

    // GitHub Pages は 10 分キャッシュさせるので、ブラウザのキャッシュは使わずに毎回たしかめる（no-cache）。
    // そうしないと、ホーム画面に追加したアプリ（とくに iPhone）で古い版がしばらく出つづける
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
                .then(res => putInCache(request, res))
                .catch(() => caches.match(request).then(hit => hit || caches.match('index.html'))),
        );
        return;
    }

    // JS・CSS もネットワーク優先。キャッシュ優先だと、リリース直後に新しい index.html と
    // 古いモジュールが組み合わさることがある。オフラインならキャッシュを使う
    event.respondWith(
        fetch(request, { cache: 'no-cache' })
            .then(res => putInCache(request, res))
            .catch(() => caches.match(request).then(hit => hit || Response.error())),
    );
});
