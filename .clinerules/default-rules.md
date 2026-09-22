# Default Rules

- Use English exclusively in all generated/created files: source code, comments, identifiers, UI strings, configuration, documentation, tests, and every other file in the project.
- Arabic is allowed ONLY in conversation with the client, never inside any file.

## Rule: No Native `<select>` Elements

Never use native HTML `<select>` elements in the webview. All dropdowns must use the custom select system.

Use `renderCustomSelect()` to render and `bindCustomSelect()` to bind events. Both functions are defined in `media/sidebar.js`.

Reason: Native `<select>` has inconsistent styling across platforms inside VS Code webviews and cannot match the extension's design system.


