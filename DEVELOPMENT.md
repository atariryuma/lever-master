# 開発者ガイド

## 開発環境のセットアップ

### 必要な環境
- Node.js 18以降
- npm 9以降

### 依存関係のインストール
```bash
npm install
```

## コード品質ツール

### ESLint（静的解析）
コード品質を自動チェックします。

```bash
# リンティング実行
npm run lint

# 自動修正可能な問題を修正
npm run lint:fix
```

**主要なルール:**
- 未使用変数の禁止
- `let`/`const` の推奨
- テンプレートリテラルの推奨
- 一貫したコードスタイル

**設定ファイル:** `eslint.config.js`

### Vitest（ユニットテスト）
ゲームロジックの正確性をテストします。

```bash
# テスト実行（ウォッチモード）
npm test

# テストUI（ブラウザで実行）
npm run test:ui

# カバレッジレポート生成
npm run test:coverage
```

**テストファイル:** `__tests__/**/*.test.js`

**設定ファイル:** `vitest.config.js`

## パフォーマンスモニタリング

### Performance Monitor の使用方法

**パフォーマンスモニター**は、ゲームの処理速度やメモリ使用量を追跡するツールです。

#### 📊 有効化の方法

パフォーマンスモニターはデフォルトで**無効**です。以下の方法で有効化できます：

**方法1: URLパラメータ（一時的）**
```
http://localhost:8080?perfmon=1
```

**方法2: ブラウザコンソール（永続的）**
```javascript
// 有効化（localStorageに保存）
window.enablePerfMon()

// 無効化
window.disablePerfMon()
```

有効化すると、コンソールに以下のメッセージが表示されます：
```
📊 Performance monitoring is ACTIVE
   Use window.perfMonitor.logStats() to view stats
   Use window.disablePerfMon() to disable
```

#### 📈 統計情報の表示

ゲームをプレイ後、ブラウザコンソールで以下を実行：

```javascript
// 統計情報を表示
window.perfMonitor.logStats();

// 統計をリセット
window.perfMonitor.reset();
```

**出力例:**
```
===== Performance Statistics =====

[Frame Performance]
  Frames:         1234
  Avg Frame Time: 16.67ms
  Avg FPS:        60.0
  Worst Frame:    45.23ms

[Memory Usage]
  Used:  45.32 MB
  Total: 78.91 MB
  Limit: 2048.00 MB

==================================
```

#### 🔧 main.js への統合（開発者向け）

main.jsに以下のようなコードを追加することで、特定の処理を測定できます：

```javascript
// 処理の開始をマーク
if (window.perfMonitor) {
    window.perfMonitor.mark('ai-think-start');
}

// ... AI処理 ...

// 処理時間を測定
if (window.perfMonitor) {
    const duration = window.perfMonitor.measure('ai-thinking', 'ai-think-start');
    console.log(`AI thought for ${duration}ms`);
}

// アニメーションループ内でフレーム時間を記録
function animate() {
    if (window.perfMonitor) {
        window.perfMonitor.recordFrame();
    }

    // ... レンダリング処理 ...

    requestAnimationFrame(animate);
}

// 定期的にメモリ使用量を記録
setInterval(() => {
    if (window.perfMonitor) {
        window.perfMonitor.recordMemory();
    }
}, 5000); // 5秒ごと
```

#### 統計情報の表示

ブラウザのコンソールで以下を実行:

```javascript
// 統計情報を表示
window.perfMonitor.logStats();

// 統計をリセット
window.perfMonitor.reset();

// モニタリングを無効化（パフォーマンスへの影響を減らす）
window.perfMonitor.setEnabled(false);
```

#### 測定すべき重要な処理

1. **物理演算:** `calcMoment()`, `checkBalance()`
2. **AI計算:** `cpuTurn()`, `findBestStrategyWithPersonality()`
3. **レンダリング:** THREE.js のレンダーループ
4. **DOM操作:** `updateUI()`, `endGame()`

### 推奨される測定ポイント

```javascript
// 例: AI思考時間の測定
function cpuTurn() {
    perfMonitor.mark('ai-think-start');

    // AI処理
    const move = findBestStrategyWithPersonality(...);

    const duration = perfMonitor.measure('ai-thinking', 'ai-think-start');
    console.log(`AI thought for ${duration}ms`);

    // ...
}
```

## コードスタイルガイド

### 命名規則

- **定数:** `UPPER_SNAKE_CASE`
  ```javascript
  const GAME_CONFIG = { ... };
  const MAX_TURNS_PER_PLAYER = 10;
  ```

- **関数/変数:** `camelCase`
  ```javascript
  function calculateMoment() { ... }
  let playerScore = 0;
  ```

- **クラス:** `PascalCase`
  ```javascript
  class PerformanceMonitor { ... }
  ```

### JSDocドキュメント

重要な関数には必ず JSDoc を追加してください:

```javascript
/**
 * モーメントを計算する
 * @param {Array<Object>} weights - おもりの配列
 * @returns {Object} 左右のモーメント {left: number, right: number}
 */
function calcMoment(weights) {
    // ...
}
```

### エラーハンドリング

Null/undefined チェックを一貫して実施:

```javascript
function processData(data) {
    // == null で null と undefined の両方をチェック
    if (data == null) return defaultValue;

    // ...
}
```

## プロジェクト構造

```
LEVER MASTER/
├── src/
│   ├── js/
│   │   ├── main.js                  # メインゲームロジック
│   │   └── performance-monitor.js   # パフォーマンス監視
│   └── css/
│       └── styles.css               # スタイルシート
├── __tests__/
│   └── game-logic.test.js           # ユニットテスト
├── index.html                       # エントリーポイント
├── package.json                     # 依存関係管理
├── vitest.config.js                 # テスト設定
├── eslint.config.js                 # リント設定
└── DEVELOPMENT.md                   # このファイル
```

## 主要な設計原則

### 1. 単一責任の原則 (SRP)
各関数は1つの明確な目的を持つべきです。

**良い例:**
```javascript
function generatePointsRankingHtml(points, activePlayers) {
    // ランキングHTMLの生成のみに専念
}

function playEndGameEffects(isWin, impactIntensity) {
    // エフェクト再生のみに専念
}
```

### 2. DRY (Don't Repeat Yourself)
重複したコードは関数に抽出します。

**改善前:**
```javascript
// 同じHTML構造が3箇所に重複
detail.innerHTML = `<div>モーメント: ${left} = ${right}</div>`;
```

**改善後:**
```javascript
const balanceHtml = generateBalanceInfoHtml(left, right);
detail.innerHTML = `${balanceHtml}`;
```

### 3. 定数の集約
マジックナンバーや文字列は定数として定義します。

```javascript
// main.js
const GAME_CONFIG = {
    MAX_TURNS_PER_PLAYER: 10,
    CPU_DELAY: 800,
    // ...
};

const UI_COLORS = {
    WARNING: '#ff9500',
    SUCCESS: '#00ff88',
    // ...
};
```

## Git ワークフロー

### コミットメッセージの規約

```bash
# 機能追加
git commit -m "Add performance monitoring utility"

# バグ修正
git commit -m "Fix memory leak in BGM loop"

# リファクタリング
git commit -m "Refactor endGame function following SRP"

# ドキュメント
git commit -m "Update development guide with testing instructions"
```

## デバッグのヒント

### Chrome DevTools でのパフォーマンス分析

1. **Performance タブ:**
   - ゲームを開始
   - 録画開始
   - 数秒プレイ
   - 録画停止
   - フレームレートの低下を確認

2. **Memory タブ:**
   - ヒープスナップショットを撮影
   - ゲームを進行
   - 再度スナップショット
   - メモリリークを検出

3. **Console でのパフォーマンス測定:**
   ```javascript
   window.perfMonitor.logStats();
   ```

## トラブルシューティング

### ESLint エラー: "X is not defined"
→ `eslint.config.js` の `globals` にグローバル変数を追加

### Vitest エラー: "Cannot find module"
→ `package.json` の `"type": "module"` が設定されているか確認

### パフォーマンス低下
→ `window.perfMonitor.logStats()` で遅い処理を特定

## 今後の改善案

### 優先度: 高
- [ ] main.js をモジュールに分割（export/import 対応）
- [ ] コアロジックの実際のユニットテスト作成
- [ ] パフォーマンスモニターを main.js に統合

### 優先度: 中
- [ ] TypeScript への移行検討
- [ ] コンポーネント単位でのファイル分割
- [ ] ビルドツール（Vite/Rollup）の導入

### 優先度: 低
- [ ] E2Eテスト（Playwright）の追加
- [ ] CI/CDパイプラインの構築
- [ ] 国際化（i18n）対応

## 参考リンク

- [ESLint Rules](https://eslint.org/docs/latest/rules/)
- [Vitest Documentation](https://vitest.dev/)
- [Performance API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Performance)
- [Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance/)
