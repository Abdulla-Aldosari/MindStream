/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Builds the codicon class for a note-type icon name. Kept in its own
// side-effect-free file (no acquireVsCodeApi/document usage) so it can be
// loaded as a global before sidebar.js in the webview, and required directly
// by Node-based unit tests (Mocha) without any DOM/vscode stubbing.
function iconClass(name) {
  const safe = typeof name === 'string' && /^[a-zA-Z0-9-]+$/.test(name) ? name : null;
  return 'codicon ' + (safe ? 'codicon-' + safe : 'codicon-tag');
}

// Exposes the function to Node-based unit tests. This branch never executes
// inside the real webview, where `module` is undefined, so it has no effect
// on production behavior.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { iconClass };
}
