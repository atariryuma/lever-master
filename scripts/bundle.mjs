/**
 * ES modules を単一のIIFEへ束ねる共通処理
 *
 * スモークテストで jsdom に読み込むために使う（同梱の src/vendor/three.js も含めて1ファイルになる）。
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
        legalComments: 'inline',
        minify: true,
    });
    return result.outputFiles[0].text;
}
