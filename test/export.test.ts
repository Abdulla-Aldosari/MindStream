/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { createEmptyData } from "../src/storage";
import { ItemsStore } from "../src/itemsStore";
import { TypesRegistry } from "../src/typesRegistry";
import { CategoriesRegistry } from "../src/categoriesRegistry";
import { STATUS_LABEL, buildMarkdownExport, buildWeeklyReportText, mergeData, validateImportData } from "../src/export";
import { buildWeeklyReport } from "../src/report";
import { GENERAL_CATEGORY_ID, MindStreamData, MindStreamItem } from "../src/models";
import { InMemoryStorage } from "./helpers";

describe("STATUS_LABEL", () => {
  it("maps every status to a readable label", () => {
    assert.deepStrictEqual(STATUS_LABEL, {
      pending: "None",
      "in-progress": "In Progress",
      done: "Done",
      canceled: "Canceled",
    });
  });
});

describe("buildMarkdownExport", () => {
  function setup() {
    const storage = new InMemoryStorage(createEmptyData());
    const items = new ItemsStore(storage);
    const types = new TypesRegistry(storage);
    const categories = new CategoriesRegistry(storage);
    return { storage, items, types, categories };
  }

  it("returns only the header for an empty store", () => {
    const { items, types, categories } = setup();
    assert.deepStrictEqual(buildMarkdownExport(items, types, categories), ["# MindStream Notes", ""]);
  });

  it("renders type, status, category, created date and archived flag", () => {
    const { items, types, categories } = setup();
    const typeId = types.add("Bug").id;
    const item = items.create({ typeId, title: "Fix crash", categoryId: GENERAL_CATEGORY_ID });
    item.createdAt = "2020-01-02T00:00:00.000Z";
    items.setArchived(item.id, true);

    const text = buildMarkdownExport(items, types, categories).join("\n");
    assert.ok(text.includes("## [Bug] Fix crash"));
    assert.ok(text.includes("- Status: None"));
    assert.ok(text.includes("- Category: General"));
    assert.ok(text.includes("- Created: 2020-01-02"));
    assert.ok(text.includes("- Archived"));
  });

  it("includes the completed line and description when present", () => {
    const { items, types, categories } = setup();
    const typeId = types.add("Fix").id;
    const item = items.create({ typeId, title: "Task", description: "Details here" });
    items.changeStatus(item.id, "done");

    const text = buildMarkdownExport(items, types, categories).join("\n");
    assert.ok(text.includes("- Status: Done"));
    assert.ok(text.includes("- Completed: "));
    assert.ok(text.includes("Details here"));
  });

  it("renders the canceled status and its date, without a completed line", () => {
    const { items, types, categories } = setup();
    const typeId = types.add("Idea").id;
    const item = items.create({ typeId, title: "Dropped" });
    items.changeStatus(item.id, "canceled");

    const text = buildMarkdownExport(items, types, categories).join("\n");
    assert.ok(text.includes("- Status: Canceled"));
    assert.ok(text.includes("- Canceled: "));
    assert.ok(!text.includes("- Completed: "));
  });

  it("renders the tasks of a task group as a checklist, in order", () => {
    const { items, types, categories } = setup();
    const typeId = types.add("Plan").id;
    items.create({
      typeId,
      title: "Release",
      tasks: [
        { title: "Write notes", completed: true },
        { title: "Tag", completed: false },
      ],
    });
    const lines = buildMarkdownExport(items, types, categories);
    const first = lines.indexOf("- [x] Write notes");
    assert.ok(first > 0);
    assert.strictEqual(lines[first + 1], "- [ ] Tag");
  });
});

describe("buildWeeklyReportText", () => {
  function makeItems(): ItemsStore {
    return new ItemsStore(new InMemoryStorage(createEmptyData()));
  }

  it("renders the summary and both lists when populated", () => {
    const items = makeItems();
    const done = items.create({ typeId: "t", title: "Done" });
    items.changeStatus(done.id, "done");
    const wip = items.create({ typeId: "t", title: "WIP" });
    items.changeStatus(wip.id, "in-progress");

    const report = buildWeeklyReport(items, new Date());
    const text = buildWeeklyReportText(report).join("\n");

    assert.ok(text.includes(`Week of ${report.weekLabel}`));
    assert.ok(text.includes(`Created this week:   ${report.createdCount} notes`));
    assert.ok(text.includes("Completed:"));
    assert.ok(text.includes("- Done"));
    assert.ok(text.includes("In progress:"));
    assert.ok(text.includes("- WIP"));
  });

  it("omits the lists when empty", () => {
    const items = makeItems();
    const report = buildWeeklyReport(items, new Date());
    const text = buildWeeklyReportText(report).join("\n");
    assert.ok(!text.includes("Completed:"));
    assert.ok(!text.includes("In progress:"));
  });
});

describe("mergeData", () => {
  function data(partial: Partial<MindStreamData>): MindStreamData {
    return { version: 1, types: [], categories: [], items: [], ...partial };
  }

  function item(id: string): MindStreamItem {
    return {
      id,
      typeId: "t",
      categoryId: GENERAL_CATEGORY_ID,
      title: id,
      status: "pending",
      archived: false,
      createdAt: "x",
      updatedAt: "x",
    };
  }

  it("merges types, categories and items by id without duplicates", () => {
    const target = data({
      types: [{ id: "t1", label: "A", createdAt: "x" }],
      categories: [{ id: "c1", label: "C", createdAt: "x" }],
      items: [item("i1")],
    });
    const incoming = data({
      types: [
        { id: "t1", label: "A", createdAt: "x" },
        { id: "t2", label: "B", createdAt: "x" },
      ],
      categories: [{ id: "c2", label: "D", createdAt: "x" }],
      items: [item("i1"), item("i2")],
    });

    mergeData(target, incoming);

    assert.deepStrictEqual(target.types.map((t) => t.id).sort(), ["t1", "t2"]);
    assert.deepStrictEqual(target.categories.map((c) => c.id).sort(), ["c1", "c2"]);
    assert.deepStrictEqual(target.items.map((i) => i.id).sort(), ["i1", "i2"]);
  });

  it("does not mutate the incoming data", () => {
    const target = data({});
    const incoming = data({ types: [{ id: "t1", label: "A", createdAt: "x" }] });
    mergeData(target, incoming);
    assert.strictEqual(incoming.types.length, 1);
    assert.strictEqual(target.types.length, 1);
  });
});

describe("validateImportData", () => {
  const entry = { id: "x", label: "X" };
  const item = { id: "i", typeId: "t", categoryId: "general", title: "A" };

  it("accepts a data file, including one without notes", () => {
    assert.deepStrictEqual(validateImportData(createEmptyData()), { ok: true });
    assert.deepStrictEqual(validateImportData({ types: [entry], categories: [entry], items: [item] }), { ok: true });
  });

  it("rejects JSON that is not a data object", () => {
    for (const raw of [null, 42, "text", [], [item]]) {
      assert.strictEqual(validateImportData(raw).ok, false, JSON.stringify(raw));
    }
  });

  it("rejects an unrelated JSON file such as VS Code settings", () => {
    const result = validateImportData({ "editor.fontSize": 14, "files.autoSave": "afterDelay" });
    assert.strictEqual(result.ok, false);
  });

  it("rejects a file missing one of the lists", () => {
    const result = validateImportData({ types: [], categories: [] });
    assert.deepStrictEqual(result, { ok: false, reason: 'it has no "items" list' });
  });

  it("rejects the whole file when one entry is malformed", () => {
    const result = validateImportData({ types: [entry], categories: [entry], items: [item, { id: "j", title: "No type" }] });
    assert.strictEqual(result.ok, false);
    assert.ok(!result.ok && result.reason.includes('entry 2 of "items"'));
  });
});
