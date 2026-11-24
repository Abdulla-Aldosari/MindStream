/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";

// media/noteForm.js is a side-effect-free browser script that exports its
// helpers for Node-based tests through a guarded `module.exports` block.
type Fields = {
  title?: string;
  description?: string;
  typeId?: string | null;
  categoryId?: string | null;
  priority?: string | null;
  tasks?: { title: string; completed?: boolean }[];
};
type Snapshot = object;

const NF = require("../media/noteForm.js") as {
  snapshot(fields: Fields): Snapshot;
  hasChanges(initial: Snapshot | null, current: Snapshot | null): boolean;
  closeAction(behavior: string, initial: Snapshot | null, current: Snapshot | null): "close" | "confirm";
  baseOf(item: object | null): Fields;
  changedFields(base: Fields | undefined, current: Fields | undefined): string[];
  changedNotice(fields: string[]): string;
  GONE: string;
};

const base: Fields = { title: "Idea", description: "text", typeId: "t1", categoryId: "c1", priority: "medium", tasks: [{ title: "a", completed: false }] };

describe("NoteForm.hasChanges", () => {
  it("is false for identical fields", () => {
    assert.strictEqual(NF.hasChanges(NF.snapshot(base), NF.snapshot({ ...base })), false);
  });

  it("detects a change in every kind of field", () => {
    const initial = NF.snapshot(base);
    const edits: Fields[] = [
      { ...base, title: "Idea 2" },
      { ...base, description: "text!" },
      { ...base, typeId: "t2" },
      { ...base, categoryId: "c2" },
      { ...base, priority: "high" },
      { ...base, tasks: [{ title: "a", completed: true }] },
      { ...base, tasks: [{ title: "a" }, { title: "b" }] },
      { ...base, tasks: [] },
    ];
    for (const edit of edits) {
      assert.strictEqual(NF.hasChanges(initial, NF.snapshot(edit)), true, JSON.stringify(edit));
    }
  });

  it("ignores what the host drops on Save: padding around the title and blank tasks", () => {
    const initial = NF.snapshot(base);
    assert.strictEqual(NF.hasChanges(initial, NF.snapshot({ ...base, title: "  Idea  " })), false);
    assert.strictEqual(NF.hasChanges(initial, NF.snapshot({ ...base, tasks: [{ title: "a" }, { title: "   " }] })), false);
  });

  it("treats CRLF and LF descriptions as the same text (the description tab may use CRLF)", () => {
    const initial = NF.snapshot({ ...base, description: "a\nb" });
    assert.strictEqual(NF.hasChanges(initial, NF.snapshot({ ...base, description: "a\r\nb" })), false);
  });

  it("treats a missing value like an empty one, and never reports a change without a baseline", () => {
    assert.strictEqual(NF.hasChanges(NF.snapshot({}), NF.snapshot({ title: "", description: "", priority: null })), false);
    assert.strictEqual(NF.hasChanges(null, NF.snapshot(base)), false);
    assert.strictEqual(NF.hasChanges(NF.snapshot(base), null), false);
  });
});

describe("NoteForm.closeAction", () => {
  const initial = NF.snapshot(base);
  const changed = NF.snapshot({ ...base, description: "typed in the editor tab" });

  it("asks when a field changed and the setting is to ask", () => {
    assert.strictEqual(NF.closeAction("ask", initial, changed), "confirm");
  });

  it("closes at once when nothing changed", () => {
    assert.strictEqual(NF.closeAction("ask", initial, NF.snapshot(base)), "close");
  });

  it("closes without asking when the setting says to discard", () => {
    assert.strictEqual(NF.closeAction("discard", initial, changed), "close");
  });

  it("asks for any unknown setting value, so text is never lost silently", () => {
    assert.strictEqual(NF.closeAction("", initial, changed), "confirm");
    assert.strictEqual(NF.closeAction("bogus", initial, changed), "confirm");
  });
});

describe("NoteForm: a note changed elsewhere while its form is open", () => {
  const stored = {
    id: "n1",
    title: "Idea",
    description: "text",
    typeId: "t1",
    categoryId: "c1",
    priority: "medium",
    tasks: [{ title: "a", completed: false }],
    status: "pending",
    updatedAt: "x",
  };

  it("baseOf keeps only the editable fields, with absent values read as empty", () => {
    assert.deepStrictEqual(NF.baseOf(stored), base);
    assert.deepStrictEqual(NF.baseOf({ title: "T" }), { title: "T", description: "", typeId: null, categoryId: null, priority: null, tasks: [] });
  });

  it("changedFields names the fields that changed, ignoring the status and line endings", () => {
    const opened = NF.baseOf(stored);
    assert.deepStrictEqual(NF.changedFields(opened, NF.baseOf({ ...stored, status: "done", updatedAt: "y" })), []);
    assert.deepStrictEqual(NF.changedFields(opened, NF.baseOf({ ...stored, description: "text".replace("t", "t") })), []);
    assert.deepStrictEqual(NF.changedFields(opened, NF.baseOf({ ...stored, description: "more", tasks: [{ title: "a", completed: true }] })), ["description", "tasks"]);
    assert.deepStrictEqual(NF.changedFields(opened, NF.baseOf({ ...stored, typeId: "t2", categoryId: "c2" })), ["type", "category"]);
  });

  it("a field left out of the base (a hidden priority) is never compared", () => {
    const opened = { ...NF.baseOf(stored) } as Record<string, unknown>;
    delete opened.priority;
    assert.deepStrictEqual(NF.changedFields(opened as Fields, NF.baseOf({ ...stored, priority: "high" })), []);
  });

  it("the notice says what changed, or that the note is gone, and that Save will be refused", () => {
    assert.match(NF.changedNotice(["description"]), /changed elsewhere \(description\)\. Saving it will be refused/);
    assert.match(NF.changedNotice([NF.GONE]), /archived or deleted elsewhere/);
  });
});
