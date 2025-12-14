---
description: GitHub PagesへLEVER MASTERをデプロイ
---

# GitHub Pages デプロイワークフロー

// turbo-all

## 前提条件
- GitHubリポジトリ: `atariryuma/lever-master`
- GitHub Pagesソース: GitHub Actions

## デプロイ手順

1. 変更をステージングに追加
```bash
cd "/Users/ryuma/My scripts/LEVER MASTER"
git add .
```

2. コミットを作成
```bash
git commit -m "Update"
```

3. GitHubにプッシュ
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
