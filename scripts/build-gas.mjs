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

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GAS_DIR = resolve(ROOT, 'gas');

/** GAS から配信できない静的アセットの参照先（GitHub Pages） */
const PAGES_BASE = 'https://atariryuma.github.io/lever-master';

/**
 * 必ずマッチする前提の置換。マッチしなければビルドを失敗させる。
 * @param {string} source 対象文字列
 * @param {RegExp} pattern 検索パターン
 * @param {string} replacement 置換後の文字列
 * @param {string} label エラーメッセージ用のラベル
 * @returns {string} 置換後の文字列
 */
function mustReplace(source, pattern, replacement, label) {
    if (!pattern.test(source)) {
        throw new Error(
            `[build-gas] 置換対象が見つかりません: ${label}\n` +
            `  パターン: ${pattern}\n` +
            '  index.html の構造が変わった可能性があります。scripts/build-gas.mjs を更新してください。',
        );
    }
    // test() で lastIndex が進むためリセットする
    pattern.lastIndex = 0;
    return source.replace(pattern, replacement);
}

/**
 * エントリポイントを IIFE 形式の単一スクリプトへバンドルする。
 * @param {string} entry ROOT からの相対パス
 * @returns {Promise<string>} バンドル済みJS
 */
async function bundleToIife(entry) {
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

/**
 * index.html を GAS テンプレート用に変換する。
 * @param {string} html 元の index.html
 * @returns {string} GAS用HTML
 */
function toGasTemplate(html) {
    let out = html;

    // PWA manifest: GAS では manifest.json を配信できない
    out = mustReplace(
        out,
        /\s*<!-- PWA Manifest -->\s*<link rel="manifest"[^>]*>\n/,
        '\n',
        'PWA manifest link の除去',
    );

    // アイコン類: GAS から配信できないため GitHub Pages を参照する
    out = mustReplace(
        out,
        /href="public\//g,
        `href="${PAGES_BASE}/public/`,
        'アイコン参照の絶対URL化',
    );

    // CSS: 外部参照 → インライン化
    out = mustReplace(
        out,
        /<link rel="stylesheet" href="src\/css\/styles\.css">/,
        "<?!= include('styles.css'); ?>",
        'styles.css のインライン化',
    );

    // ES module スクリプト → インライン化した IIFE へ差し替え
    out = mustReplace(
        out,
        /<script type="module" src="src\/js\/performance-monitor\.js"><\/script>/,
        "<?!= include('perfmon.js'); ?>",
        'performance-monitor.js のインライン化',
    );
    out = mustReplace(
        out,
        /<script type="module" src="src\/js\/main\.js"><\/script>/,
        "<?!= include('app.js'); ?>",
        'main.js のインライン化',
    );

    // Service Worker 登録ブロック: GAS の iframe 内では動作しないため除去
    out = mustReplace(
        out,
        /<!-- Service Worker Registration with Auto-Update -->[\s\S]*?<\/script>/,
        '<!-- Service Worker: GAS版では利用不可のためビルド時に除去 -->',
        'Service Worker 登録ブロックの除去',
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
