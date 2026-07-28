/**
 * GAS版ビルドスクリプト
 *
 * src/ を単一の真実源として、Google Apps Script の HtmlService で
 * 配信できる形（gas/）へ変換する。
 *
 * GitHub Pages版との差分:
 *   - ES modules → esbuild で IIFE に束ねて HTML へインライン化
 *   - CSS → <style> としてインライン化
 *   - Service Worker → GAS はサンドボックス iframe 配信のため登録不可。除去
 *   - PWA manifest / アイコン → GAS から静的配信できないため GitHub Pages を参照
 *
 * 置換は全て「必ず1件以上マッチする」ことを検証し、
 * 元HTMLの構造が変わって黙って壊れることを防ぐ。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ROOT, bundleToIife } from './bundle.mjs';

const GAS_DIR = resolve(ROOT, 'gas');

/** GAS から配信できない静的アセットの参照先（GitHub Pages） */
const PAGES_BASE = 'https://atariryuma.github.io/lever-master';

/**
 * 必ず1件以上マッチする前提の置換。マッチしなければビルドを失敗させる。
 * @param {string} source 対象文字列
 * @param {RegExp} pattern 検索パターン
 * @param {string|Function} replacement 置換後の文字列または置換関数
 * @param {string} label エラーメッセージ用のラベル
 * @returns {string} 置換後の文字列
 */
function mustReplace(source, pattern, replacement, label) {
    let hits = 0;
    const result = source.replace(pattern, (...args) => {
        hits++;
        return typeof replacement === 'function' ? replacement(...args) : replacement;
    });

    if (hits === 0) {
        throw new Error(
            `[build-gas] 置換対象が見つかりません: ${label}\n` +
            `  パターン: ${pattern}\n` +
            '  index.html のマーカーが消えた可能性があります。',
        );
    }
    return result;
}

/**
 * index.html を GAS テンプレート用に変換する。
 * @param {string} html 元の index.html
 * @returns {string} GAS用HTML
 */
function toGasTemplate(html) {
    let out = html;

    // <!-- gas:strip 理由 --> ... <!-- /gas:strip -->
    // GASで動作しない領域（PWA manifest / Service Worker登録）を丸ごと除去する
    out = mustReplace(
        out,
        /[ \t]*<!-- gas:strip([^>]*)-->[\s\S]*?<!-- \/gas:strip -->\n?/g,
        (_match, reason) => `    <!-- GAS版では除去:${reason.trim()} -->\n`,
        'gas:strip 領域の除去',
    );

    // <!-- gas:inline ファイル名 --> ... <!-- /gas:inline -->
    // 外部参照の領域を GAS のテンプレート取り込みに置き換える
    out = mustReplace(
        out,
        /[ \t]*<!-- gas:inline\s+(\S+)\s*-->[\s\S]*?<!-- \/gas:inline -->/g,
        (_match, filename) => `    <?!= include('${filename}'); ?>`,
        'gas:inline 領域の取り込み化',
    );

    // アイコン類: GAS から配信できないため GitHub Pages を参照する
    out = mustReplace(
        out,
        /href="public\//g,
        `href="${PAGES_BASE}/public/`,
        'アイコン参照の絶対URL化',
    );

    return out;
}

async function main() {
    await mkdir(GAS_DIR, { recursive: true });

    const [indexHtml, css, appJs, perfJs] = await Promise.all([
        readFile(resolve(ROOT, 'index.html'), 'utf8'),
        readFile(resolve(ROOT, 'src/css/styles.css'), 'utf8'),
        bundleToIife('src/js/main.js'),
        bundleToIife('src/js/performance-monitor.js'),
    ]);

    const banner = '<!-- このファイルは scripts/build-gas.mjs による自動生成です。直接編集しないでください。 -->\n';

    await Promise.all([
        writeFile(resolve(GAS_DIR, 'index.html'), banner + toGasTemplate(indexHtml)),
        writeFile(resolve(GAS_DIR, 'styles.css.html'), `${banner}<style>\n${css}\n</style>\n`),
        writeFile(resolve(GAS_DIR, 'app.js.html'), `${banner}<script>\n${appJs}\n</script>\n`),
        writeFile(resolve(GAS_DIR, 'perfmon.js.html'), `${banner}<script>\n${perfJs}\n</script>\n`),
    ]);

    const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)}KB`;
    console.log('[build-gas] gas/ を生成しました');
    console.log(`  index.html      ${kb(indexHtml)}`);
    console.log(`  styles.css.html ${kb(css)}`);
    console.log(`  app.js.html     ${kb(appJs)}`);
    console.log(`  perfmon.js.html ${kb(perfJs)}`);
}

main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
});
