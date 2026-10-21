# 開発者ガイド

ビルド不要の静的サイト（ES Modules）です。`index.html` をそのまま配信すれば動きます。

## ディレクトリ構成

```
index.html              画面の骨組み（ホーム・一覧・準備・プレイ・ダイアログ）
sw.js                   Service Worker（全ファイルを事前キャッシュ）
public/                 manifest とアイコン
src/css/styles.css      デザイン（CSS変数でトークン管理）
src/js/
  main.js               画面遷移・ダイアログ・設定・PWA
  engine/               ★ DOM に依存しない純粋なゲームロジック（テスト対象）
    lever.js            盤面モデル・はたらきの計算・つるす/動かす
    battle.js           たいせんのルール（状態は毎回コピーして返す）
    ai.js               CPU（やさしい/ふつう/つよい）
    puzzles.js          もんだいデータとソルバー
  view/
    lever-view-3d.js    3D のてこ（Three.js）。ふだんはこちら
    lever-view.js       SVG のてこ（「図」の表示。WebGL が使えないときもこれ。?2d で強制）。ゆれの計算（stepSpring/kickFor）もここ
    weight-art.js       おもりの絵（2D・ドラッグ中の表示）
  screens/              モードごとの画面ロジック（lab / puzzles / battle）
  ui.js widgets.js      共通 UI 部品（計算式パネル・バナー・トースト・セグメント等）
  fx.js                 画面全体の演出（たいせん・もんだいクリア）
  icons.js              SVG アイコン（スプライトを <body> に入れ、icon('名前') で使う。絵文字は使わない）
  keep.js               水平キープのゲージ（つり合ったまま静まると決定）
  rules-tour.js         たいせんのあそびかた（絵の4ステップ。はじめての対戦の前に自動で開く）
  players.js            プレイヤーの名前・色・記号
  audio.js storage.js   効果音・BGM／localStorage
__tests__/              Vitest
src/vendor/three.js     同梱した Three.js（使う部品だけ。`npm run vendor` で作り直す）
public/fonts/           同梱フォント（Orbitron, SIL OFL）
scripts/vendor.mjs      Three.js とフォントを同梱するスクリプト
scripts/bundle.mjs      esbuild で main.js を1ファイル（IIFE）にまとめる（スモークテスト用）
scripts/build-gas.mjs   index.html → gas/index.html 変換ビルド
gas/Code.js             GAS の doGet（手書き。gas/index.html は自動生成で git 管理外）
```

## 設計のポイント

- **ロジックと表示を分離**：`engine/` は純粋関数のみ。画面側は「状態 → `render()`」で描き直すだけ。
- **単元のハブ**：`main.js` の `UNITS` にロゴ・モードのカード・きほんのダイアログを持ち、ホームのセグメントで切りかえる（`settings.unit` に保存）。各モードモジュールは `UNIT`（'lever' | 'pendulum'）と `HELP`（topbar の本ボタンで開くダイアログ）を持ち、`enterPlay` が単元に合わせてステージ（`#lever*` / `#pendulum*`）と計測パネル（`#readout` / `#pend-readout`）を切りかえる。ふりこのビューは、はじめてふりこの画面に入るときに作る。
- **物理エンジン（`engine/physics.js`）**：2D・3D のビューは毎フレーム `stepLever` / `stepSwing` を呼び、返ってきた角度を描くだけ。固定きざみ（1/240 秒）の半陰的オイラー法。
  - てこ：`I·θ'' = g·Σ m·x·cosθ − g·(M_b·h + M_w·d)·sinθ − c·θ'`。おもりのトルク（フックの水平きょり）と、支点より下にあるうでの重心・フックによる復元トルク。つり合う角度は `atan(差 / K)` で、差が大きいほど大きく傾き、±12° のストッパーにぶつかる（はね返り 0.22）。減衰は減衰比 0.28 から出すので、おもりが増えてもゆれ方は同じに見える。つるした・はずしたおもりは `dropImpulse`（落ちてきた衝撃）で反動を与える。「ささえる」は θ = 0 に固定。
  - ふりこ：`θ'' = −(g/L)·θ − 2γ·θ'`。復元力を角度に比例させ、教科書どおり「ふれはばを変えても時間は変わらない」ようにしてある（本物の sinθ では 30° で 1.7% 長くなる）。1往復は「持ち上げた側のはしにもどった（角速度の向きが切りかわった）」で数え、`swing.cycleTimes` に時刻がたまる。10往復の時間はこの実測を使う（答え・目標の計算は `pendulum.js` の理論値）。
  - はやおくり：ビューの `timeScale` で1フレームの経過を3倍にする。物理のきざみは変わらない。
- **水平キープ**（`keep.js`）：「静まって水平（`view.isLevel()`）」が続くとゲージがたまり、たまりきると決定。たいせんは 2 秒で自動けってい、もんだいは手をはなしたあと 0.9 秒でクリア、ぜんぶつるして 2.5 秒さわらなければ自動でたしかめる。じっけんは 0.7 秒でお祝い。ボタンはキーボード・読み上げ用にのこす。
- **判定は物理の状態で**：セーフ／アウト・クリア・お祝いは、式の差ではなく `view.isLevel()`（手をはなしていて、静まっていて、傾き 0.8° 未満）で決める。物理ではつり合えば 0°、差が 10 でも 2.7° 以上かたむくので式と同じ結果になるが、見えている動きと判定が一致する。たいせんの `judge()` は ひと・CPU とも同じ手順：静まるまで待つ（最大 3 秒）→ 水平でなければその場で OUT → 水平なら「水平キープ」のゲージ（1.2 秒）を見せてから SAFE。ひとのゲージ（2 秒）で決まったときはゲージを繰り返さない。`release(state, { balanced })` に物理の結果を渡す。
- **直接さわる操作**：てこの外（下の操作エリア）へドラッグすると、元にもどす・はずす（`handlers.dropLabel` が案内を返すと、操作エリアに表示）。たいせんの「動かす」は何度でもやりなおせ、別のおもりを動かすと前の分は元にもどる。
- **「図で予想 → 3D でたしかめる」**：もんだいでは、傾かない図（2D）の上でおもりを置いて予想し、「3Dでたしかめる」で 3D に切りかえて手をはなす（予想→実験の流れ）。はずれたら図にもどり、どちらが重いかを表示する。WebGL が無いときは図のまま「手をはなす」。たいせんではささえず、つるすたびにその場で傾く。計算式が常に見えていてささえに意味がないため。
- **たいせんの演出**：`fx.js`（画面全体：ターン開始の帯・SAFE!/OUT!! のたたきつけ・赤いふち・得点ポップ・紙吹雪）と `LeverView3D.fx()`（火花・衝撃波・アウト時のゆれ・判定時のカメラの寄り・警告灯）。2D 版の `fx()` は何もしない。BGM は `setBgm('battle', 0〜2)` で試合の進み具合に合わせて速くなる。
- **道づれ（くさり）**：たいせんでは、つかんだおもりの下にぶら下がっているおもりもいっしょに動く（`lever.moveChain`）。ビューは `render({ chainMoves: true })` で、選択・ドラッグ表示をくさりごとにする。
- **ターンの始まり**：FINAL ROUND・TURN の帯のあいだは `ui.busy`（`ui.intro`）で操作を止める。帯の途中で判定まで進むと、ターンの流れが2本走るため。
- **時間切れ**：つるしてあれば `release` でそのまま判定、まだなら `forfeit` でアウト。
- **アウトの扱い**：かたむけたプレイヤーはアウトになり、てこはそのターンの前の状態にもどる（次の人が不利にならない）。
- **ブラウザ・スマホの「戻る」**：ホーム以外では履歴に見張り（`pushState`）を1つ積み、`popstate` でアプリの「もどる」と同じ動き（ダイアログを閉じる → 画面ごとの `back()`。たいせんは「やめますか？」）をする。ホームでの「戻る」だけはアプリを出る。
- **モード共通のプレイ画面**：`main.js` が `enter / leave / back` を持つモードモジュールを切りかえる。てこのビューは1つを使い回し、`handlers` を差しかえる。
- **3D と 2D は同じ使い方**：`LeverView3D` と `LeverView` はどちらも `render / settle / startDrag / positionAt / handlers / body` を持つので、画面側は区別しない。3D ではキーボード・読み上げ用に透明なボタンを 3D の位置に重ねている。切りかえるときは `syncBody` で物理の状態を引きつぐ。
- **ふりこのビュー**：`PendulumView3D` と `PendulumView` も同じ形（`render({ pendulums, selectedId, interactive, highlight }) / handlers / timeScale / fx`）。ふりこ（`engine/pendulum.js` の Pendulum）は `phase`（rest / held / swinging / stopped）と `swing`（物理の状態）を持ち、画面側が持つ配列をビューがそのまま進める（コピーしない）。おもりを横にドラッグすると `onBobDrag(id, ふれはば, 側)`、はなすと `onBobRelease(id)`、往復するたびに `onCycle(p, n)`、毎フレーム `onFrame(dt)` が届く。
- **ふりこ じっけん**：A は固定（50cm・10g・20°）。「変える条件」を1つえらび、B はその条件だけを変える（条件制御を体験させるため、自由に全部は変えない）。ドラッグで持ち上げると2つのふれはばをそろえる（ふれはばを調べるときだけ別々）。
- **ふりこ もんだい**：`kind`（compare / control / tune / choice）で選択肢の作り方が変わる（`optionsOf`）。答えはデータに書かず `correctOption` が物理から求め、テストが「答えがちょうど1つ」を確かめる。予想は図（2D）、たしかめは 3D（てこと同じ流れ）。はやいほうが10往復したら結果が出る。
- **ふりこ たいせん**：`createMatch → choose（順番に）→ resolveRound(state, 実測の時間)→ nextRound`。長さは **ないしょ** で決める（画面は、はなすまで自分以外の長さを「？」にする＝`visiblePendulums()`。CPU も考える時間だけ見せる）。まね・先取りがないので、同じ長さでもよい。はなす前に「OPEN!」で全員の長さを見せる。（ふれはばでの微調整は入れない：「ふれはばを変えても時間は変わらない」が学習内容なので）評価は目標との差（PERFECT ±0.1秒 100点 / GREAT 0.3 / GOOD 0.6 / OK 1.0 / MISS）。先頭はラウンドごとに入れかわる。CPU は目標の長さ±（やさしい 14cm / ふつう 5cm / つよい 1.2cm）で、やさしいはときどき重いおもりをえらぶ。ヒントの表（25/50/75/100cm）を線形補間する子どもは ±1cm ほどで決められるので、シミュレーションでは つよい にほぼ五分、ふつう には 9 割勝てる（`engine/pend-ai.js` のコメント参照）。えらぶときは、お題カードと **「長さ → 10往復の時間」のグラフ**（`aimChart`：横＝長さ、たて＝時間。ヒントの表の点（白ぬき）、これまでのラウンドで全員が実測した点（その人の色・R1 などのラベル）、ねらいの横線、いまえらんでいる長さのたて線）を出す。点をつなぐ線は引かない：ねらいの線と点のならびから長さを読み取るのが遊び（ヒントなしでも 2 ラウンド目からは手がかりがある）。
  - 見せ方：えらぶ画面は「お題・グラフ・長さとけってい」の 3 つだけ（`.choose`）。計測パネル・ステップ表示・重さ／ふれはばの選択は出さない。**自分のおもりを上下にドラッグすると長さが変わる**（ビューの `dragMode: 'length'` → `onBobLength(id, cm)`。つまみと ± は補助、キーボードは上下の矢印）。えらぶあいだのふりこはまっすぐ下げておき、全員決まったら そろって持ち上げて 3・2・1 → GO!。全員同時にはなすので、ステージの下に共通のストップウォッチ（`#stopwatch`）、ねらいの時刻でフラッシュ。往復の回数はふりこの上の名札の中に 1〜10 で出す（`tagLabel`。横に長いラベルをふりこのそばに出すと、4人のときにとなりと重なるので）。10往復したら名札が光る。時間は下の計測パネル。ラウンドのけっかは **全画面の RESULT**（`#reveal`・`revealRound()`）：ドラムロール → 下の順位から1人ずつ → 1位の前にためて金色の演出 → 合計点のバーがのびてカウントアップ → 「つぎのラウンドへ」（タップで残りをとばせる）。評価は画面でもエンジンの `gradeFor` を使う。
- **ふりこのビューのドラッグ**：`handlers.dragMode(id)` が 'swing'（横に持ち上げる）／'length'（上下で長さ）／'auto'（最初に動いた向きで決める）を返す。長さのドラッグのあとは `onLengthEnd`（`onBobRelease` は呼ばない＝ふれない）。じっけんでは「変える条件＝長さ」のとき B が 'auto'（上下で 25/50/75/100cm にそろう）。
- **3D と図（2D）の切りかえ**：`main.js` は 2D を常に、3D を使えるときだけ作る。じっけんの「図で見る」で `setViewKind()` が handlers を引きついで切りかえ、モードの `refresh()` で描き直す。もんだいは `app.setView()` で場面に合わせて切りかえる（予想＝図、たしかめ＝3D）。たいせんは常に 3D。
- **面積図**：`renderReadout(..., { area: true })` で、横＝きょり・縦＝重さの長方形を左右同じ縮尺で描く（面積＝はたらき）。
- **ホームの 3D デモは軽く**：`showcaseThrottle` で、スクロール中と直後（200ms）・画面の外では描かず、30fps まで。影なし、ピクセル比は 1.25 まで（WebGL を毎フレーム描きながらスクロールすると、スクロールの描画が間に合わなかった）。
- **ポップアップ**：上のプレイヤーのチップから出すときは `popup(..., { down: true })` で下へ動かす（上へ動くとチップの文字にかぶる）。
- **BGM**：`audio.js` の `TRACKS`（menu / study / battle）。`main.js` の `ROUTE_BGM` で画面ごとに切りかえ。音量は `settings.sfxVolume / bgmVolume`。
- **色は CSS が正**：プレイヤーやおもりの色は `styles.css` の CSS 変数で定義し、3D 側もそれを読む。
- **Three.js の更新**：`package.json` の three を上げて `npm run vendor` → `src/vendor/three.js` をコミット。新しい部品を import したときも `npm run vendor` を実行する。

## テスト

```bash
npm test        # 1回実行
npm run lint
npm run check   # 両方
```

- `lever.test.js` 盤面・計算
- `physics.test.js` てこ（つり合えば水平、重いほうが下がる、差が大きいほど傾く、ストッパー、反動）とふりこ（10往復の実測が理論と合う、重さ・ふれはばで変わらない、減衰）
- `battle.test.js` ルール（となりNG、今つるした場所NG、道づれ、アウト時の巻きもどし、時間切れ、順位）
- `tilt.test.js` 2D・3D とも重いほうが下がる
- `ai.test.js` CPU 同士で最後まで対戦できる
- `puzzles.test.js` すべてのもんだいに解があることをソルバーで検証
- `pendulum.test.js` ふりこの理論・条件制御の判定
- `pend-puzzles.test.js` ふりこのすべてのもんだいに答えがちょうど1つある
- `pend-battle.test.js` ジャスト・タイムのルール・評価・CPU
- `offline.test.js` `src/` と `public/` の全ファイルが `sw.js` のキャッシュ一覧にあるか
- `smoke.test.js` バンドルを jsdom で起動し、各画面へ移動してもエラーが出ないか・WebGL が無いとき 2D になるか

## もんだいを追加するとき

てこは `src/js/engine/puzzles.js` の `PUZZLES` に追加します。テストが自動で「解けるか」「最初からつり合っていないか」を確認します。
ふりこは `src/js/engine/pend-puzzles.js` の `PUZZLES` に追加します（`kind` と `pendulums` / `options` / `target`）。テストが「答えがちょうど1つあるか」を確認します。

## GAS 版のビルド

`npm run build:gas` が `scripts/build-gas.mjs` で `gas/index.html` を作る。`gas/index.html` は直接編集しないこと。

- アプリ本体（JS・CSS・Three.js・フォント・アイコン）は **GitHub Pages から読み込む**。GitHub Pages は CORS を許可しているので、GAS の iframe からそのまま ES modules を読める
  - 以前は JS を1ファイルにまとめてインライン化していたが、Three.js を含めて 600KB を超えると GAS の配信ラッパー内で `SyntaxError: Invalid or unexpected token` になったためやめた
- エントリ（`main.js` / `styles.css`）には `?v=<コミット>` を付けてキャッシュを避ける
- `main.js` が import するモジュールにも、import map（`<script type="importmap">`）で `?v=<コミット>` を付ける。Pages は max-age=600 なので、これがないとデプロイ直後に新旧のモジュールが混ざって起動しないことがある。`src/js` と `src/vendor` の .js はビルド時に自動で列挙される
- `GAS_PAGES_BASE=http://localhost:8801 npm run build:gas` で読み込み先を変えて、ローカルで確認できる
- `<!-- gas:strip 理由 -->…<!-- /gas:strip -->` は除去（PWA manifest）
- `<head>` の最後に `window.LEVER_GAS = true` を入れ、アプリ側で Service Worker 登録とインストール案内を止める

置換対象が見つからないとビルドはエラーで止まる（黙って壊れた出力を作らない）。
デプロイ ID は `package.json` の `config.gasDeploymentId` にあり、同じ ID へ再デプロイするので URL は変わらない。

**学校版（naha-okinawa.ed.jp）**：`gas-school/` が学校のアカウントの Apps Script プロジェクト（`.clasp.json`）。中身は `gas/` のビルド結果をコピーするだけ（`scripts/build-gas-school.mjs`）で、`gas-school/appsscript.json` の公開範囲だけが `"DOMAIN"`（学校のアカウントの人だけ）。clasp は名前つきログインで分けている（個人＝default、学校＝`--user school`）。`npm run deploy:gas:school` で `config.gasSchoolDeploymentId` に再デプロイする。
**GitHub Pages に同じコミットが反映されてから GAS をデプロイすること。**

## リリース

1. `sw.js` の `VERSION` と `package.json` の `version` を上げる（キャッシュ更新のため）
2. `main` に push → GitHub Actions が Pages にデプロイ
3. Pages の反映を確認してから `npm run deploy:gas`
