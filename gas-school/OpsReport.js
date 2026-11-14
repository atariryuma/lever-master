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
 * 「読むだけ」の入口は opsGuardRead_ で包む。Google のサービスの失敗（スプレッドシートが
 * 一時的に応えない等）を 2 回までやり直し、それでも駄目だったときだけ報告する:
 *   function apiGetDay(ymd) { return opsGuardRead_('apiGetDay', function () { return apiGetDay_(ymd); }); }
 * ⚠ 書き込む処理は opsGuardRead_ で包まない（途中まで書いてからやり直すと、二重に書く）。
 *   何度動かしても結果が同じ処理だけにする。
 *
 * 利用者向けのエラー（権限で断った・入力の誤りなど）は userError_('文面') で作る。報告もやり直しもしない。
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
var OPS_FILE_RE_ = /^[\w.\/\-\u3040-\u30ff\u4e00-\u9fff]{1,100}$/;

function opsGuard_(where, fn) {
  try {
    return fn();
  } catch (err) {
    // 権限で断った・入力の誤りなど、利用者向けのエラーは障害ではないので報告しない（本当の障害が埋もれるため）。
    // やり直しの途中（opsGuardRead_ の内側）でも報告しない。まだ通るかもしれないので、
    // やり直しが尽きたときに、いちばん外側の opsGuardRead_ が 1 回だけ報告する。
    // 入れ子の入口（doGet の中の getMonitorData など）を同じ例外が上っていくときは、
    // 最初に受けた入口（＝起きた場所にいちばん近い処理名）だけが報告する
    if (!opsIsUserError_(err) && !opsRetrying_ && !opsAlreadyReported_(err)) opsReport_(where, err);
    throw err;
  }
}

/**
 * 利用者向けのエラーを作る（権限で断った・入力の誤り・混雑など）。
 * opsGuard_ はこれを ops-monitor へ報告しない。画面へ出る文面はふつうの Error と同じ
 */
function userError_(message) {
  var e = new Error(message);
  e.isUserError = true;
  return e;
}

/** この実行の中で報告した例外（同じ例外を入れ子の入口が二重に報告しないため） */
var opsReportedErrs_ = new WeakSet();

/** 同じ例外（同じオブジェクト）をもう報告したか。していなければ、報告したものとして覚える */
function opsAlreadyReported_(err) {
  // 文字列や数値を投げた場合は、同じ値でも別の出来事かもしれないので、まとめない
  if (err === null || (typeof err !== 'object' && typeof err !== 'function')) return false;
  try {
    if (opsReportedErrs_.has(err)) return true;
    opsReportedErrs_.add(err);
  } catch (ignored) {
    // 覚えられなくても、報告はする（二重になるほうが、報告が消えるよりよい）
  }
  return false;
}

function opsIsUserError_(err) {
  try {
    return !!err && err.isUserError === true;
  } catch (ignored) {
    return false;
  }
}

/* ----------------------- 読むだけの入口: 一時的な失敗をやり直す -----------------------
 * Google のサービス（スプレッドシート・ドライブなど）は、こちらに原因が無くても、たまに
 * 応えないことがある。人が見ていない自動の処理（24 時間動く画面・定期実行）では、その 1 回が
 * そのまま障害の報告になる。少し待ってやり直せば通るので、入口でやり直す。
 */

/** やり直す前に待つ時間（ミリ秒）。要素の数＝やり直す回数（最初の 1 回＋2 回、待ちは合計 2 秒） */
var OPS_RETRY_WAITS_MS_ = [500, 1500];

/** いまやり直しの中にいるか（入れ子のときに、回数が掛け算で増えない・途中の失敗を報告しないようにする） */
var opsRetrying_ = false;

/**
 * 「読むだけ」の入口を包む。やり直しても駄目だったときだけ報告して、元の例外を投げ直す。
 * 書き込む処理には使わない（ファイル先頭の ⚠ を参照）。
 */
function opsGuardRead_(where, fn) {
  return opsGuard_(where, function () { return opsRetry_(where, fn); });
}

/** fn を動かす。Google のサービスの例外なら、待ってからやり直す（OPS_RETRY_WAITS_MS_ の回数まで） */
function opsRetry_(where, fn) {
  // 入れ子（読む入口が別の読む入口を呼ぶ）では、外側だけがやり直す
  if (opsRetrying_) return fn();
  opsRetrying_ = true;
  try {
    for (var attempt = 0; ; attempt++) {
      try {
        return fn();
      } catch (err) {
        if (attempt >= OPS_RETRY_WAITS_MS_.length || !opsIsServiceError_(err)) throw err;
        // 文面は書かない（名簿の値が入ることがある）。回数と場所だけを、このプロジェクトのログに残す
        try {
          console.warn('[ops] ' + where + ': やり直し ' + (attempt + 1) + ' 回目');
        } catch (ignored) {
          // ログが書けなくても、やり直しは続ける
        }
        Utilities.sleep(OPS_RETRY_WAITS_MS_[attempt]);
      }
    }
  } finally {
    opsRetrying_ = false;
  }
}

/**
 * Google のサービスが投げた例外か（name が 'Exception'）。
 * 一時的な失敗かどうかは文面を見ないと分からず、文面は言語の設定で変わるので見分けない。
 * 権限が無い・シートが消えた等の直らない失敗も 2 回やり直し、2 秒ほど遅れて同じ例外になる。
 * 自分のコードの誤り（TypeError など）と利用者向けのエラーは、やり直さない。
 */
function opsIsServiceError_(err) {
  try {
    return !!err && err.isUserError !== true && err.name === 'Exception';
  } catch (ignored) {
    return false;
  }
}

function opsReport_(where, err) {
  try {
    var props = PropertiesService.getScriptProperties();
    var url = props.getProperty('OPS_REPORT_URL');
    var token = props.getProperty('OPS_REPORT_TOKEN');
    if (!url || !token) return;

    var kind = err && typeof err.name === 'string' && /^[A-Za-z_$][\w$]{0,63}$/.test(err.name) ? err.name : 'Error';
    var place = opsPlace_(err);
    // UrlFetchApp には打ち切り時間の指定が無い。受け口が遅いと、元の例外の投げ直しもその分だけ待つ
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ where: String(where), kind: kind, file: place.file, line: place.line }),
      muteHttpExceptions: true
    });
  } catch (ignored) {
    // 報告の失敗で本来の処理を止めない。ここで投げると元の例外が隠れる
  }
}

/** スタックの最初の「自分のコード」の行から ファイル名:行 を取り出す。文面は見ない */
function opsPlace_(err) {
  // stack の読み出しや文字列化そのものが投げる値（Object.create(null)・toString が投げる物）でも、場所不明として送る
  var text = '';
  var head = '';
  try {
    text = err && typeof err.stack === 'string' ? err.stack : '';
  } catch (ignored) {
    text = '';
  }
  try {
    head = String(err);
  } catch (ignored) {
    head = '';
  }
  // 先頭の「種類: 文面」は飛ばす（文面に「    at 名前:1:2」の形の行があっても拾わない）
  if (head && text.indexOf(head) === 0) {
    text = text.slice(head.length);
  } else {
    // 先頭が合わない（作ったあとで name や message を変えた例外など）。文面が 1 行なら、
    // 行頭が空白の「at …」の形にはならないので拾わない。複数行の文面は、スタックの中に
    // そのまま見つかったときだけ取り除き、見つからなければ場所不明にする（文面を場所として送らない）
    var msg = '';
    try {
      msg = err && typeof err.message === 'string' ? err.message : '';
    } catch (ignored) {
      msg = '';
    }
    if (msg.indexOf('\n') >= 0) {
      var at = text.indexOf(msg);
      if (at < 0) return { file: '?', line: 0 };
      text = text.slice(at + msg.length);
    }
  }
  var stack = text ? text.split('\n') : [];
  for (var i = 0; i < stack.length; i++) {
    // 例: "    at doGet_ (コード:12:5)" / "    at コード:12:5"
    var m = stack[i].match(/^\s+at (?:.*?\()?([^\s():]+):(\d+):\d+\)?$/);
    if (m && m[1] !== 'OpsReport' && OPS_FILE_RE_.test(m[1])) {
      return { file: m[1], line: Number(m[2]) };
    }
  }
  return { file: '?', line: 0 };
}
