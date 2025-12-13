---
description: GitHub PagesへLEVER MASTERをデプロイ
---

# GitHub Pages デプロイワークフロー

## 前提条件
- GitHubリポジトリ: `atariryuma/lever-master`
- GitHub Pagesソース: GitHub Actions

## デプロイ手順

// turbo
1. 変更をステージングに追加
```bash
cd "/Users/ryuma/My scripts/LEVER MASTER"
git add .
```

2. コミットを作成（メッセージは変更内容に応じて変更）
```bash
git commit -m "Update"
```

// turbo
3. GitHubにプッシュ（これにより自動デプロイが開始される）
```bash
git push
```

4. デプロイ状況を確認
   - Actions: https://github.com/atariryuma/lever-master/actions
   - 公開URL: https://atariryuma.github.io/lever-master/

## 注意事項
- `main`ブランチへのプッシュで自動的にGitHub Actionsがトリガーされる
- デプロイ完了まで通常1-2分かかる
- GAS関連ファイル（`.clasp.json`, `Code.gs`, `appsscript.json`）は`.gitignore`で除外済み
