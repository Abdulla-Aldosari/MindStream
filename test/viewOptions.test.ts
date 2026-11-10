/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/
import * as assert from "assert";
import { DEFAULT_PRIORITY, PRIORITIES, PRIORITY_LABEL, priorityFeatures } from "../src/priority";

// media/viewOptions.js is a side-effect-free browser script that exports its
// helpers for Node-based tests through a guarded `module.exports` block.
type Note = { id: string; status: string; priority?: string; updatedAt: string };
type View = { groupBy: string; sortBy: string; hiddenPriorities: string[] };
type Features = ReturnType<typeof priorityFeatures> & { levels: readonly string[]; labels: Record<string, string>; defaultValue: string | null };
type Group = { key: string; label: string; level: string | null; items: Note[] };
type Entry = {
  type: string;
  id?: string;
  value?: string;
  hidden?: boolean;
  items?: { value?: string; id?: string; hidden?: boolean; disabled?: boolean; hint?: string; checked?: boolean }[];
};

const VO = require("../media/viewOptions.js") as {
  DEFAULT_VIEW: View;
  NO_PRIORITY: Features;
  normalizeFeatures(raw: unknown): Features;
  restoreView(saved: unknown): View;
  restoreCollapsed(saved: unknown): Record<string, boolean>;
  effectiveGroupBy(view: View, f: Features): string;
  effectiveSortBy(view: View, f: Features): string;
  sortDisabledReason(key: string, view: View, f: Features): string | null;
  isFilterActive(view: View, f: Features): boolean;
  visibleItems(items: Note[], view: View, f: Features): Note[];
  sortChain(view: View, f: Features): string[];
  sortItems(items: Note[], view: View, f: Features): Note[];
  buildGroups(items: Note[], view: View, f: Features, labels: Record<string, string>): Group[] | null;
  triggerLabel(view: View, f: Features): string;
  menuEntries(view: View, f: Features): Entry[];
  applySelection(view: View, detail: unknown): View | null;
};

// The exact payload SidebarProvider posts (priorityFeatures + levels/labels/default).
function hostFeatures(style: Parameters<typeof priorityFeatures>[0]): Features {
  return VO.normalizeFeatures({ ...priorityFeatures(style), levels: PRIORITIES, labels: PRIORITY_LABEL, defaultValue: DEFAULT_PRIORITY });
}

const ON = hostFeatures("chip");
const OFF = hostFeatures("off");
const view = (groupBy: string, sortBy: string, hiddenPriorities: string[] = []): View => ({ groupBy, sortBy, hiddenPriorities });
const ids = (list: Note[]) => list.map((n) => n.id);

// File order n1..n6. updatedAt: n6 newest, n1 oldest.
const notes: Note[] = [
  { id: "n1", status: "done", priority: "critical", updatedAt: "2026-01-01T00:00:00Z" },
  { id: "n2", status: "pending", updatedAt: "2026-01-02T00:00:00Z" },
  { id: "n3", status: "pending", priority: "low", updatedAt: "2026-01-03T00:00:00Z" },
  { id: "n4", status: "in-progress", priority: "high", updatedAt: "2026-01-04T00:00:00Z" },
  { id: "n5", status: "pending", priority: "critical", updatedAt: "2026-01-05T00:00:00Z" },
  { id: "n6", status: "pending", priority: "high", updatedAt: "2026-01-06T00:00:00Z" },
];

describe("viewOptions: features and saved state", () => {
  it("defaults to group by status, sort by priority", () => {
    assert.deepStrictEqual(VO.restoreView(undefined), { groupBy: "status", sortBy: "priority", hiddenPriorities: [] });
  });

  it("migrates the older single view mode", () => {
    assert.deepStrictEqual(VO.restoreView({ viewMode: "auto" }), view("none", "status"));
    assert.deepStrictEqual(VO.restoreView({ viewMode: "fixed" }), view("none", "fixed"));
    assert.deepStrictEqual(VO.restoreView({ viewMode: "grouped" }), view("status", "date"));
  });

  it("prefers new keys over the older view mode and rejects junk", () => {
    assert.deepStrictEqual(VO.restoreView({ viewMode: "auto", groupBy: "priority", sortBy: "date" }), view("priority", "date"));
    assert.deepStrictEqual(VO.restoreView({ groupBy: "x", sortBy: 5, hiddenPriorities: ["low", "low", 3] }), view("status", "priority", ["low"]));
  });

  it("scopes older collapsed status keys", () => {
    assert.deepStrictEqual(VO.restoreCollapsed({ done: true, pending: false, "priority:high": true }), { "status:done": true, "priority:high": true });
  });

  it("treats a missing or disabled payload as the disabled feature set", () => {
    assert.strictEqual(VO.normalizeFeatures(undefined).enabled, false);
    assert.deepStrictEqual(OFF, VO.NO_PRIORITY);
    assert.strictEqual(ON.defaultValue, "low");
    assert.deepStrictEqual(ON.levels, [...PRIORITIES]);
  });
});

describe("viewOptions: sorting without groups", () => {
  it("Date modified: newest first, nothing else", () => {
    assert.deepStrictEqual(VO.sortChain(view("none", "date"), ON), ["date"]);
    assert.deepStrictEqual(ids(VO.sortItems(notes, view("none", "date"), ON)), ["n6", "n5", "n4", "n3", "n2", "n1"]);
  });

  it("Fixed order: file order as-is", () => {
    assert.deepStrictEqual(VO.sortChain(view("none", "fixed"), ON), []);
    assert.deepStrictEqual(ids(VO.sortItems(notes, view("none", "fixed"), ON)), ["n1", "n2", "n3", "n4", "n5", "n6"]);
  });

  it("Status: status, then priority (unassigned last), then date", () => {
    assert.deepStrictEqual(VO.sortChain(view("none", "status"), ON), ["status", "priority", "date"]);
    assert.deepStrictEqual(ids(VO.sortItems(notes, view("none", "status"), ON)), ["n5", "n6", "n3", "n2", "n4", "n1"]);
  });

  it("Priority: priority (unassigned last), then status, then date", () => {
    assert.deepStrictEqual(VO.sortChain(view("none", "priority"), ON), ["priority", "status", "date"]);
    assert.deepStrictEqual(ids(VO.sortItems(notes, view("none", "priority"), ON)), ["n5", "n1", "n6", "n4", "n3", "n2"]);
  });

  it("does not mutate the input", () => {
    const copy = [...notes];
    VO.sortItems(copy, view("none", "date"), ON);
    assert.deepStrictEqual(ids(copy), ["n1", "n2", "n3", "n4", "n5", "n6"]);
  });
});

describe("viewOptions: grouping", () => {
  it("status groups drop the status key from the chain and always list three groups", () => {
    const v = view("status", "priority");
    assert.deepStrictEqual(VO.sortChain(v, ON), ["priority", "date"]);
    const groups = VO.buildGroups(VO.sortItems(notes, v, ON), v, ON, { pending: "None", "in-progress": "In Progress", done: "Done" })!;
    assert.deepStrictEqual(
      groups.map((g) => [g.key, g.label, ids(g.items)]),
      [
        ["status:pending", "None", ["n5", "n6", "n3", "n2"]],
        ["status:in-progress", "In Progress", ["n4"]],
        ["status:done", "Done", ["n1"]],
      ]
    );
  });

  it("priority groups list every level (even empty) and Unassigned only when it has notes", () => {
    const v = view("priority", "status");
    assert.deepStrictEqual(VO.sortChain(v, ON), ["status", "date"]);
    const groups = VO.buildGroups(VO.sortItems(notes, v, ON), v, ON, {})!;
    assert.deepStrictEqual(
      groups.map((g) => [g.key, g.level, ids(g.items)]),
      [
        ["priority:critical", "critical", ["n5", "n1"]],
        ["priority:high", "high", ["n6", "n4"]],
        ["priority:medium", "medium", []],
        ["priority:low", "low", ["n3"]],
        ["priority:none", null, ["n2"]],
      ]
    );
    const assignedOnly = notes.filter((n) => n.priority);
    assert.strictEqual(
      VO.buildGroups(assignedOnly, v, ON, {})!.some((g) => g.key === "priority:none"),
      false
    );
  });

  it("returns null when not grouping", () => {
    assert.strictEqual(VO.buildGroups(notes, view("none", "date"), ON, {}), null);
  });

  it("the sort key equal to the group key is disabled and falls back to date", () => {
    for (const key of ["status", "priority"]) {
      const v = view(key, key);
      assert.strictEqual(VO.sortDisabledReason(key, v, ON), `Already grouped by ${key}`);
      assert.strictEqual(VO.effectiveSortBy(v, ON), "date");
      assert.strictEqual(v.sortBy, key, "the saved choice is kept");
    }
  });
});

describe("viewOptions: priority filter", () => {
  it("hides the chosen levels but never unassigned notes", () => {
    const v = view("none", "fixed", ["critical", "high", "medium", "low"]);
    assert.ok(VO.isFilterActive(v, ON));
    assert.deepStrictEqual(ids(VO.visibleItems(notes, v, ON)), ["n2"]);
  });

  it("hidden levels get no group in priority grouping", () => {
    const v = view("priority", "date", ["high"]);
    const groups = VO.buildGroups(VO.sortItems(VO.visibleItems(notes, v, ON), v, ON), v, ON, {})!;
    assert.deepStrictEqual(
      groups.map((g) => g.key),
      ["priority:critical", "priority:medium", "priority:low", "priority:none"]
    );
  });

  it("ignores unknown levels", () => {
    assert.strictEqual(VO.isFilterActive(view("none", "date", ["urgent"]), ON), false);
  });
});

describe("viewOptions: priority system disabled", () => {
  it("falls back to no grouping and date sort without rewriting the saved view", () => {
    const v = view("priority", "priority", ["low"]);
    assert.strictEqual(VO.effectiveGroupBy(v, OFF), "none");
    assert.strictEqual(VO.effectiveSortBy(v, OFF), "date");
    assert.strictEqual(VO.isFilterActive(v, OFF), false);
    assert.deepStrictEqual(ids(VO.visibleItems(notes, v, OFF)), ids(notes));
    assert.deepStrictEqual(v, view("priority", "priority", ["low"]));
  });

  it("removes priority from the status chain", () => {
    assert.deepStrictEqual(VO.sortChain(view("none", "status"), OFF), ["status", "date"]);
    assert.deepStrictEqual(ids(VO.sortItems(notes, view("none", "status"), OFF)), ["n6", "n5", "n3", "n2", "n4", "n1"]);
  });

  it("hides every priority entry from the menu", () => {
    const entries = VO.menuEntries(view("status", "priority"), OFF);
    const visible = (e: Entry) => (e.items || []).filter((i) => !i.hidden).map((i) => i.value ?? i.id);
    assert.deepStrictEqual(visible(entries[0]), ["none", "status"]);
    assert.deepStrictEqual(visible(entries[2]), ["date", "fixed", "status"]);
    assert.strictEqual(entries[4].hidden, true);
    assert.strictEqual(entries[5].hidden, true);
  });
});

describe("viewOptions: menu", () => {
  it("marks the applied values and disables the grouped sort key with a hint", () => {
    const entries = VO.menuEntries(view("status", "status"), ON);
    assert.strictEqual(entries[0].value, "status");
    assert.strictEqual(entries[2].value, "date");
    const statusSort = entries[2].items!.find((i) => i.value === "status")!;
    assert.strictEqual(statusSort.disabled, true);
    assert.strictEqual(statusSort.hint, "Already grouped by status");
  });

  it("shows 'Show all priorities' only while something is hidden", () => {
    assert.strictEqual(VO.menuEntries(view("none", "date"), ON)[5].hidden, true);
    const entries = VO.menuEntries(view("none", "date", ["low"]), ON);
    assert.strictEqual(entries[5].hidden, false);
    assert.strictEqual(entries[4].items!.find((i) => i.id === "show:low")!.checked, false);
  });

  it("applySelection returns a new view for each action", () => {
    const base = view("status", "priority");
    assert.deepStrictEqual(VO.applySelection(base, { kind: "radio", group: "groupBy", value: "none" }), view("none", "priority"));
    assert.deepStrictEqual(VO.applySelection(base, { kind: "radio", group: "sortBy", value: "fixed" }), view("status", "fixed"));
    const hidden = VO.applySelection(base, { kind: "checkbox", id: "show:low", checked: false })!;
    assert.deepStrictEqual(hidden.hiddenPriorities, ["low"]);
    assert.deepStrictEqual(VO.applySelection(hidden, { kind: "checkbox", id: "show:low", checked: true })!.hiddenPriorities, []);
    assert.deepStrictEqual(VO.applySelection(hidden, { kind: "item", id: "show-all" })!.hiddenPriorities, []);
    assert.strictEqual(VO.applySelection(base, { kind: "radio", group: "groupBy", value: "bogus" }), null);
    assert.deepStrictEqual(base, view("status", "priority"), "input is not mutated");
  });

  it("labels the trigger with the applied group and sort", () => {
    assert.strictEqual(VO.triggerLabel(view("status", "priority"), ON), "Status · Priority");
    assert.strictEqual(VO.triggerLabel(view("none", "fixed"), ON), "Fixed order");
    assert.strictEqual(VO.triggerLabel(view("priority", "priority"), OFF), "Date modified");
  });
});
