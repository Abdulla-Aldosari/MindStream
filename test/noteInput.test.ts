/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { MAX_LABEL, MAX_TASKS, changedSince, cleanIcon, cleanLabel, cleanTasks, cleanTitle, sameFieldValue } from "../src/noteInput";
import { MindStreamItem } from "../src/models";
import { DomainError, refusal } from "../src/domainError";

const invalid = (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT" && err.message.includes("Nothing was changed.");

describe("noteInput", () => {
  it("cleanTitle folds line breaks and trims", () => {
    assert.strictEqual(cleanTitle("  Fix\n the  save  "), "Fix the  save");
    assert.throws(() => cleanTitle(" \n "), invalid);
  });

  it("cleanLabel folds spaces and refuses an empty or long name", () => {
    assert.strictEqual(cleanLabel("  Before \t Release ", "category"), "Before Release");
    assert.throws(() => cleanLabel("x".repeat(MAX_LABEL + 1), "type"), invalid);
    assert.throws(() => cleanLabel(3, "type"), invalid);
  });

  it("cleanIcon accepts codicon names only", () => {
    assert.strictEqual(cleanIcon("debug-alt"), "debug-alt");
    for (const bad of ["", "a b", "<x>", 'a"b', 4]) {
      assert.throws(() => cleanIcon(bad), invalid);
    }
  });

  it("cleanTasks drops blank entries but refuses a list that is too long", () => {
    assert.deepStrictEqual(cleanTasks([{ title: " A ", completed: true }, { title: " " }, "junk"]), [{ title: "A", completed: true }]);
    assert.deepStrictEqual(cleanTasks([]), []);
    assert.throws(() => cleanTasks(Array.from({ length: MAX_TASKS + 1 }, () => ({ title: "t" }))), invalid);
  });

  it("sameFieldValue ignores line endings, title spaces, blank tasks, and absent values", () => {
    assert.strictEqual(sameFieldValue("description", "a\r\nb", "a\nb"), true);
    assert.strictEqual(sameFieldValue("description", undefined, ""), true);
    assert.strictEqual(sameFieldValue("title", " A ", "A"), true);
    assert.strictEqual(sameFieldValue("priority", undefined, null), true);
    assert.strictEqual(sameFieldValue("tasks", [{ title: " x " }, { title: "" }], [{ title: "x", completed: false }]), true);
    assert.strictEqual(sameFieldValue("tasks", [{ title: "x", completed: true }], [{ title: "x", completed: false }]), false);
    assert.strictEqual(sameFieldValue("description", "a", "b"), false);
  });

  it("changedSince lists only the listed fields that differ", () => {
    const note = { title: "T", description: "new", typeId: "t", categoryId: "c", priority: "low" } as MindStreamItem;
    assert.deepStrictEqual(changedSince(note, { title: "T", description: "old" }), ["description"]);
    assert.deepStrictEqual(changedSince(note, { priority: "low", tasks: [] }), []);
    assert.deepStrictEqual(changedSince(note, {}), []);
  });

  it("refusal builds the complete message", () => {
    assert.strictEqual(refusal("the title is empty", "Give it a title."), "Not saved: the title is empty. Nothing was changed. Give it a title.");
  });
});
