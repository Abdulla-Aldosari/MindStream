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
