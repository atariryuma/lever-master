import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
    // ブラウザ環境をシミュレート
        environment: 'jsdom',

        // グローバル変数として describe, it, expect などを利用可能にする
        globals: true,

        // カバレッジ設定
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            exclude: [
                'node_modules/',
                '__tests__/',
                '*.config.js',
            ],
        },

        // テストファイルのパターン
        include: ['__tests__/**/*.test.js', 'src/**/*.test.js'],
    },
});
