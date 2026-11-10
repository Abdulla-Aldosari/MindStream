const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const globals = require("globals");

module.exports = [
  {
    ignores: ["dist/**", "demo/**", "out/**", "node_modules/**", "*.vsix"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    ignores: ["media/**"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    files: ["test/**/*.ts"],
    languageOptions: {
      globals: globals.mocha,
    },
  },
  {
    // media/*.js webview scripts have no ES module exports, so importing
    // their side-effect-free logic for unit tests requires require().
    files: [
      "test/sidebarIconClass.test.ts",
      "test/tooltip.test.ts",
      "test/defaultType.test.ts",
      "test/linkPath.test.ts",
      "test/emoji.test.ts",
      "test/dropdownMenu.test.ts",
      "test/viewOptions.test.ts",
    ],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // Webview scripts run in the browser context injected by VS Code, not Node.js.
    files: ["media/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        // Injected by the VS Code webview runtime before this script loads.
        acquireVsCodeApi: "readonly",
      },
    },
  },
  {
    // Globals defined in the side-effect-free media/*.js files, loaded
    // as globals before sidebar.js (see sidebarProvider.ts's getHtml()).
    files: ["media/sidebar.js"],
    languageOptions: {
      globals: {
        iconClass: "readonly",
        resolveCategoryDefaultTypeId: "readonly",
        fitPath: "readonly",
        splitEmojis: "readonly",
        isEmoji: "readonly",
        DropdownMenu: "readonly",
        ViewOptions: "readonly",
      },
    },
  },
  {
    // Side-effect-free media/*.js files also expose their functions to
    // Node-based unit tests via a guarded `module.exports` block.
    files: ["media/iconClass.js", "media/tooltip.js", "media/defaultType.js", "media/linkPath.js", "media/emoji.js", "media/dropdown-menu.js", "media/viewOptions.js"],
    languageOptions: {
      globals: {
        module: "readonly",
      },
    },
  },
];
