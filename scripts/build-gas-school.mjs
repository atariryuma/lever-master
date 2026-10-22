/**
 * 学校（naha-okinawa.ed.jp）の Google アカウント用の GAS 版
 *
 * 学校のネットワークでは GitHub Pages（github.io）が読めないことがあるので、
 * アプリ本体を外から読みこまずに1枚の HTML にすべて入れる。
 *   - JS：esbuild で1ファイル（Three.js もふくむ）にまとめ、base64 にして入れる。
 *     そのまま書くと GAS の配信ラッパーの中で「SyntaxError: Invalid or unexpected token」になる
 *     （JS の中の特殊な文字が原因と考えられる）ので、ASCII だけの base64 にしておき、開いたときに戻して実行する
 *   - CSS：<style> にそのまま入れる。フォントは data: URL にする
 *   - PWA の manifest・アイコン・Service Worker は使わない（window.LEVER_GAS = true）
 * 公開範囲は gas-school/appsscript.json の "DOMAIN"（学校のアカウントの人だけ）。
 * デプロイには、学校のアカウントで clasp にログインしておく（clasp login --user school）。
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ROOT, bundleToIife } from './bundle.mjs';

/** 必ず1件以上置きかえる（HTML の形が変わって黙って壊れないように） */
function mustReplace(source, pattern, replacement, label) {
    let hits = 0;
    const out = source.replace(pattern, (...args) => {
        hits++;
        return typeof replacement === 'function' ? replacement(...args) : replacement;
    });
    if (!hits) throw new Error(`[build-gas-school] 置換対象が見つかりません: ${label}`);
    return out;
}

const fontDataUrl = async file =>
    `data:font/woff2;base64,${(await readFile(resolve(ROOT, 'public/fonts', file))).toString('base64')}`;

async function inlineCss() {
    let css = await readFile(resolve(ROOT, 'src/css/styles.css'), 'utf8');
    for (const file of ['orbitron-700.woff2', 'orbitron-900.woff2']) {
        css = mustReplace(css, `url("../../public/fonts/${file}")`, `url("${await fontDataUrl(file)}")`, file);
    }
    return css;
}

/** base64 の JS を、開いたときに文字にもどして実行する小さなローダー */
const LOADER = `<script>
(function () {
    var el = document.getElementById('app-code');
    var bin = atob(el.textContent.replace(/\\s+/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var s = document.createElement('script');
    s.textContent = new TextDecoder('utf-8').decode(bytes);
    el.remove();
    document.body.appendChild(s);
})();
</script>`;

async function main() {
    let html = await readFile(resolve(ROOT, 'index.html'), 'utf8');
    const css = await inlineCss();
    const js = await bundleToIife('src/js/main.js');
    // 76文字ごとに改行（1行が長すぎないように）
    const b64 = Buffer.from(js, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\n');

    html = mustReplace(html, /[ \t]*<!-- gas:strip[^>]*-->[\s\S]*?<!-- \/gas:strip -->\n?/g, '', 'gas:strip');
    html = mustReplace(html, /[ \t]*<link rel="(?:icon|apple-touch-icon|preload)"[^>]*>\n?/g, '', 'icon/preload links');
    html = mustReplace(html, /<link rel="stylesheet" href="src\/css\/styles\.css">/, () => `<style>\n${css}\n</style>`, 'stylesheet');
    html = mustReplace(html, /<\/head>/, '    <script>window.LEVER_GAS = true;</script>\n</head>', 'GAS flag');
    html = mustReplace(
        html,
        /<script type="module" src="src\/js\/main\.js"><\/script>/,
        () => `<script type="text/plain" id="app-code">\n${b64}</script>\n${LOADER}`,
        'app script',
    );
    if (/(?:src|href)="(?:src|public)\//.test(html)) throw new Error('[build-gas-school] 外のファイルへの参照が残っています');

    const banner = '<!-- このファイルは scripts/build-gas-school.mjs による自動生成です。直接編集しないでください。 -->\n';
    await writeFile(resolve(ROOT, 'gas-school', 'index.html'), banner + html);
    console.log(`[build-gas-school] gas-school/index.html を生成しました（${(Buffer.byteLength(html) / 1024).toFixed(0)}KB、外部ファイルなし）`);
}

main().catch(err => {
    console.error(err.message ?? err);
    process.exit(1);
});
