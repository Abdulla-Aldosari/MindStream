/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "node:assert";
import { resolveWorkspaceFolder } from "../src/workspaceFolder";

describe("resolveWorkspaceFolder", () => {
  const a = { uri: { fsPath: "/a" }, name: "a" };
  const b = { uri: { fsPath: "/b" }, name: "b" };

  it("returns the first folder", () => {
    assert.strictEqual(resolveWorkspaceFolder([a, b]), a);
  });

  it("returns the only folder", () => {
    assert.strictEqual(resolveWorkspaceFolder([b]), b);
  });

  it("returns undefined when no folder is open", () => {
    assert.strictEqual(resolveWorkspaceFolder(undefined), undefined);
  });

  it("returns undefined for an empty list", () => {
    assert.strictEqual(resolveWorkspaceFolder([]), undefined);
  });
});
