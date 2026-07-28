// main.js をjsdom上で読み込み、ロード時エラー・window.onload実行時エラーを検出する
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(`${ROOT}/index.html`, 'utf8');
// バンドル済みのGAS用スクリプトを流用（ES moduleを解決済みの1本になっている）
const bundle = readFileSync(`${ROOT}/gas/app.js.html`, 'utf8')
    .replace(/^[\s\S]*?<script>/, '')
    .replace(/<\/script>\s*$/, '');

const errors = [];

const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://example.com/',
});
const { window } = dom;

window.addEventListener('error', (e) => errors.push(`window.error: ${e.message}`));

// Three.js は CDN なので最小限のスタブを置く（描画は検証対象外）
const stubMesh = () => ({
    position: { set() {}, x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { set() {}, setScalar() {} },
    material: { opacity: 1, color: { setHex() {} }, emissive: { setHex() {} }, dispose() {} },
    geometry: { dispose() {} },
    add() {}, remove() {}, traverse() {},
    visible: true, userData: {},
});
class Group { constructor() { Object.assign(this, stubMesh()); } }
window.THREE = new Proxy({}, {
    get: (_t, prop) => {
        if (prop === 'Group') return Group;
        if (prop === 'Color') return class { constructor() { this.r = 0; this.g = 0; this.b = 0; } };
        if (prop === 'Vector3') return class { constructor() { this.x = 0; this.y = 0; this.z = 0; } project() { return this; } };
        if (prop === 'Vector2') return class { constructor() { this.x = 0; this.y = 0; } };
        if (prop === 'PCFSoftShadowMap') return 1;
        return function StubCtor() { return stubMesh(); };
    },
});
// WebGL は無いので初期化失敗パスを通す（それ自体もハンドリング対象）
window.HTMLCanvasElement.prototype.getContext = function(type) {
    if (type === '2d') {
        return { fillStyle: '', font: '', textAlign: '', textBaseline: '',
            fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
            strokeStyle: '', lineWidth: 0, lineCap: '' };
    }
    return null;
};

try {
    window.eval(bundle);
} catch (e) {
    errors.push(`load: ${e.message}`);
}

// window.onload を発火させて初期化パスを通す
try {
    window.dispatchEvent(new window.Event('load'));
    if (typeof window.onload === 'function') window.onload();
} catch (e) {
    errors.push(`onload: ${e.message}`);
}

// キーボード操作（FOV変更・Escape）も一度叩く
try {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '+' }));
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Escape' }));
} catch (e) {
    errors.push(`keydown: ${e.message}`);
}

if (errors.length) {
    console.error('❌ スモークテスト失敗:');
    errors.forEach(e => console.error('  -', e));
    process.exit(1);
}
console.log('✅ スモークテスト成功: ロード・onload・キー操作でエラーなし');
