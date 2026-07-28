/**
 * Service Worker のプリキャッシュ一覧が実際のファイル構成とずれていないか検証する。
 *
 * sw.js の CORE_ASSETS は手書きの一覧で、main.js の import 先が1つでも漏れると
 * オフライン初回起動時に module の解決に失敗してゲームが起動しない。
 * この不具合は「インストール直後にオフラインにする」でしか再現せず、
 * 普段の動作では露見しないため、機械的に検出する。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swSource = readFileSync(resolve(ROOT, 'sw.js'), 'utf8');

/** sw.js の CORE_ASSETS からパスを抜き出す（テンプレートリテラルの中身） */
function readCoreAssets() {
    const block = swSource.match(/const CORE_ASSETS = \[([\s\S]*?)\];/);
    if (!block) throw new Error('sw.js に CORE_ASSETS が見つかりません');

    return [...block[1].matchAll(/\$\{BASE_PATH\}(\/[^`']*)/g)].map(m => m[1]);
}

describe('Service Worker のプリキャッシュ', () => {
    it('src/js/ の全モジュールが CORE_ASSETS に入っている', () => {
        const coreAssets = readCoreAssets();
        const modules = readdirSync(resolve(ROOT, 'src/js'))
            .filter(name => name.endsWith('.js'))
            .map(name => `/src/js/${name}`);

        const missing = modules.filter(path => !coreAssets.includes(path));

        expect(missing, `sw.js の CORE_ASSETS に追加してください: ${missing.join(', ')}`)
            .toEqual([]);
    });

    it('CSSとエントリポイントが CORE_ASSETS に入っている', () => {
        const coreAssets = readCoreAssets();

        expect(coreAssets).toContain('/index.html');
        expect(coreAssets).toContain('/src/css/styles.css');
    });

    it('CORE_ASSETS に存在しないファイルが含まれていない', () => {
        // addAll は1つでも404だとインストール全体が失敗するため、綴り間違いを検出する
        const coreAssets = readCoreAssets().filter(path => path !== '/');
        const notFound = coreAssets.filter((path) => {
            try {
                readFileSync(resolve(ROOT, `.${path}`));
                return false;
            } catch {
                return true;
            }
        });

        expect(notFound, `sw.js が存在しないファイルを参照しています: ${notFound.join(', ')}`)
            .toEqual([]);
    });
});
