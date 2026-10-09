/**
 * LEVER MASTER — GAS Web アプリ エントリポイント
 *
 * index.html は scripts/build-gas.mjs が自動生成する
 * （アプリ本体の JS・CSS は GitHub Pages から読み込む）。
 * このファイルだけは手書きで管理する。
 */

/**
 * Web アプリのエントリポイント。
 * @returns {GoogleAppsScript.HTML.HtmlOutput} 描画するページ
 */
function doGet() {
    return HtmlService.createHtmlOutputFromFile('index')
        .setTitle('てこマスター – LEVER MASTER')
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
