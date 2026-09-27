/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/
import * as assert from 'assert';

// media/iconClass.js is a side-effect-free browser script (no `vscode` or
// DOM usage) that exports `iconClass` for Node-based unit tests; see the
// guarded `module.exports` block at the bottom of that file.
const { iconClass } = require('../media/iconClass.js') as { iconClass: (name: unknown) => string };

describe('iconClass', () => {
  it('returns the codicon class for a plain alphanumeric name', () => {
    assert.strictEqual(iconClass('wrench'), 'codicon codicon-wrench');
  });

  it('accepts hyphens in the icon name', () => {
    assert.strictEqual(iconClass('symbol-method'), 'codicon codicon-symbol-method');
  });

  it('falls back to the default tag icon for null', () => {
    assert.strictEqual(iconClass(null), 'codicon codicon-tag');
  });

  it('falls back to the default tag icon for undefined', () => {
    assert.strictEqual(iconClass(undefined), 'codicon codicon-tag');
  });

  it('falls back to the default tag icon for an empty string', () => {
    assert.strictEqual(iconClass(''), 'codicon codicon-tag');
  });

  it('falls back to the default tag icon for a non-string value', () => {
    assert.strictEqual(iconClass(42), 'codicon codicon-tag');
  });

  it('sanitizes a value containing an HTML injection attempt', () => {
    assert.strictEqual(
      iconClass('"><img src=x onerror=alert(1)>'),
      'codicon codicon-tag'
    );
  });

  it('sanitizes a value containing a quote character', () => {
    assert.strictEqual(iconClass('tag"'), 'codicon codicon-tag');
  });

  it('sanitizes a value containing whitespace', () => {
    assert.strictEqual(iconClass('tag icon'), 'codicon codicon-tag');
  });
});
