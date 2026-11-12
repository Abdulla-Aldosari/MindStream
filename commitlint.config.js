// @ts-check
"use strict";

// 1. Defining the Project's Core Scopes
// Each entry is a triple: [name, description, files].
// [description, files] (Used by AI tools to determine the correct scope).
// - name:        the exact scope string allowed in commit headers.
// - description: what the scope covers.
// - files:       repo-relative file paths or directory prefixes (trailing "/", means all the files in this directory)
//                that deterministically map a changed file to this scope.
//                An empty array means the scope has no single home file.
const baseScopes = [
  // Extension runtime
  ["extension", "activate()/deactivate(), command registration, wiring all services together", ["src/extension.ts"]],
  ["commands", "command handler logic for export, import, weekly report, and workspace requirement checks", ["src/commands.ts"]],
  [
    "sidebar",
    "sidebar webview host: message handling, data mutations, confirm dialogs, view provider rendering, state posting, activity-bar badge",
    ["src/sidebarController.ts", "src/sidebarProvider.ts"],
  ],
  ["webview", "sidebar webview UI scripts and styles: note cards, modals, custom dropdowns, tooltips, emoji picker, view options, icon classes", ["media/"]],

  // Data and domain logic
  [
    "storage",
    "safe JSON read/write, default data creation, normalization, workspace file binding, coalesced delayed saves",
    ["src/storage.ts", "src/workspaceStorage.ts", "src/saveScheduler.ts"],
  ],
  [
    "notes",
    "note CRUD, status history, archiving, deletion, and the user-defined note types and categories registries",
    ["src/itemsStore.ts", "src/typesRegistry.ts", "src/categoriesRegistry.ts"],
  ],
  [
    "links",
    "note-to-code links: building, re-finding, shifting, renaming, validating, tracking edits, and the vscode listeners wiring",
    ["src/linkResolver.ts", "src/linkTracker.ts", "src/linkIntegration.ts"],
  ],
  ["models", "core data types, status enum, shared constants, and id/timestamp helpers", ["src/models.ts", "src/util.ts"]],
  ["report", "weekly report computation and Markdown/text export and merge functions", ["src/report.ts", "src/export.ts"]],
  ["priority", "note priority levels and the priority.style setting", ["src/priority.ts"]],
  ["emoji", "global emoji palette and recent-emoji tracking", ["src/emojiRegistry.ts"]],
  ["uiPrefs", "global per-user UI preferences such as note-editor description height", ["src/uiPrefs.ts"]],
  [
    "workPause",
    "Work Pause note: the single hand-off note stored in the data file, its lock rules, the lock guard, and its store (the webview parts live under media/)",
    ["src/workPause.ts", "src/workPauseStore.ts"],
  ],

  // Tests, docs, and assets
  ["tests", "unit tests and shared test fakes", ["test/"]],
  ["docs", "architecture documentation, screenshots, GIFs, and extension icons", ["docs/", "icons/"]],
  ["readme", "text and content of README.md", ["README.md"]],
  ["license", "the LICENSE file", ["LICENSE"]],

  // Tooling and infrastructure
  [
    "tooling",
    "build, lint, format, TypeScript, test-runner, packaging-ignore, and editor/debugger configuration",
    ["esbuild.js", "eslint.config.js", "tsconfig.json", ".mocharc.json", ".prettierrc", ".prettierignore", ".gitignore", ".vscodeignore", ".vscode/"],
  ],
  ["ci", "GitHub Actions pipelines for lint, test, audit, and CodeQL", [".github/workflows/"]],
  ["husky", "git hook scripts that run on commit and push", [".husky/"]],
  ["commitlint", "commit type and scope rules for this project", ["commitlint.config.js"]],
  ["deps", "adding, removing, or bumping dependencies and package metadata or scripts", ["package.json", "package-lock.json"]],
  ["changelog", "CHANGELOG.md content and git-cliff changelog-generation configuration", ["CHANGELOG.md", "cliff.toml"]],
  ["release", "release commits: initial releases and version bumps", []],
];

// 2. Append a negative variant of every base scope prefixed with "-" (e.g. "-sidebar").
// Negative scopes are reserved for small internal feat/fix/perf commits that must be
// excluded from the auto-generated CHANGELOG by git-cliff. The skip rule that performs
// the exclusion lives in "cliff.toml" -> commit_parsers, in the project root.
const allowedScopes = [...baseScopes.map(([name]) => name), ...baseScopes.map(([name]) => `-${name}`)];

// 3. Custom rule: a negative scope (e.g. "-sidebar") is reserved for small
// internal commits and may only be used with feat, fix, or perf.
/** @type {import('@commitlint/types').Plugin} */
const negativeScopeTypesPlugin = {
  rules: {
    "negative-scope-types": (parsed) => {
      const type = parsed && parsed.type ? parsed.type : "";
      const scope = parsed && parsed.scope ? parsed.scope : "";

      if (scope.startsWith("-") && !["feat", "fix", "perf"].includes(type)) {
        return [false, `negative scope "${scope}" is only allowed with types feat, fix, or perf`];
      }

      return [true];
    },
  },
};

/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  baseScopes,
  extends: ["@commitlint/config-conventional"],
  plugins: [negativeScopeTypesPlugin],
  rules: {
    // `2` means "error" (refuse to commit).
    // `never` means the scope is never allowed to be empty (required).
    "scope-empty": [2, "never"],

    // Header (type + scope + subject) must not exceed 72 characters.
    "header-max-length": [2, "always", 72],

    // Each line in the commit body must not exceed 72 characters.
    "body-max-line-length": [2, "always", 72],

    // Allowed commit types (fixed, do not change).
    "type-enum": [2, "always", ["feat", "fix", "perf", "style", "refactor", "docs", "test", "chore", "build", "ci", "revert"]],

    // MindStream project scopes using the dynamically generated list.
    "scope-enum": [2, "always", allowedScopes],

    // Negative scopes are reserved for small internal feat/fix/perf commits.
    "negative-scope-types": [2, "always"],
  },
};
