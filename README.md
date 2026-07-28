# LEVER MASTER ⚖️

てこの原理を学ぶ物理学習ゲーム（小学6年生理科対応）

## 🎮 プレイ

| 配信先 | URL | 用途 |
| --- | --- | --- |
| GitHub Pages（本体） | [atariryuma.github.io/lever-master](https://atariryuma.github.io/lever-master/) | PWA対応のフル機能版 |
| GAS Web アプリ（ミラー） | [script.google.com/.../exec](https://script.google.com/macros/s/AKfycbz_PW1DWZy3svW9yOus-wvuN4et-666Ees99J3Kgjj7ZYxv0VSwGxcl0rVJzriNsR6i6w/exec) | Google Sites / Classroom への埋め込み用 |

## 📱 インストール

PWA対応のため、ブラウザから「ホーム画面に追加」でアプリとしてインストール可能（GitHub Pages版のみ）

## 🗂 ディレクトリ構成

```text
lever-master/
├── public/           # 静的アセット
│   ├── icons/        # アプリアイコン (SVG/PNG)
│   └── manifest.json # PWAマニフェスト
├── src/              # ソースコード（単一の真実源）
│   ├── js/main.js    # メインJavaScript
│   └── css/styles.css
├── gas/              # GAS版（Code.js 以外は自動生成・gitignore対象）
│   ├── Code.js       # doGet / include（手書き）
│   └── appsscript.json
├── scripts/
│   └── build-gas.mjs # src/ → gas/ 変換ビルド
├── index.html        # エントリーポイント
├── sw.js             # Service Worker
└── .github/workflows/deploy.yml
```

## 🚀 デプロイ

編集するのは常に `src/` と `index.html` のみ。GAS版は `src/` から自動生成されるため、**手で二重管理はしない**。

```bash
git add .
git commit -m "Update"
npm run deploy      # GAS版へ反映 → git push（GitHub Pages 自動デプロイ）
```

個別に実行する場合:

| コマンド | 内容 |
| --- | --- |
| `npm run build:gas` | `src/` から `gas/` を生成するだけ |
| `npm run push:gas` | 生成して Apps Script プロジェクトへ push |
| `npm run deploy:gas` | push して既存デプロイを更新（URLは変わらない） |
| `npm run deploy` | `deploy:gas` + `git push` |

> GitHub Pages側でキャッシュを更新するには、従来どおり `sw.js` の `CACHE_NAME` のバージョンを上げる。

### GitHub版とGAS版の差分

GAS は HTML を サンドボックス iframe で配信するため、以下は**GAS版では利用できない**（ビルド時に自動で除去される）。

| 機能 | GitHub Pages | GAS |
| --- | --- | --- |
| ゲーム本体 / Three.js | ✅ | ✅ |
| Service Worker・オフライン | ✅ | ❌ 登録不可 |
| PWAインストール（manifest） | ✅ | ❌ 配信不可 |
| アイコン・静的アセット | ✅ | GitHub Pages を参照 |
| ES modules | ✅ | esbuild で単一IIFEに束ねてインライン化 |

## 📚 学習内容

- てこの3つの点（支点・力点・作用点）
- つり合いの条件：左うで × おもり = 右うで × おもり
- 身の回りのてこの例

## 🛠 技術スタック

- Three.js (3Dレンダリング)
- Web Audio API (サウンド)
- PWA (オフライン対応)
- esbuild (GAS版のバンドル)
- Google Apps Script (ミラー配信)

---

Made with ❤️ for education
