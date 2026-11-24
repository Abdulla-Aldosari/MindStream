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
import { WorkPauseStore } from "../src/workPauseStore";
import { LinkTracker } from "../src/linkTracker";
import { buildLinkAt } from "../src/linkResolver";
import { ERROR_CODES, errorCodeOf } from "../src/domainError";
import { MindStreamLink } from "../src/models";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, NotesQuery } from "../src/mcp/notesQuery";
import { BLOCKED, FakeFiles, InMemoryStorage } from "./helpers";

function setup(options: { priority?: boolean } = {}) {
  const storage = new InMemoryStorage(createEmptyData());
  const items = new ItemsStore(storage);
  const types = new TypesRegistry(storage);
  const categories = new CategoriesRegistry(storage);
  const workPause = new WorkPauseStore(storage);
  const files = new FakeFiles();
  const links = new LinkTracker(items, files);
  const query = new NotesQuery({ storage, items, types, categories, workPause, links, files, priorityEnabled: () => options.priority !== false });
  const typeId = types.list()[0].id;
  const linkAt = (filePath: string, lineStart: number, lineEnd = lineStart): MindStreamLink => buildLinkAt(filePath, files.files.get(filePath) ?? [], lineStart, lineEnd)!;
  return { storage, items, types, categories, workPause, files, query, typeId, linkAt };
}

const titles = (r: { notes: { title: string }[] }) => r.notes.map((n) => n.title);
const refuses = (code: string) => (err: unknown) => errorCodeOf(err) === code;

describe("NotesQuery.listNotes filters", () => {
  it("lists the notes that are not archived by default", () => {
    const { query, items, typeId } = setup();
    items.create({ typeId, title: "A" });
    const b = items.create({ typeId, title: "B" });
    items.setArchived(b.id, true);
    const result = query.listNotes();
    assert.deepStrictEqual(titles(result), ["A"]);
    assert.strictEqual(result.total, 1);
  });

  it("filters archived: include and only", () => {
    const { query, items, typeId } = setup();
    items.create({ typeId, title: "A" });
    items.setArchived(items.create({ typeId, title: "B" }).id, true);
    assert.deepStrictEqual(titles(query.listNotes({ archived: "include" })).sort(), ["A", "B"]);
    assert.deepStrictEqual(titles(query.listNotes({ archived: "only" })), ["B"]);
  });

  it("filters by status, type, category, and priority (with none for unassigned)", () => {
    const { query, items, types, categories, typeId } = setup();
    const otherType = types.add("Other");
    const cat = categories.add("Cat");
    items.create({ typeId, title: "pending-high", priority: "high" });
    items.create({ typeId: otherType.id, title: "typed", status: "done" });
    items.create({ typeId, title: "categorized", categoryId: cat.id, priority: "low" });
    assert.deepStrictEqual(titles(query.listNotes({ status: ["done"] })), ["typed"]);
    assert.deepStrictEqual(titles(query.listNotes({ typeId: otherType.id })), ["typed"]);
    assert.deepStrictEqual(titles(query.listNotes({ categoryId: cat.id })), ["categorized"]);
    assert.deepStrictEqual(titles(query.listNotes({ priority: ["high"] })), ["pending-high"]);
    assert.deepStrictEqual(titles(query.listNotes({ priority: ["none"] })), ["typed"]);
    assert.deepStrictEqual(titles(query.listNotes({ priority: ["low", "none"] })).sort(), ["categorized", "typed"]);
  });

  it("filters by code link: hasLink and linkState", () => {
    const { query, items, files, typeId, linkAt } = setup();
    files.files.set("a.ts", ["one", "two"]);
    items.create({ typeId, title: "plain" });
    const linked = items.create({ typeId, title: "linked", link: linkAt("a.ts", 1) });
    items.create({ typeId, title: "stale", link: { ...linkAt("a.ts", 2), state: "changed" } });
    assert.deepStrictEqual(titles(query.listNotes({ hasLink: false })), ["plain"]);
    assert.deepStrictEqual(titles(query.listNotes({ hasLink: true })).sort(), ["linked", "stale"]);
    assert.deepStrictEqual(titles(query.listNotes({ linkState: ["changed"] })), ["stale"]);
    assert.deepStrictEqual(titles(query.listNotes({ linkState: ["ok"] })), ["linked"]);
    assert.strictEqual(query.listNotes({ linkState: ["ok"] }).notes[0].id, linked.id);
  });

  it("searches the title, the description, and the task titles, ignoring case", () => {
    const { query, items, typeId } = setup();
    items.create({ typeId, title: "Fix SAVE bug" });
    items.create({ typeId, title: "B", description: "mentions Cache here" });
    items.create({ typeId, title: "C", tasks: [{ title: "Check the cache", completed: false }] });
    items.create({ typeId, title: "D" });
    assert.deepStrictEqual(titles(query.listNotes({ text: "save" })), ["Fix SAVE bug"]);
    assert.deepStrictEqual(titles(query.listNotes({ text: "CACHE" })).sort(), ["B", "C"]);
  });

  it("combines filters (every one must match)", () => {
    const { query, items, typeId } = setup();
    items.create({ typeId, title: "A", status: "done", priority: "high" });
    items.create({ typeId, title: "B", status: "done", priority: "low" });
    items.create({ typeId, title: "C", status: "pending", priority: "high" });
    assert.deepStrictEqual(titles(query.listNotes({ status: ["done"], priority: ["high"] })), ["A"]);
    assert.deepStrictEqual(titles(query.listNotes({ status: ["done"], priority: ["high"], text: "b" })), []);
  });
});

describe("NotesQuery.listNotes order, paging, and input", () => {
  it("orders by priority (critical first, unassigned last), then the latest change first", () => {
    const { query, items, storage, typeId } = setup();
    const low = items.create({ typeId, title: "low", priority: "low" });
    const none = items.create({ typeId, title: "none" });
    const critical = items.create({ typeId, title: "critical", priority: "critical" });
    const olderLow = items.create({ typeId, title: "older-low", priority: "low" });
    const at = (id: string, updatedAt: string) => (storage.getData().items.find((n) => n.id === id)!.updatedAt = updatedAt);
    at(low.id, "2026-11-05T00:00:00.000Z");
    at(olderLow.id, "2026-11-01T00:00:00.000Z");
    at(none.id, "2026-11-09T00:00:00.000Z");
    at(critical.id, "2026-11-02T00:00:00.000Z");
    assert.deepStrictEqual(titles(query.listNotes()), ["critical", "low", "older-low", "none"]);
  });

  it("pages with limit and offset and reports the total", () => {
    const { query, items, typeId } = setup();
    for (let i = 1; i <= 5; i++) {
      items.create({ typeId, title: `n${i}`, priority: "low" });
    }
    const first = query.listNotes({ limit: 2 });
    assert.strictEqual(first.notes.length, 2);
    assert.strictEqual(first.total, 5);
    const second = query.listNotes({ limit: 2, offset: 2 });
    assert.strictEqual(second.notes.length, 2);
    assert.strictEqual(new Set([...first.notes, ...second.notes].map((n) => n.id)).size, 4);
    const last = query.listNotes({ limit: 2, offset: 4 });
    assert.strictEqual(last.notes.length, 1);
    assert.strictEqual(query.listNotes({ offset: 99 }).notes.length, 0);
  });

  it("applies the default and the maximum page size", () => {
    const { query } = setup();
    assert.strictEqual(query.listNotes().limit, DEFAULT_LIST_LIMIT);
    assert.strictEqual(query.listNotes({ limit: MAX_LIST_LIMIT }).limit, MAX_LIST_LIMIT);
    assert.throws(() => query.listNotes({ limit: MAX_LIST_LIMIT + 1 }), refuses("INVALID_INPUT"));
  });

  it("refuses every invalid filter field with INVALID_INPUT", () => {
    const { query } = setup();
    const bad: Record<string, unknown>[] = [
      { status: "done" },
      { status: [] },
      { status: ["finished"] },
      { typeId: 5 },
      { typeId: "" },
      { categoryId: [] },
      { priority: ["urgent"] },
      { priority: "high" },
      { archived: "maybe" },
      { archived: true },
      { hasLink: "yes" },
      { linkState: ["broken"] },
      { text: "" },
      { text: "   " },
      { text: 4 },
      { limit: 0 },
      { limit: 1.5 },
      { limit: "10" },
      { offset: -1 },
      { offset: 0.5 },
      { unknownField: 1 },
    ];
    for (const filter of bad) {
      assert.throws(() => query.listNotes(filter), refuses("INVALID_INPUT"), JSON.stringify(filter));
    }
    assert.throws(() => query.listNotes([] as never), refuses("INVALID_INPUT"));
    assert.throws(() => query.listNotes("x" as never), refuses("INVALID_INPUT"));
  });

  it("accepts null and an empty filter as no filter", () => {
    const { query, items, typeId } = setup();
    items.create({ typeId, title: "A" });
    assert.strictEqual(query.listNotes(null as never).total, 1);
    assert.strictEqual(query.listNotes({}).total, 1);
  });
});
describe("NotesQuery.getNote", () => {
  it("returns the note in full with its tasks and the linked code with context", async () => {
    const { query, items, files, typeId, linkAt } = setup();
    files.files.set("a.ts", ["l1", "l2", "l3", "l4", "l5", "l6", "l7"]);
    const note = items.create({ typeId, title: "N", description: "Body", tasks: [{ title: "T", completed: false }], link: linkAt("a.ts", 4, 5) });
    const result = await query.getNote(note.id, { excerptLines: 1 });
    assert.strictEqual(result.note.description, "Body");
    assert.deepStrictEqual(result.note.tasks, [{ index: 0, title: "T", completed: false }]);
    assert.strictEqual(result.note.updatedAt, note.updatedAt);
    assert.deepStrictEqual(
      result.excerpt!.lines.map((l) => l.line),
      [3, 4, 5, 6]
    );
  });

  it("uses 3 lines of context by default and refuses an excerptLines out of range", async () => {
    const { query, items, files, typeId, linkAt } = setup();
    files.files.set(
      "a.ts",
      Array.from({ length: 30 }, (_, i) => `l${i + 1}`)
    );
    const id = items.create({ typeId, title: "N", link: linkAt("a.ts", 15) }).id;
    assert.strictEqual((await query.getNote(id)).excerpt!.lines.length, 7);
    assert.strictEqual((await query.getNote(id, { excerptLines: 0 })).excerpt!.lines.length, 1);
    assert.strictEqual((await query.getNote(id, { excerptLines: 20 })).excerpt!.lines.length, 30 - 0);
    await assert.rejects(query.getNote(id, { excerptLines: 21 }), refuses("INVALID_INPUT"));
    await assert.rejects(query.getNote(id, { excerptLines: -1 }), refuses("INVALID_INPUT"));
    await assert.rejects(query.getNote(id, { excerptLines: "3" }), refuses("INVALID_INPUT"));
  });

  it("has no excerpt for a note without a link", async () => {
    const { query, items, typeId } = setup();
    const result = await query.getNote(items.create({ typeId, title: "N" }).id);
    assert.strictEqual(result.excerpt, null);
    assert.strictEqual(result.note.link, null);
  });

  it("re-finds moved code, stores the new place, and excerpts it", async () => {
    const { query, items, files, storage, typeId, linkAt } = setup();
    files.files.set("a.ts", ["x", "target", "y"]);
    const id = items.create({ typeId, title: "N", link: linkAt("a.ts", 2) }).id;
    files.files.set("a.ts", ["new1", "new2", "x", "target", "y"]);
    const result = await query.getNote(id, { excerptLines: 0 });
    assert.strictEqual(result.note.link!.lineStart, 4);
    assert.strictEqual(result.note.link!.state, "ok");
    assert.strictEqual(result.excerpt!.lines[0].text, "target");
    assert.strictEqual(items.get(id)!.link!.lineStart, 4);
    assert.ok(storage.saved.length > 0);
  });

  it("reports a link whose code changed, and a missing file without an excerpt", async () => {
    const { query, items, files, typeId, linkAt } = setup();
    files.files.set("a.ts", ["x", "target", "y"]);
    files.files.set("b.ts", ["only"]);
    const changed = items.create({ typeId, title: "C", link: linkAt("a.ts", 2) }).id;
    const missing = items.create({ typeId, title: "M", link: linkAt("b.ts", 1) }).id;
    files.files.set("a.ts", ["completely", "different", "file"]);
    files.files.delete("b.ts");
    const c = await query.getNote(changed);
    assert.strictEqual(c.note.link!.state, "changed");
    assert.ok(c.excerpt);
    const m = await query.getNote(missing);
    assert.strictEqual(m.note.link!.state, "missing");
    assert.strictEqual(m.excerpt, null);
  });

  it("reads an archived note", async () => {
    const { query, items, typeId } = setup();
    const id = items.create({ typeId, title: "N" }).id;
    items.setArchived(id, true);
    assert.strictEqual((await query.getNote(id)).note.archived, true);
  });

  it("refuses an unknown id with NOT_FOUND", async () => {
    const { query } = setup();
    await assert.rejects(query.getNote("gone"), refuses("NOT_FOUND"));
    await assert.rejects(query.getNote(undefined), refuses("NOT_FOUND"));
    await assert.rejects(query.getNote(42), refuses("NOT_FOUND"));
  });
});

describe("NotesQuery types, categories, work pause note, and summary", () => {
  it("lists types and categories with their note counts (archived included)", () => {
    const { query, items, types, categories, typeId } = setup();
    const bug = types.add("Bug", "bug");
    const cat = categories.add("Cat");
    categories.setDefaultType(cat.id, bug.id);
    items.create({ typeId: bug.id, title: "A", categoryId: cat.id });
    items.setArchived(items.create({ typeId: bug.id, title: "B" }).id, true);
    const result = query.listTypesAndCategories();
    const typeRow = result.types.find((t) => t.id === bug.id)!;
    assert.deepStrictEqual(typeRow, { id: bug.id, label: "Bug", icon: "bug", noteCount: 2 });
    assert.strictEqual(result.types.find((t) => t.id === typeId)!.noteCount, 0);
    const catRow = result.categories.find((c) => c.id === cat.id)!;
    assert.deepStrictEqual(catRow, { id: cat.id, label: "Cat", isDefault: false, defaultTypeId: bug.id, noteCount: 1 });
    const general = result.categories.find((c) => c.id === "general")!;
    assert.strictEqual(general.isDefault, true);
    assert.strictEqual(general.defaultTypeId, null);
    assert.strictEqual(general.noteCount, 1);
  });

  it("reads a never-saved Work Pause note as empty and not paused", () => {
    const { query } = setup();
    assert.deepStrictEqual(query.getWorkPauseNote(), { text: "", updatedAt: "", paused: false });
  });

  it("reads the Work Pause note text, version, and paused state", () => {
    const { query, workPause } = setup();
    workPause.save("Stopped at the router", true);
    const note = query.getWorkPauseNote();
    assert.strictEqual(note.text, "Stopped at the router");
    assert.strictEqual(note.paused, true);
    assert.strictEqual(note.updatedAt, workPause.get().updatedAt);
  });

  it("counts notes per status, priority, and link state, with archived ones apart", () => {
    const { query, items, typeId, linkAt, files } = setup();
    files.files.set("a.ts", ["x", "y"]);
    items.create({ typeId, title: "A", priority: "critical" });
    items.create({ typeId, title: "B", status: "done", priority: "low", link: linkAt("a.ts", 1) });
    items.create({ typeId, title: "C", status: "in-progress", link: { ...linkAt("a.ts", 2), state: "missing" } });
    items.setArchived(items.create({ typeId, title: "D", link: linkAt("a.ts", 1) }).id, true);
    const s = query.projectSummary();
    assert.deepStrictEqual(s.statusCounts, { pending: 1, "in-progress": 1, done: 1, canceled: 0 });
    assert.deepStrictEqual(s.priorityCounts, { critical: 1, high: 0, medium: 0, low: 1, none: 1 });
    assert.strictEqual(s.archivedCount, 1);
    assert.deepStrictEqual(s.linkStateCounts, { ok: 1, changed: 0, missing: 1 });
    assert.strictEqual(s.priorityEnabled, true);
    assert.strictEqual(s.workPaused, false);
    assert.strictEqual(s.storageProblem, null);
    assert.deepStrictEqual(s.errorCodes, [...ERROR_CODES]);
  });

  it("reports that priority is off", () => {
    assert.strictEqual(setup({ priority: false }).query.projectSummary().priorityEnabled, false);
  });
});

describe("NotesQuery reads keep working when writes are refused", () => {
  it("reads while work is paused", async () => {
    const { query, items, workPause, typeId } = setup();
    const id = items.create({ typeId, title: "A" }).id;
    workPause.save("Away", true);
    assert.strictEqual(query.listNotes().total, 1);
    assert.strictEqual((await query.getNote(id)).note.title, "A");
    assert.strictEqual(query.getWorkPauseNote().paused, true);
    assert.strictEqual(query.listTypesAndCategories().types.length > 0, true);
    assert.strictEqual(query.projectSummary().workPaused, true);
  });

  it("reads while saving is off, and writes nothing", async () => {
    const { query, items, storage, typeId } = setup();
    const id = items.create({ typeId, title: "A" }).id;
    storage.problem = BLOCKED;
    const before = JSON.stringify(storage.getData());
    const saves = storage.saved.length;
    assert.strictEqual(query.listNotes().total, 1);
    assert.strictEqual((await query.getNote(id)).note.title, "A");
    assert.strictEqual(query.getWorkPauseNote().text, "");
    assert.ok(query.projectSummary().storageProblem?.includes("The data file is not valid."));
    assert.strictEqual(JSON.stringify(storage.getData()), before);
    assert.strictEqual(storage.saved.length, saves);
  });
});
