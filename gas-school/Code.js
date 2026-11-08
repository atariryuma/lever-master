/**
 * りかラボ（RIKA LAB）— GAS Web アプリ エントリポイント
 *
 * index.html は scripts/build-gas-school.mjs が自動生成する
 * （アプリ本体の JS・CSS・フォントもすべて入った1枚の HTML。外のファイルは読まない）。
 * このファイルだけは手書きで管理する。
 */

/* global opsGuard_ */ // OpsReport.js で定義（GAS は全ファイルが同じグローバル）

/** ops-monitor 用の入口。例外の「場所」だけを報告し、元の例外は投げ直す（OpsReport.js） */
function doGet() {
    return opsGuard_('doGet', function () { return doGet_(); });
}

/**
 * Web アプリのエントリポイント。
 * @returns {GoogleAppsScript.HTML.HtmlOutput} 描画するページ
 */
function doGet_() {
    return HtmlService.createHtmlOutputFromFile('index')
        .setTitle('りかラボ – RIKA LAB')
        // GAS は <head> 内の meta を除去するため、ここで再指定する。
        // addMetaTag が許可するのは viewport / apple-mobile-web-app-capable /
        // mobile-web-app-capable / google-site-verification の4種のみ。
        .addMetaTag(
            'viewport',
            'width=device-width, initial-scale=1.0, viewport-fit=cover',
        )
        .addMetaTag('apple-mobile-web-app-capable', 'yes')
        .addMetaTag('mobile-web-app-capable', 'yes')
        // Google サイトや Classroom への埋め込みを許可する
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
