const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

module.exports = [
  {
    ignores: ['dist/**', 'out/**', 'node_modules/**', '*.vsix'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    ignores: ['media/**'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: globals.mocha,
    },
  },
  {
    // media/*.js webview scripts have no ES module exports, so importing
    // their side-effect-free logic for unit tests requires require().
    files: ['test/sidebarIconClass.test.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Webview scripts run in the browser context injected by VS Code, not Node.js.
    files: ['media/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        // Injected by the VS Code webview runtime before this script loads.
        acquireVsCodeApi: 'readonly',
      },
    },
  },
  {
    // Functions defined in media/iconClass.js, loaded as a global before
    // sidebar.js (see sidebarProvider.ts's getHtml()).
    files: ['media/sidebar.js'],
    languageOptions: {
      globals: {
        iconClass: 'readonly',
      },
    },
  },
  {
    // Side-effect-free media/*.js files also expose their functions to
    // Node-based unit tests via a guarded `module.exports` block.
    files: ['media/iconClass.js'],
    languageOptions: {
      globals: {
        module: 'readonly',
      },
    },
  },
];
