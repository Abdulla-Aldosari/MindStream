/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/
import * as assert from "assert";

// media/taskList.js is a side-effect-free browser script that exports its
// helpers for Node-based tests through a guarded `module.exports` block.
type Task = { title: string; completed: boolean };

const TaskList = require("../media/taskList.js") as {
  isTaskGroup(item: unknown): boolean;
  progress(tasks: unknown): { done: number; total: number; percent: number };
  move<T>(list: T[], from: number, to: number): T[];
  focusAvailable(count: unknown): boolean;
  FOCUS_MIN_TASKS: number;
};

const t = (title: string, completed = false): Task => ({ title, completed });

describe("TaskList.isTaskGroup", () => {
  it("is true only with at least one task", () => {
    assert.strictEqual(TaskList.isTaskGroup({ tasks: [t("A")] }), true);
    assert.strictEqual(TaskList.isTaskGroup({ tasks: [] }), false);
    assert.strictEqual(TaskList.isTaskGroup({}), false);
    assert.strictEqual(TaskList.isTaskGroup({ tasks: "A" }), false);
    assert.strictEqual(TaskList.isTaskGroup(null), false);
  });
});

describe("TaskList.progress", () => {
  it("is zero for no tasks", () => {
    assert.deepStrictEqual(TaskList.progress([]), { done: 0, total: 0, percent: 0 });
    assert.deepStrictEqual(TaskList.progress(undefined), { done: 0, total: 0, percent: 0 });
  });

  it("counts completed tasks whatever their order", () => {
    assert.deepStrictEqual(TaskList.progress([t("A"), t("B"), t("C", true)]), { done: 1, total: 3, percent: 33 });
    assert.deepStrictEqual(TaskList.progress([t("A", true), t("B"), t("C")]), { done: 1, total: 3, percent: 33 });
  });

  it("rounds the percentage and reaches 100 when all are done", () => {
    assert.strictEqual(TaskList.progress([t("A", true), t("B", true), t("C")]).percent, 67);
    assert.strictEqual(TaskList.progress([t("A", true), t("B", true)]).percent, 100);
  });

  it("counts only completed === true", () => {
    assert.strictEqual(TaskList.progress([{ title: "A", completed: "yes" }, null]).done, 0);
  });
});

describe("TaskList.focusAvailable", () => {
  it("is offered only for more than five tasks", () => {
    assert.strictEqual(TaskList.FOCUS_MIN_TASKS, 5);
    assert.strictEqual(TaskList.focusAvailable(5), false);
    assert.strictEqual(TaskList.focusAvailable(6), true);
    assert.strictEqual(TaskList.focusAvailable(0), false);
  });

  it("rejects values that are not a count", () => {
    assert.strictEqual(TaskList.focusAvailable(undefined), false);
    assert.strictEqual(TaskList.focusAvailable(NaN), false);
    assert.strictEqual(TaskList.focusAvailable("9"), false);
  });
});

describe("TaskList.move", () => {
  it("moves an entry forward and backward without changing the input", () => {
    const list = ["a", "b", "c", "d"];
    assert.deepStrictEqual(TaskList.move(list, 0, 2), ["b", "c", "a", "d"]);
    assert.deepStrictEqual(TaskList.move(list, 3, 1), ["a", "d", "b", "c"]);
    assert.deepStrictEqual(list, ["a", "b", "c", "d"]);
  });

  it("clamps out-of-range positions and handles an empty list", () => {
    assert.deepStrictEqual(TaskList.move(["a", "b"], 0, 9), ["b", "a"]);
    assert.deepStrictEqual(TaskList.move(["a", "b"], 1, -3), ["b", "a"]);
    assert.deepStrictEqual(TaskList.move([], 0, 1), []);
  });

  it("returns a copy when nothing moves", () => {
    const list = ["a"];
    const next = TaskList.move(list, 0, 0);
    assert.deepStrictEqual(next, ["a"]);
    assert.notStrictEqual(next, list);
  });
});
