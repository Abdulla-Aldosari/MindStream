/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { MindStreamItem, MindStreamLink } from "../src/models";
import { toNoteDetail, toNoteSummary } from "../src/mcp/noteView";

const types = { label: (id: string) => (id === "t1" ? "Bug" : "(Deleted type)") };
const categories = { label: (id: string) => (id === "c1" ? "Release" : "(Deleted category)") };

function note(overrides: Partial<MindStreamItem> = {}): MindStreamItem {
  return {
    id: "n1",
    typeId: "t1",
    categoryId: "c1",
    title: "Fix save",
    status: "pending",
    archived: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-02T10:00:00.000Z",
    ...overrides,
  };
}

const link: MindStreamLink = { filePath: "src/a.ts", lineStart: 5, lineEnd: 6, anchor: { text: ["secret anchor"], before: "", after: "" }, state: "changed" };
const twoTasks = [
  { title: "a", completed: true },
  { title: "b", completed: false },
];

describe("toNoteSummary", () => {
  it("carries ids and labels side by side, with no priority as null", () => {
    const s = toNoteSummary(note(), types, categories);
    assert.deepStrictEqual(s.type, { id: "t1", label: "Bug" });
    assert.deepStrictEqual(s.category, { id: "c1", label: "Release" });
    assert.strictEqual(s.priority, null);
    assert.strictEqual(s.linkState, null);
    assert.strictEqual(s.archived, false);
    assert.strictEqual("tasks" in s, false);
    assert.strictEqual("completedAt" in s, false);
  });

  it("reads a deleted type or category as its placeholder label, keeping the id", () => {
    const s = toNoteSummary(note({ typeId: "gone", categoryId: "gone2" }), types, categories);
    assert.deepStrictEqual(s.type, { id: "gone", label: "(Deleted type)" });
    assert.deepStrictEqual(s.category, { id: "gone2", label: "(Deleted category)" });
  });

  it("counts done tasks, and reports the outcome times and link state", () => {
    const s = toNoteSummary(note({ priority: "high", status: "done", completedAt: "d", tasks: twoTasks, link }), types, categories);
    assert.deepStrictEqual(s.tasks, { done: 1, total: 2 });
    assert.strictEqual(s.priority, "high");
    assert.strictEqual(s.completedAt, "d");
    assert.strictEqual(s.linkState, "changed");
  });

  it("reports canceledAt for a canceled note", () => {
    assert.strictEqual(toNoteSummary(note({ status: "canceled", canceledAt: "c" }), types, categories).canceledAt, "c");
  });
});

describe("toNoteDetail", () => {
  it("adds the description and the full task list with 0-based indexes", () => {
    const d = toNoteDetail(note({ description: "Body", tasks: twoTasks }), types, categories);
    assert.strictEqual(d.description, "Body");
    assert.deepStrictEqual(d.tasks, [
      { index: 0, title: "a", completed: true },
      { index: 1, title: "b", completed: false },
    ]);
  });

  it("reads a note without a description as empty text and without tasks as an empty list", () => {
    const d = toNoteDetail(note(), types, categories);
    assert.strictEqual(d.description, "");
    assert.deepStrictEqual(d.tasks, []);
    assert.strictEqual(d.link, null);
  });

  it("shows the link location and state but never the anchor text", () => {
    const d = toNoteDetail(note({ link }), types, categories);
    assert.deepStrictEqual(d.link, { filePath: "src/a.ts", lineStart: 5, lineEnd: 6, state: "changed" });
    assert.strictEqual(JSON.stringify(d).includes("secret anchor"), false);
  });

  it("uses the given link (as just resolved) instead of the stored one", () => {
    const resolved: MindStreamLink = { filePath: "src/a.ts", lineStart: 9, state: "ok" };
    const d = toNoteDetail(note({ link }), types, categories, resolved);
    assert.deepStrictEqual(d.link, { filePath: "src/a.ts", lineStart: 9, lineEnd: 9, state: "ok" });
    assert.strictEqual(d.linkState, "ok");
  });
});
