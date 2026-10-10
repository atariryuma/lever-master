/**
 * GAS版ビルドスクリプト
 *
 * index.html を Google Apps Script の HtmlService で配信できる形（gas/index.html）へ変換する。
 *
 * GAS 版はアプリ本体（JS・CSS・Three.js・フォント・アイコン）を GitHub Pages から読み込む。
 *   - 以前は JS を1ファイルにまとめて HTML にインライン化していたが、Three.js を同梱して
 *     600KB を超えると GAS の配信ラッパー内で SyntaxError になったため、この方式にした
 *   - GitHub Pages は Access-Control-Allow-Origin: * で配信するので、GAS の iframe から
 *     ES modules をそのまま読み込める
 *   - PWA manifest は除去。window.LEVER_GAS = true でアプリ側の SW 登録などを止める
 *   - キャッシュ対策として、エントリ（main.js / styles.css）に ?v=<コミット> を付ける
 *   - main.js から import されるモジュールにも ?v= を付けるため、import map で
 *     「Pages 上の各 .js の URL → ?v=<コミット> 付きの URL」を対応づける。
 *     これでブラウザに古いモジュール（Pages は max-age=600）が残っていても、新旧が混ざらない
 *
 * ⚠️ GitHub Pages に同じコミットがデプロイされてから GAS を更新すること
 *    （main に push → Pages の Actions 完了 → npm run deploy:gas）。
 *
 * 置換は全て「必ず1件以上マッチする」ことを検証し、
 * 元HTMLの構造が変わって黙って壊れることを防ぐ。
 */

import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { relative, resolve } from 'node:path';

import { ROOT } from './bundle.mjs';

const GAS_DIR = resolve(ROOT, 'gas');

/** GAS から配信できない静的アセットの参照先（GitHub Pages）。ローカル検証用に上書きできる */
const PAGES_BASE = process.env.GAS_PAGES_BASE ?? 'https://atariryuma.github.io/lever-master';

/** dir 以下の .js をすべて（ROOT からの相対パス） */
async function listJs(dir) {
    const entries = await readdir(resolve(ROOT, dir), { withFileTypes: true, recursive: true });
    return entries
        .filter(e => e.isFile() && e.name.endsWith('.js'))
        .map(e => relative(ROOT, resolve(e.parentPath ?? e.path, e.name)).replaceAll('\\', '/'))
        .sort();
}

/** すべてのモジュールを ?v=<コミット> 付きで読ませる import map */
async function importMap(version) {
    const files = [...await listJs('src/js'), ...await listJs('src/vendor')];
    const imports = Object.fromEntries(files.map(f => [`${PAGES_BASE}/${f}`, `${PAGES_BASE}/${f}?v=${version}`]));
    return `    <script type="importmap">${JSON.stringify({ imports })}</script>\n`;
}

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
 * index.html を GAS 用に変換する。
 * @param {string} html 元の index.html
 * @param {string} version キャッシュ対策のクエリ
 * @returns {string} GAS用HTML
 */
function toGasHtml(html, version, map) {
    let out = html;

    // <!-- gas:strip 理由 --> ... <!-- /gas:strip -->
    // GASで動作しない領域（PWA manifest）を丸ごと除去する
    out = mustReplace(
        out,
        /[ \t]*<!-- gas:strip([^>]*)-->[\s\S]*?<!-- \/gas:strip -->\n?/g,
        (_match, reason) => `    <!-- GAS版では除去:${reason.trim()} -->\n`,
        'gas:strip 領域の除去',
    );

    // アプリ本体（CSS・JS）は GitHub Pages から読み込む
    out = mustReplace(
        out,
        /(href|src)="src\/(css\/styles\.css|js\/main\.js)"/g,
        (_match, attr, path) => `${attr}="${PAGES_BASE}/src/${path}?v=${version}" crossorigin`,
        'アプリ本体の参照を GitHub Pages へ',
    );

    // アイコン類も GitHub Pages を参照する
    out = mustReplace(out, /href="public\//g, `href="${PAGES_BASE}/public/`, 'アイコン参照の絶対URL化');

    // アプリより先に GAS 版の目印を置く
    out = mustReplace(
        out,
        /<\/head>/,
        `    <script>window.LEVER_GAS = true;</script>\n${map}</head>`,
        'GAS 版フラグの挿入',
    );

    return out;
}

async function main() {
    await mkdir(GAS_DIR, { recursive: true });
    // 以前のインライン方式の生成物を消す（clasp push で GAS 側からも消える）
    await Promise.all(['styles.css.html', 'app.js.html', 'perfmon.js.html']
        .map(f => rm(resolve(GAS_DIR, f), { force: true })));

    const version = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
    const indexHtml = await readFile(resolve(ROOT, 'index.html'), 'utf8');
    const banner = '<!-- このファイルは scripts/build-gas.mjs による自動生成です。直接編集しないでください。 -->\n';
    const out = banner + toGasHtml(indexHtml, version, await importMap(version));
    await writeFile(resolve(GAS_DIR, 'index.html'), out);

    console.log(`[build-gas] gas/index.html を生成しました（${(Buffer.byteLength(out) / 1024).toFixed(1)}KB, v=${version}）`);
    console.log(`  アプリ本体: ${PAGES_BASE}/`);
}

main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
});
