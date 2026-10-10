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
    lever-view.js       SVG のてこ（WebGL が使えないときの代わり。?2d で強制）
    weight-art.js       おもりの絵（2D・ドラッグ中の表示）
  screens/              モードごとの画面ロジック（lab / puzzles / battle）
  ui.js widgets.js      共通 UI 部品（計算式パネル・バナー・トースト・セグメント等）
  fx.js                 画面全体の演出（たいせん・もんだいクリア）
  icons.js              SVG アイコン（スプライトを <body> に入れ、icon('名前') で使う。絵文字は使わない）
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
- **てこの傾き**：左右の差 `diff` から `-tanh(diff / 50) × 10°` を目標角にしてバネで追従（実験用てこのように差が大きいほど大きく傾く）。
- **「図で予想 → 3D でたしかめる」**：もんだいでは、傾かない図（2D）の上でおもりを置いて予想し、「3Dでたしかめる」で 3D に切りかえて手をはなす（予想→実験の流れ）。はずれたら図にもどり、どちらが重いかを表示する。WebGL が無いときは図のまま「手をはなす」。たいせんではささえず、つるすたびにその場で傾く。計算式が常に見えていてささえに意味がないため。
- **たいせんの演出**：`fx.js`（画面全体：ターン開始の帯・SAFE!/OUT!! のたたきつけ・赤いふち・得点ポップ・紙吹雪）と `LeverView3D.fx()`（火花・衝撃波・アウト時のゆれ・判定時のカメラの寄り・警告灯）。2D 版の `fx()` は何もしない。BGM は `setBgm('battle', 0〜2)` で試合の進み具合に合わせて速くなる。
- **道づれ（くさり）**：たいせんでは、つかんだおもりの下にぶら下がっているおもりもいっしょに動く（`lever.moveChain`）。ビューは `render({ chainMoves: true })` で、選択・ドラッグ表示をくさりごとにする。
- **時間切れ**：つるしてあれば `release` でそのまま判定、まだなら `forfeit` でアウト。
- **アウトの扱い**：かたむけたプレイヤーはアウトになり、てこはそのターンの前の状態にもどる（次の人が不利にならない）。
- **モード共通のプレイ画面**：`main.js` が `enter / leave / back` を持つモードモジュールを切りかえる。てこのビューは1つを使い回し、`handlers` を差しかえる。
- **3D と 2D は同じ使い方**：`LeverView3D` と `LeverView` はどちらも `render / settle / startDrag / positionAt / handlers` を持つので、画面側は区別しない。3D ではキーボード・読み上げ用に透明なボタンを 3D の位置に重ねている。
- **3D と図（2D）の切りかえ**：`main.js` は 2D を常に、3D を使えるときだけ作る。じっけんの「図で見る」で `setViewKind()` が handlers を引きついで切りかえ、モードの `refresh()` で描き直す。もんだいは `app.setView()` で場面に合わせて切りかえる（予想＝図、たしかめ＝3D）。たいせんは常に 3D。
- **面積図**：`renderReadout(..., { area: true })` で、横＝きょり・縦＝重さの長方形を左右同じ縮尺で描く（面積＝はたらき）。
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
- `battle.test.js` ルール（となりNG、今つるした場所NG、道づれ、アウト時の巻きもどし、時間切れ、順位）
- `tilt.test.js` 2D・3D とも重いほうが下がる
- `ai.test.js` CPU 同士で最後まで対戦できる
- `puzzles.test.js` すべてのもんだいに解があることをソルバーで検証
- `offline.test.js` `src/` と `public/` の全ファイルが `sw.js` のキャッシュ一覧にあるか
- `smoke.test.js` バンドルを jsdom で起動し、各画面へ移動してもエラーが出ないか・WebGL が無いとき 2D になるか

## もんだいを追加するとき

`src/js/engine/puzzles.js` の `PUZZLES` に追加します。テストが自動で「解けるか」「最初からつり合っていないか」を確認します。

## GAS 版のビルド

`npm run build:gas` が `scripts/build-gas.mjs` で `gas/index.html` を作る。`gas/index.html` は直接編集しないこと。

- アプリ本体（JS・CSS・Three.js・フォント・アイコン）は **GitHub Pages から読み込む**。GitHub Pages は CORS を許可しているので、GAS の iframe からそのまま ES modules を読める
  - 以前は JS を1ファイルにまとめてインライン化していたが、Three.js を含めて 600KB を超えると GAS の配信ラッパー内で `SyntaxError: Invalid or unexpected token` になったためやめた
- エントリ（`main.js` / `styles.css`）には `?v=<コミット>` を付けてキャッシュを避ける
- `<!-- gas:strip 理由 -->…<!-- /gas:strip -->` は除去（PWA manifest）
- `<head>` の最後に `window.LEVER_GAS = true` を入れ、アプリ側で Service Worker 登録とインストール案内を止める

置換対象が見つからないとビルドはエラーで止まる（黙って壊れた出力を作らない）。
デプロイ ID は `package.json` の `config.gasDeploymentId` にあり、同じ ID へ再デプロイするので URL は変わらない。
**GitHub Pages に同じコミットが反映されてから GAS をデプロイすること。**

## リリース

1. `sw.js` の `VERSION` を上げる（キャッシュ更新のため）
2. `main` に push → GitHub Actions が Pages にデプロイ
3. Pages の反映を確認してから `npm run deploy:gas`
