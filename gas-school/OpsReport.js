/**
 * ops-monitor へエラーの「場所」だけを送る（Apps Script 用。このファイルを各プロジェクトへ写す）。
 *
 * 送るもの: 処理名（where）・Error の name・ファイル名と行。
 * 送らないもの: エラーの文面（名簿の値がそのまま入ることがある）・引数・シートの値・URL のクエリ。
 *
 * 使い方（入口を包む。元の例外はそのまま投げ直すので、動きは変わらない）:
 *   function doGet(e)  { return opsGuard_('doGet',  function () { return doGet_(e); }); }
 *   function doPost(e) { return opsGuard_('doPost', function () { return doPost_(e); }); }
 *   function nightly() { return opsGuard_('nightly', nightly_); }
 *
 * スクリプトプロパティ:
 *   OPS_REPORT_URL   … https://ops-monitor.<アカウント>.workers.dev/report
 *   OPS_REPORT_TOKEN … scripts/add-app.mjs で作ったトークン
 * どちらかが無ければ何も送らない（入れ忘れで本来の処理を止めない）。
 *
 * ⚠ UrlFetchApp を初めて使うプロジェクトでは、外部への接続の権限（script.external_request）の
 *   承認がもう一度要る。Web アプリは承認し直すまで止まることがあるので、反映の前に確かめる。
 */

// 受け口（src/receiver.ts の FILE_RE）が受け付ける形にそろえる
const OPS_FILE_RE_ = /^[\w./\-\u3040-\u30ff\u4e00-\u9fff]{1,100}$/;

function opsGuard_(where, fn) {
    try {
        return fn();
    } catch (err) {
        opsReport_(where, err);
        throw err;
    }
}

function opsReport_(where, err) {
    try {
        const props = PropertiesService.getScriptProperties();
        const url = props.getProperty('OPS_REPORT_URL');
        const token = props.getProperty('OPS_REPORT_TOKEN');
        if (!url || !token) return;

        const kind = err && typeof err.name === 'string' && /^[A-Za-z_$][\w$]{0,63}$/.test(err.name) ? err.name : 'Error';
        const place = opsPlace_(err);
        UrlFetchApp.fetch(url, {
            method: 'post',
            contentType: 'application/json',
            headers: { Authorization: 'Bearer ' + token },
            payload: JSON.stringify({ where: String(where), kind: kind, file: place.file, line: place.line }),
            muteHttpExceptions: true,
            // UrlFetchApp には待ち時間の上限の指定が無い（timeoutSeconds などは効かない）。
            // 受け口が遅いと、そのぶん元のエラーの応答も遅れる
        });
    } catch (ignored) {
    // 報告の失敗で本来の処理を止めない。ここで投げると元の例外が隠れる
    }
}

/** スタックの最初の「自分のコード」の行から ファイル名:行 を取り出す。文面は見ない */
function opsPlace_(err) {
    const stack = err && typeof err.stack === 'string' ? err.stack.split('\n') : [];
    for (let i = 0; i < stack.length; i++) {
    // 例: "    at doGet_ (コード:12:5)" / "    at コード:12:5"
        const m = stack[i].match(/^\s+at (?:.*?\()?([^\s():]+):(\d+):\d+\)?$/);
        if (m && m[1] !== 'OpsReport' && OPS_FILE_RE_.test(m[1])) {
            return { file: m[1], line: Number(m[2]) };
        }
    }
    return { file: '?', line: 0 };
}
