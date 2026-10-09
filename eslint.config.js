import js from '@eslint/js';

const browserGlobals = Object.fromEntries([
    'window', 'document', 'navigator', 'location', 'console', 'localStorage', 'CSS',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'requestAnimationFrame', 'cancelAnimationFrame', 'structuredClone',
].map(name => [name, 'readonly']));

export default [
    { ignores: ['node_modules/**', 'coverage/**', '.git/**', '.claude/**', 'dist/**'] },

    js.configs.recommended,

    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: browserGlobals,
        },
        rules: {
            'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', ignoreRestSiblings: true }],
            'no-console': ['warn', { allow: ['warn', 'error'] }],
            'no-var': 'error',
            'prefer-const': 'warn',
            'eqeqeq': ['error', 'always', { null: 'ignore' }],
            'indent': ['warn', 4, { SwitchCase: 1, ignoredNodes: ['TemplateLiteral *'] }],
            'semi': ['warn', 'always'],
            'quotes': ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
            'comma-dangle': ['warn', 'always-multiline'],
            'brace-style': ['warn', '1tbs', { allowSingleLine: true }],
            'object-curly-spacing': ['warn', 'always'],
            'max-len': ['warn', { code: 130, ignoreComments: true, ignoreStrings: true, ignoreTemplateLiterals: true }],
            'complexity': ['warn', 20],
        },
    },

    {
        files: ['__tests__/**/*.js'],
        languageOptions: {
            globals: { describe: 'readonly', it: 'readonly', expect: 'readonly', process: 'readonly' },
        },
    },

    {
        files: ['sw.js'],
        languageOptions: {
            sourceType: 'script',
            globals: { self: 'readonly', caches: 'readonly', fetch: 'readonly', Response: 'readonly', URL: 'readonly' },
        },
    },

    {
        files: ['*.config.js', 'scripts/**/*.js'],
        languageOptions: { globals: { process: 'readonly' } },
    },
];
