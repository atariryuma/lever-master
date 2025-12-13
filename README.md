# LEVER MASTER ⚖️

てこの原理を学ぶ物理学習ゲーム（小学6年生理科対応）

## 🎮 プレイ

**ライブデモ:** [https://atariryuma.github.io/lever-master/](https://atariryuma.github.io/lever-master/)

## 📱 インストール

PWA対応のため、ブラウザから「ホーム画面に追加」でアプリとしてインストール可能

## 🗂 ディレクトリ構成

```
lever-master/
├── public/           # 静的アセット
│   ├── icons/        # アプリアイコン (SVG/PNG)
│   └── manifest.json # PWAマニフェスト
├── src/              # ソースコード
│   ├── js/main.js    # メインJavaScript
│   └── css/styles.css
├── index.html        # エントリーポイント
├── sw.js             # Service Worker
└── .github/workflows/deploy.yml
```

## 🚀 デプロイ

`main`ブランチにプッシュすると自動的にGitHub Pagesへデプロイ

```bash
git add .
git commit -m "Update"
git push
```

## 📚 学習内容

- てこの3つの点（支点・力点・作用点）
- つり合いの条件：左うで × おもり = 右うで × おもり
- 身の回りのてこの例

## 🛠 技術スタック

- Three.js (3Dレンダリング)
- Web Audio API (サウンド)
- PWA (オフライン対応)

---

Made with ❤️ for education
