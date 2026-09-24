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
        "extension",
        "commands",
        "sidebar",
        "storage",
        "types",
        "categories",
        "models",
        "report",
        "export",
        "import",
        "ui",
        "test",
        "build",
        "deps",
        "docs",
        "ci",
        "config",
        "eslint",
        "tsconfig",
        "changelog",
      ],
    ],
  },
};
