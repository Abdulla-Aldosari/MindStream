/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/
import * as assert from "assert";

// media/defaultType.js is a side-effect-free browser script (no `vscode` or
// DOM usage) that exports `resolveCategoryDefaultTypeId` for Node-based unit
// tests; see the guarded `module.exports` block at the bottom of that file.
const { resolveCategoryDefaultTypeId } = require("../media/defaultType.js") as {
  resolveCategoryDefaultTypeId: (category: { defaultTypeId?: string } | null, types: { id: string }[], fallbackTypeId?: string | null) => string | null;
};

describe("resolveCategoryDefaultTypeId", () => {
  const types = [{ id: "general" }, { id: "fix" }, { id: "idea" }];

  it("returns the first type when the category has no default", () => {
    assert.strictEqual(resolveCategoryDefaultTypeId({}, types, null), "general");
  });

  it("returns the first type when the category is null", () => {
    assert.strictEqual(resolveCategoryDefaultTypeId(null, types, null), "general");
  });

  it("returns the category's explicit default when it exists", () => {
    assert.strictEqual(resolveCategoryDefaultTypeId({ defaultTypeId: "fix" }, types, null), "fix");
  });

  it("falls back to the first type when the default type was deleted", () => {
    assert.strictEqual(resolveCategoryDefaultTypeId({ defaultTypeId: "gone" }, types, null), "general");
  });

  it("uses a valid fallbackTypeId when the category has no default", () => {
    assert.strictEqual(resolveCategoryDefaultTypeId({}, types, "idea"), "idea");
  });

  it("ignores an invalid fallbackTypeId and falls back to the first type", () => {
    assert.strictEqual(resolveCategoryDefaultTypeId({}, types, "gone"), "general");
  });

  it("prefers the category default over the fallbackTypeId", () => {
    assert.strictEqual(resolveCategoryDefaultTypeId({ defaultTypeId: "fix" }, types, "idea"), "fix");
  });

  it("returns null when there are no types", () => {
    assert.strictEqual(resolveCategoryDefaultTypeId({}, [], null), null);
  });
});
