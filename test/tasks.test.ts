/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { MAX_TASK_TITLE, sanitizeTasks } from "../src/tasks";
import { normalizeData } from "../src/storage";

describe("sanitizeTasks", () => {
  it("returns undefined for anything that is not a non-empty task array", () => {
    assert.strictEqual(sanitizeTasks(undefined), undefined);
    assert.strictEqual(sanitizeTasks(null), undefined);
    assert.strictEqual(sanitizeTasks("tasks"), undefined);
    assert.strictEqual(sanitizeTasks({ title: "A" }), undefined);
    assert.strictEqual(sanitizeTasks([]), undefined);
  });

  it("keeps the order and the completed state", () => {
    assert.deepStrictEqual(
      sanitizeTasks([
        { title: "One", completed: true },
        { title: "Two", completed: false },
      ]),
      [
        { title: "One", completed: true },
        { title: "Two", completed: false },
      ]
    );
  });

  it("drops junk entries and empty titles, and returns undefined when nothing is left", () => {
    assert.deepStrictEqual(sanitizeTasks([null, 5, "x", { title: 3 }, { completed: true }, { title: "   " }, { title: "Keep" }]), [{ title: "Keep", completed: false }]);
    assert.strictEqual(sanitizeTasks([{ title: "" }, { title: " \n " }]), undefined);
  });

  it("trims titles and folds line breaks into one line", () => {
    assert.deepStrictEqual(sanitizeTasks([{ title: "  Write\r\n  tests \n now  " }]), [{ title: "Write tests now", completed: false }]);
  });

  it("caps a title at MAX_TASK_TITLE characters", () => {
    const [task] = sanitizeTasks([{ title: "a".repeat(MAX_TASK_TITLE + 50) }]) ?? [];
    assert.strictEqual(task.title.length, MAX_TASK_TITLE);
  });

  it("reads completed as true only when it is exactly true", () => {
    const tasks = sanitizeTasks([
      { title: "A", completed: "true" },
      { title: "B", completed: 1 },
      { title: "C", completed: true },
    ]);
    assert.deepStrictEqual(
      tasks?.map((t) => t.completed),
      [false, false, true]
    );
  });

  it("never keeps extra keys", () => {
    assert.deepStrictEqual(sanitizeTasks([{ title: "A", completed: true, order: 3, x: 1 }]), [{ title: "A", completed: true }]);
  });
});

describe("normalizeData tasks", () => {
  const base = { id: "n1", typeId: "t", categoryId: "general", title: "Note", status: "pending", createdAt: "", updatedAt: "" };

  it("never adds the key to a note without tasks", () => {
    assert.ok(!("tasks" in normalizeData({ items: [{ ...base }] }).items[0]));
  });

  it("cleans a task list", () => {
    const data = normalizeData({ items: [{ ...base, tasks: [{ title: " A ", completed: true }, { title: "" }, "junk"] }] });
    assert.deepStrictEqual(data.items[0].tasks, [{ title: "A", completed: true }]);
  });

  it("drops an empty or invalid list", () => {
    assert.ok(!("tasks" in normalizeData({ items: [{ ...base, tasks: [] }] }).items[0]));
    assert.ok(!("tasks" in normalizeData({ items: [{ ...base, tasks: "x" }] }).items[0]));
    assert.ok(!("tasks" in normalizeData({ items: [{ ...base, tasks: [{ title: " " }] }] }).items[0]));
  });
});
