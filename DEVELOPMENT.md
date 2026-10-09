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
  audio.js storage.js   効果音・BGM／localStorage
__tests__/              Vitest
src/vendor/three.js     同梱した Three.js（使う部品だけ。`npm run vendor` で作り直す）
public/fonts/           同梱フォント（Orbitron, SIL OFL）
scripts/vendor.mjs      Three.js とフォントを同梱するスクリプト
```

## 設計のポイント

- **ロジックと表示を分離**：`engine/` は純粋関数のみ。画面側は「状態 → `render()`」で描き直すだけ。
- **てこの傾き**：左右の差 `diff` から `-tanh(diff / 50) × 10°` を目標角にしてバネで追従（実験用てこのように差が大きいほど大きく傾く）。
- **「ささえる → はなす」**：もんだい・たいせんでは、手でささえた状態（傾かない）でおもりを置き、「はなす」で判定。予想してから確かめる理科の実験の流れを再現。
- **アウトの扱い**：かたむけたプレイヤーはアウトになり、てこはそのターンの前の状態にもどる（次の人が不利にならない）。
- **モード共通のプレイ画面**：`main.js` が `enter / leave / back` を持つモードモジュールを切りかえる。てこのビューは1つを使い回し、`handlers` を差しかえる。
- **3D と 2D は同じ使い方**：`LeverView3D` と `LeverView` はどちらも `render / settle / startDrag / positionAt / handlers` を持つので、画面側は区別しない。3D ではキーボード・読み上げ用に透明なボタンを 3D の位置に重ねている。
- **色は CSS が正**：プレイヤーやおもりの色は `styles.css` の CSS 変数で定義し、3D 側もそれを読む。
- **Three.js の更新**：`package.json` の three を上げて `npm run vendor` → `src/vendor/three.js` をコミット。新しい部品を import したときも `npm run vendor` を実行する。

## テスト

```bash
npm test        # 1回実行
npm run lint
npm run check   # 両方
```

- `lever.test.js` 盤面・計算
- `battle.test.js` ルール（となりNG、今つるした場所NG、アウト時の巻きもどし、順位）
- `ai.test.js` CPU 同士で最後まで対戦できる
- `puzzles.test.js` すべてのもんだいに解があることをソルバーで検証
- `offline.test.js` `src/` と `public/` の全ファイルが `sw.js` のキャッシュ一覧にあるか

## もんだいを追加するとき

`src/js/engine/puzzles.js` の `PUZZLES` に追加します。テストが自動で「解けるか」「最初からつり合っていないか」を確認します。

## リリース

1. `sw.js` の `VERSION` を上げる（キャッシュ更新のため）
2. `main` に push → GitHub Actions が Pages にデプロイ
