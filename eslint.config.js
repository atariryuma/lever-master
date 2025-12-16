import js from '@eslint/js';

export default [
    // グローバル設定
    {
        ignores: [
            'node_modules/**',
            'coverage/**',
            '.git/**',
            '.claude/**',
            'dist/**',
        ],
    },

    // 推奨ルールを適用
    js.configs.recommended,

    // カスタムルール設定
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: {
                // ブラウザグローバル
                window: 'readonly',
                document: 'readonly',
                navigator: 'readonly',
                console: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
                requestAnimationFrame: 'readonly',
                cancelAnimationFrame: 'readonly',
                Audio: 'readonly',
                Image: 'readonly',
                URL: 'readonly',
                ResizeObserver: 'readonly',
                IntersectionObserver: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                screen: 'readonly',
                AbortController: 'readonly',
                performance: 'readonly',
                Date: 'readonly',

                // THREE.js グローバル
                THREE: 'readonly',

                // Node.js グローバル（テストファイル用）
                process: 'readonly',
                Buffer: 'readonly',
            },
        },

        rules: {
            // ===== エラーレベル（厳格） =====

            // 未使用変数の禁止
            'no-unused-vars': ['error', {
                vars: 'all',
                args: 'after-used',
                ignoreRestSiblings: true,
                argsIgnorePattern: '^_',  // _で始まるパラメータは許可
            }],

            // 未定義変数の禁止
            'no-undef': 'error',

            // デバッガーの禁止
            'no-debugger': 'error',

            // console.logの警告（本番前に削除すべき）
            'no-console': ['warn', { allow: ['warn', 'error'] }],

            // 再代入できない変数への代入禁止
            'no-const-assign': 'error',

            // 重複したケースラベル禁止
            'no-duplicate-case': 'error',

            // 空のブロック文の禁止
            'no-empty': ['error', { allowEmptyCatch: true }],

            // 不要なセミコロンの禁止
            'no-extra-semi': 'error',

            // 関数宣言の上書き禁止
            'no-func-assign': 'error',

            // 到達不可能なコードの禁止
            'no-unreachable': 'error',

            // ===== 警告レベル（ベストプラクティス） =====

            // var の使用を警告（let/const を推奨）
            'no-var': 'warn',

            // const を推奨
            'prefer-const': 'warn',

            // テンプレート文字列を推奨
            'prefer-template': 'warn',

            // アロー関数の推奨
            'prefer-arrow-callback': 'warn',

            // === と !== の使用を推奨
            'eqeqeq': ['warn', 'always', { null: 'ignore' }],

            // 複数の空行を禁止
            'no-multiple-empty-lines': ['warn', { max: 2, maxEOF: 1 }],

            // 末尾のスペース禁止
            'no-trailing-spaces': 'warn',

            // インデント（2スペース）
            'indent': ['warn', 4, { SwitchCase: 1 }],

            // セミコロン必須
            'semi': ['warn', 'always'],

            // クォートスタイル（シングルクォート推奨）
            'quotes': ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],

            // オブジェクト・配列の末尾カンマ
            'comma-dangle': ['warn', 'always-multiline'],

            // 中括弧のスタイル
            'brace-style': ['warn', '1tbs', { allowSingleLine: true }],

            // スペースの一貫性
            'space-before-function-paren': ['warn', {
                anonymous: 'never',
                named: 'never',
                asyncArrow: 'always',
            }],

            // アロー関数のスペース
            'arrow-spacing': 'warn',

            // キーワードの前後のスペース
            'keyword-spacing': 'warn',

            // コンマの後のスペース
            'comma-spacing': 'warn',

            // 中括弧内のスペース
            'object-curly-spacing': ['warn', 'always'],

            // 配列の括弧内のスペース（なし）
            'array-bracket-spacing': ['warn', 'never'],

            // 最大行長（警告のみ）
            'max-len': ['warn', {
                code: 120,
                ignoreComments: true,
                ignoreStrings: true,
                ignoreTemplateLiterals: true,
            }],

            // 複雑度の警告
            'complexity': ['warn', 20],

            // 関数の最大行数（AIロジック関数は複雑なため緩和）
            'max-lines-per-function': ['warn', {
                max: 130,
                skipBlankLines: true,
                skipComments: true,
            }],
        },
    },

    // テストファイル専用の設定
    {
        files: ['__tests__/**/*.js', '**/*.test.js'],
        languageOptions: {
            globals: {
                describe: 'readonly',
                it: 'readonly',
                expect: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
                vi: 'readonly',
            },
        },
        rules: {
            // テストファイルではconsole.logを許可
            'no-console': 'off',
            // テストファイルでは長い関数を許可
            'max-lines-per-function': 'off',
        },
    },

    // Service Worker 専用の設定
    {
        files: ['sw.js'],
        languageOptions: {
            globals: {
                // Service Worker グローバル
                self: 'readonly',
                caches: 'readonly',
                fetch: 'readonly',
                Response: 'readonly',
                Request: 'readonly',
                location: 'readonly',
                clients: 'readonly',
            },
        },
        rules: {
            // Service Workerではconsole.logを許可
            'no-console': 'off',
        },
    },

    // パフォーマンスモニター専用の設定
    {
        files: ['**/performance-monitor.js'],
        languageOptions: {
            globals: {
                URLSearchParams: 'readonly',
            },
        },
        rules: {
            // パフォーマンスモニターではconsole.logを許可（デバッグ用ツール）
            'no-console': 'off',
        },
    },
];
