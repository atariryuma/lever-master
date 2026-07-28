/**
 * スモークテスト
 * バンドル済みのアプリをjsdom上で読み込み、ロード時・初期化時のエラーを検出する。
 * ゲームの見た目は検証しない（WebGLはjsdomに無いため初期化失敗パスを通る）。
 *
 * @vitest-environment node
 *
 * ⚠️ node環境で動かし、JSDOMは手動で組む。
 * vitest既定のjsdom環境ではesbuildが必要とする TextEncoder の不変条件が壊れるため。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, bundleToIife } from '../scripts/bundle.mjs';

/** Three.js は CDN 依存なので最小限のスタブを置く（描画は検証対象外） */
function createStubMesh() {
    return {
        position: { set() {}, x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { set() {}, setScalar() {} },
        material: {
            opacity: 1,
            color: { setHex() {} },
            emissive: { setHex() {} },
            dispose() {},
        },
        geometry: { dispose() {} },
        add() {}, remove() {}, traverse() {},
        visible: true,
        userData: {},
    };
}

function installThreeStub(window) {
    window.THREE = new Proxy({}, {
        get: (_target, prop) => {
            if (prop === 'Color') {
                return class { constructor() { this.r = 0; this.g = 0; this.b = 0; } };
            }
            if (prop === 'Vector3') {
                return class {
                    constructor() { this.x = 0; this.y = 0; this.z = 0; }
                    project() { return this; }
                };
            }
            if (prop === 'Vector2') {
                return class { constructor() { this.x = 0; this.y = 0; } };
            }
            if (prop === 'PCFSoftShadowMap') return 1;
            // Group を含む全コンストラクタはスタブメッシュを返す
            return function StubCtor() { return createStubMesh(); };
        },
    });
}

function installCanvasStub(window) {
    window.HTMLCanvasElement.prototype.getContext = function(type) {
        if (type === '2d') {
            return {
                fillStyle: '', font: '', textAlign: '', textBaseline: '',
                strokeStyle: '', lineWidth: 0, lineCap: '',
                fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
            };
        }
        return null;  // WebGL非対応 → 初期化失敗パスを通す
    };
}

describe('アプリのロード', () => {
    const errors = [];
    let window;

    beforeAll(async () => {
        const bundle = await bundleToIife('src/js/main.js');
        const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

        ({ window } = new JSDOM(html, {
            runScripts: 'outside-only',
            pretendToBeVisual: true,
            url: 'https://example.com/',
        }));

        installThreeStub(window);
        installCanvasStub(window);
        window.addEventListener('error', (e) => errors.push(`window.error: ${e.message}`));

        try {
            window.eval(bundle);
        } catch (e) {
            errors.push(`load: ${e.message}`);
        }

        // 初期化パス（window.onload）を通す
        try {
            window.dispatchEvent(new window.Event('load'));
        } catch (e) {
            errors.push(`onload: ${e.message}`);
        }

        // キーボード操作（FOV変更・Escape）も叩く
        try {
            window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '+' }));
            window.document.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Escape' }));
        } catch (e) {
            errors.push(`keydown: ${e.message}`);
        }
    });

    it('読み込み・初期化・キー操作でエラーが出ない', () => {
        expect(errors).toEqual([]);
    });

    it('WebGL非対応時もクラッシュせずエラー表示にフォールバックする', () => {
        expect(window.document.body.textContent).toContain('WebGL');
    });
});
