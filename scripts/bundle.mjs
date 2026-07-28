/**
 * ES modules を単一のIIFEへ束ねる共通処理
 *
 * GAS版のビルド（build-gas.mjs）とスモークテストの両方が同じバンドルを必要とするため、
 * ここ1箇所に置いて共有する。
 */

import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * エントリポイントを IIFE 形式の単一スクリプトへバンドルする。
 * @param {string} entry ROOT からの相対パス
 * @returns {Promise<string>} バンドル済みJS
 */
export async function bundleToIife(entry) {
    const result = await build({
        entryPoints: [resolve(ROOT, entry)],
        bundle: true,
        format: 'iife',
        target: 'es2020',
        platform: 'browser',
        write: false,
        legalComments: 'none',
        // THREE は CDN から global として読み込むためバンドルしない
        external: ['three'],
    });
    return result.outputFiles[0].text;
}
