/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { DEFAULT_FORM_CLOSE_BEHAVIOR, DEFAULT_TAB_CLOSE_BEHAVIOR, normalizeFormCloseBehavior, normalizeTabCloseBehavior } from "../src/noteFormSettings";

describe("normalizeTabCloseBehavior", () => {
  it("keeps the edits by default", () => {
    assert.strictEqual(DEFAULT_TAB_CLOSE_BEHAVIOR, "keep");
    assert.strictEqual(normalizeTabCloseBehavior(undefined), "keep");
    assert.strictEqual(normalizeTabCloseBehavior("keep"), "keep");
  });

  it("asks only for the exact value, and falls back for anything else", () => {
    assert.strictEqual(normalizeTabCloseBehavior("ask"), "ask");
    for (const bad of ["ASK", "", 1, null, {}, "discard"]) {
      assert.strictEqual(normalizeTabCloseBehavior(bad), "keep", String(bad));
    }
  });
});

describe("normalizeFormCloseBehavior", () => {
  it("asks by default", () => {
    assert.strictEqual(DEFAULT_FORM_CLOSE_BEHAVIOR, "ask");
    assert.strictEqual(normalizeFormCloseBehavior(undefined), "ask");
    assert.strictEqual(normalizeFormCloseBehavior("ask"), "ask");
  });

  it("discards only for the exact value, so a bad setting never loses text silently", () => {
    assert.strictEqual(normalizeFormCloseBehavior("discard"), "discard");
    for (const bad of ["DISCARD", "", 0, null, {}, "keep"]) {
      assert.strictEqual(normalizeFormCloseBehavior(bad), "ask", String(bad));
    }
  });
});
