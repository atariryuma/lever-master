/**
 * LEVER MASTER — GAS Web アプリ エントリポイント
 *
 * index.html / styles.css.html / app.js.html / perfmon.js.html は
 * scripts/build-gas.mjs が src/ から自動生成する。
 * このファイルだけは手書きで管理する。
 */

/**
 * Web アプリのエントリポイント。
 * @returns {GoogleAppsScript.HTML.HtmlOutput} 描画するページ
 */
function doGet() {
    return HtmlService.createTemplateFromFile('index')
        .evaluate()
        .setTitle('LEVER MASTER')
        // GAS は <head> 内の meta を除去するため、ここで再指定する。
        // addMetaTag が許可するのは viewport / apple-mobile-web-app-capable /
        // mobile-web-app-capable / google-site-verification の4種のみ。
        .addMetaTag(
            'viewport',
            'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
        )
        .addMetaTag('apple-mobile-web-app-capable', 'yes')
        .addMetaTag('mobile-web-app-capable', 'yes')
        // Google サイトや Classroom への埋め込みを許可する
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * HTML テンプレートから他ファイルを取り込むためのヘルパー。
 * index.html 内で <?!= include('app.js'); ?> のように使う。
 * @param {string} filename 拡張子 .html を除いたファイル名
 * @returns {string} ファイルの中身
 */
function include(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
