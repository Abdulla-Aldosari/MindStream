/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Resolves the type id to pre-select in the "New note" form for a given
// category. Kept in its own side-effect-free file (no acquireVsCodeApi/document
// usage) so it can be loaded as a global before sidebar.js in the webview, and
// required directly by Node-based unit tests (Mocha) without any DOM/vscode
// stubbing.
//
// Resolution order:
//   1. The category's explicit `defaultTypeId`, when it still exists in `types`.
//   2. `fallbackTypeId`, when it is a valid id in `types` (used for the active
//      type filter).
//   3. The first type in the list (the "General" type by convention).
//   4. `null` when there are no types at all.
function resolveCategoryDefaultTypeId(category, types, fallbackTypeId) {
  if (category && category.defaultTypeId && types.some((t) => t.id === category.defaultTypeId)) {
    return category.defaultTypeId;
  }
  if (fallbackTypeId != null && types.some((t) => t.id === fallbackTypeId)) {
    return fallbackTypeId;
  }
  return (types[0] && types[0].id) || null;
}

// Exposes the function to Node-based unit tests. This branch never executes
// inside the real webview, where `module` is undefined, so it has no effect
// on production behavior.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { resolveCategoryDefaultTypeId };
}
