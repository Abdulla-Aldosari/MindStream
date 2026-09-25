// @ts-check
"use strict";

/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // `2` means "error" (refuse to commit).
    // `never` means the scope is never allowed to be empty (required).
    "scope-empty": [2, "never"],

    // Header (type + scope + subject) must not exceed 72 characters.
    "header-max-length": [2, "always", 72],

    // Each line in the commit body must not exceed 72 characters.
    "body-max-line-length": [2, "always", 72],

    // Allowed commit types (fixed, do not change).
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "perf", "style", "refactor", "docs", "test", "chore", "build", "ci", "revert"],
    ],

    // MindStream project scopes.
    "scope-enum": [
      2,
      "always",
      [
        "extension", // src/extension.ts: activate()/deactivate(), command registration, wiring all services together
        "commands", // src/commands.ts: command handler logic for export/import/weekly report/requireWorkspace
        "sidebar", // sidebar feature changes that span both sidebarController.ts and sidebarProvider.ts together
        "sidebarController", // src/sidebarController.ts: webview message-handling logic, data mutations, confirm dialogs
        "sidebarProvider", // src/sidebarProvider.ts: WebviewViewProvider rendering, posting state, activity-bar badge
        "webview", // media/sidebar.js and media/sidebar.css: webview UI, custom dropdowns, tooltips, modals, note cards
        "storage", // src/storage.ts: StorageService safe read/write, default data creation, normalizeData()
        "workspaceStorage", // src/workspaceStorage.ts: binding StorageService to the open workspace's .mindstream/data.json
        "itemsStore", // src/itemsStore.ts: CRUD for notes, status history, archiving, permanent deletion
        "types", // the note-types feature/concept as a whole, when a change spans more than typesRegistry.ts alone
        "typesRegistry", // src/typesRegistry.ts: add/rename/setIcon/remove/reassign user-defined note types
        "categories", // the categories feature/concept as a whole, when a change spans more than categoriesRegistry.ts alone
        "categoriesRegistry", // src/categoriesRegistry.ts: manage categories, including the built-in General category
        "models", // src/models.ts: core data types, status enum, and shared constants
        "report", // src/report.ts: buildWeeklyReport() computing weekly created/completed/in-progress/archived counts
        "export", // src/export.ts: buildMarkdownExport(), buildWeeklyReportText(), mergeData() pure functions
        "import", // JSON import behavior/logic (importJson command flow), independent of export
        "util", // src/util.ts: newId() and nowIso() helper functions
        "helpers", // test/helpers.ts: InMemoryStorage fake shared across unit tests
        "ui", // general visual/UX change that is not confined to a single file listed above
        "deps", // adding, removing, or bumping a dependency in package.json/package-lock.json
        "config", // a config file with no dedicated scope of its own, e.g. .vscodeignore or .gitignore
        "eslint", // eslint.config.js: linting rules and configuration
        "tsconfig", // tsconfig.json: TypeScript compiler configuration
        "commitlint", // commitlint.config.js: commit type/scope rules for this project
        "mocharc", // .mocharc.json: Mocha test runner configuration
        "esbuild", // esbuild.js: the extension's build/bundle script
        "husky", // .husky/commit-msg or .husky/pre-commit: git hook scripts
        "vscode", // .vscode/launch.json or .vscode/tasks.json: editor/debugger configuration
        "workflows", // .github/workflows/*.yml: CI pipelines for lint, test, audit, and CodeQL
        "assets", // adding or replacing image/gif files used for documentation, not the README text itself
        "readme", // changes to the text/content of README.md itself
        "license", // changes to the LICENSE file
        "changelog", // CHANGELOG.md content or cliff.toml changelog-generation configuration
      ],
    ],
  },
};
