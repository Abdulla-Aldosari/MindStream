/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { StorageError, createEmptyData } from "../src/storage";
import { ArchivedNoteError, ItemsStore } from "../src/itemsStore";
import { TypesRegistry } from "../src/typesRegistry";
import { CategoriesRegistry } from "../src/categoriesRegistry";
import { WorkPauseStore } from "../src/workPauseStore";
import { LinkTracker } from "../src/linkTracker";
import { NotesService } from "../src/notesService";
import { DomainError, ERROR_CODES, errorCodeOf } from "../src/domainError";
import { MAX_NOTE_TITLE } from "../src/noteInput";
import { BLOCKED, FakeFiles, InMemoryStorage } from "./helpers";

function setup(options: { priority?: boolean } = {}) {
  const storage = new InMemoryStorage(createEmptyData());
  const items = new ItemsStore(storage);
  const types = new TypesRegistry(storage);
  const categories = new CategoriesRegistry(storage);
  const workPause = new WorkPauseStore(storage);
  const files = new FakeFiles();
  const links = new LinkTracker(items, files);
  const notes = new NotesService({ storage, items, types, categories, workPause, links, files, priorityEnabled: () => options.priority !== false });
  let changes = 0;
  notes.onDidChange(() => changes++);
  const typeId = storage.getData().types[0].id;
  /** Returns a check that the data and the save count are still what they are now. */
  const snapshot = () => {
    const before = JSON.stringify(storage.getData());
    const saves = storage.saved.length;
    return () => {
      assert.strictEqual(JSON.stringify(storage.getData()), before);
      assert.strictEqual(storage.saved.length, saves);
    };
  };
  return { storage, items, types, categories, workPause, files, notes, typeId, snapshot, changes: () => changes };
}

describe("NotesService refusals change nothing", () => {
  it("refuses every write while work is paused (WORK_PAUSED), naming the only way out", async () => {
    const { notes, items, workPause, typeId, snapshot, categories } = setup();
    const id = items.create({ typeId, title: "A", tasks: [{ title: "T", completed: false }] }).id;
    const cat = categories.add("C");
    workPause.save("Away", true);
    const unchanged = snapshot();
    const writes: (() => unknown)[] = [
      () => notes.addNote({ title: "B" }),
      () => notes.updateNote(id, { title: "B" }),
      () => notes.updateNote(id, { appendDescription: "x" }),
      () => notes.changeStatus(id, "done"),
      () => notes.setTaskCompleted(id, 0, "T", true),
      () => notes.deleteNote(id),
      () => notes.addCategory("D"),
      () => notes.renameCategory(cat.id, "E"),
      () => notes.setCategoryDefaultType(cat.id, typeId),
      () => notes.deleteCategory(cat.id),
      () => notes.addType("T2"),
      () => notes.renameType(typeId, "T3"),
      () => notes.setTypeIcon(typeId, "bug"),
      () => notes.deleteType(typeId),
      () => notes.checkWritable(),
      // Without the user's own panel flag, the note cannot change either.
      () => notes.saveWorkPauseNote("New text", { base: "Away" }),
    ];
    for (const write of writes) {
      assert.throws(
        write,
        (err: unknown) =>
          err instanceof DomainError && err.code === "WORK_PAUSED" && err.message.includes("✓ Work paused - click to resume") && err.message.includes("Nothing was changed.")
      );
    }
    await assert.rejects(notes.setArchived(id, true), code("WORK_PAUSED"));
    unchanged();
  });

  it("lets only the user's own panel edit the Work Pause note while paused", () => {
    const { notes, workPause } = setup();
    workPause.save("Away", true);
    notes.saveWorkPauseNote("Away, back Monday", { base: "Away", userEditWhilePaused: true });
    assert.strictEqual(workPause.get().text, "Away, back Monday");
    assert.strictEqual(workPause.isPaused(), true);
  });

  it("refuses before any change while saving is off (STORAGE_BLOCKED)", async () => {
    const { notes, items, storage, typeId, snapshot } = setup();
    const id = items.create({ typeId, title: "A" }).id;
    storage.problem = BLOCKED;
    const unchanged = snapshot();
    assert.throws(() => notes.addNote({ title: "B" }), StorageError);
    assert.throws(() => notes.changeStatus(id, "done"), code("STORAGE_BLOCKED"));
    assert.throws(() => notes.addCategory("C"), code("STORAGE_BLOCKED"));
    await assert.rejects(notes.setArchived(id, true), code("STORAGE_BLOCKED"));
    unchanged();
  });

  it("refuses unknown ids (NOT_FOUND) instead of doing nothing silently", async () => {
    const { notes, snapshot } = setup();
    const unchanged = snapshot();
    assert.throws(() => notes.updateNote("gone", { title: "X" }), code("NOT_FOUND"));
    assert.throws(() => notes.changeStatus("gone", "done"), code("NOT_FOUND"));
    assert.throws(() => notes.setTaskCompleted("gone", 0, "T", true), code("NOT_FOUND"));
    assert.throws(() => notes.deleteNote("gone"), code("NOT_FOUND"));
    assert.throws(() => notes.addNote({ title: "X", typeId: "gone" }), code("NOT_FOUND"));
    assert.throws(() => notes.addNote({ title: "X", typeId: null }), code("NOT_FOUND"));
    assert.throws(() => notes.addNote({ title: "X", categoryId: "gone" }), code("NOT_FOUND"));
    assert.throws(() => notes.renameCategory("gone", "X"), code("NOT_FOUND"));
    assert.throws(() => notes.setCategoryDefaultType("general", "gone"), code("NOT_FOUND"));
    assert.throws(() => notes.renameType("gone", "X"), code("NOT_FOUND"));
    await assert.rejects(notes.setArchived("gone", true), code("NOT_FOUND"));
    unchanged();
  });

  it("refuses writes to an archived note (NOTE_ARCHIVED) but allows unarchiving", async () => {
    const { notes, items, typeId } = setup();
    const id = items.create({ typeId, title: "Frozen", tasks: [{ title: "T", completed: false }] }).id;
    items.setArchived(id, true);
    assert.throws(() => notes.updateNote(id, { title: "X" }), ArchivedNoteError);
    assert.throws(() => notes.changeStatus(id, "done"), code("NOTE_ARCHIVED"));
    assert.throws(() => notes.setTaskCompleted(id, 0, "T", true), code("NOTE_ARCHIVED"));
    await notes.setArchived(id, false);
    assert.strictEqual(items.get(id)!.archived, false);
  });

  it("every refusal code is listed in ERROR_CODES", () => {
    assert.deepStrictEqual([...ERROR_CODES].sort(), [
      "CONFLICT",
      "DUPLICATE",
      "INVALID_INPUT",
      "LINK_INVALID",
      "NOTE_ARCHIVED",
      "NOT_FOUND",
      "STORAGE_BLOCKED",
      "WORK_PAUSED",
      "WRITE_FAILED",
    ]);
    assert.strictEqual(errorCodeOf(new Error("plain")), undefined);
  });
});

const code = (expected: string) => (err: unknown) => errorCodeOf(err) === expected;

describe("NotesService notes", () => {
  it("addNote applies the defaults: General, the category's default type, pending, the default priority", () => {
    const { notes, types, categories, changes } = setup();
    const fix = types.list().find((t) => t.label === "Fix")!;
    const cat = categories.add("Bugs");
    categories.setDefaultType(cat.id, fix.id);
    const plain = notes.addNote({ title: "  Plain  " });
    assert.strictEqual(plain.title, "Plain");
    assert.strictEqual(plain.categoryId, "general");
    assert.strictEqual(plain.typeId, types.list()[0].id);
    assert.strictEqual(plain.status, "pending");
    assert.strictEqual(plain.priority, "low");
    assert.strictEqual(notes.addNote({ title: "Bug", categoryId: cat.id }).typeId, fix.id);
    assert.strictEqual(changes(), 2);
  });

  it("addNote writes no priority while priority is off, and refuses one that is sent", () => {
    const { notes, snapshot } = setup({ priority: false });
    assert.ok(!("priority" in notes.addNote({ title: "A" })));
    const unchanged = snapshot();
    assert.throws(
      () => notes.addNote({ title: "B", priority: "high" }),
      (err: unknown) => errorCodeOf(err) === "INVALID_INPUT" && /priority is turned off/.test((err as Error).message)
    );
    unchanged();
  });

  it("refuses invalid input (INVALID_INPUT) instead of cutting or guessing it", () => {
    const { notes, snapshot } = setup();
    const unchanged = snapshot();
    const bad: unknown[] = [
      { title: "" },
      { title: 5 },
      { title: "x".repeat(MAX_NOTE_TITLE + 1) },
      { title: "A", status: "rejected" },
      { title: "A", priority: "urgent" },
      { title: "A", description: 7 },
      { title: "A", tasks: "one" },
      { title: "A", tasks: [{ title: "x".repeat(501) }] },
    ];
    for (const input of bad) {
      assert.throws(() => notes.addNote(input as never), code("INVALID_INPUT"));
    }
    unchanged();
  });

  it("updateNote changes only the fields sent and reports each change", () => {
    const { notes, items, typeId } = setup();
    const id = items.create({ typeId, title: "A", description: "Keep", priority: "low" }).id;
    const result = notes.updateNote(id, { title: "B", priority: "high" });
    assert.deepStrictEqual(
      result.changes.map((c) => [c.field, c.before, c.after]),
      [
        ["title", "A", "B"],
        ["priority", "low", "high"],
      ]
    );
    assert.strictEqual(items.get(id)!.description, "Keep");
  });

  it("updateNote with the same values writes nothing", () => {
    const { notes, items, typeId, snapshot, changes } = setup();
    const id = items.create({ typeId, title: "A" }).id;
    const unchanged = snapshot();
    assert.deepStrictEqual(notes.updateNote(id, { title: "A" }).changes, []);
    unchanged();
    assert.strictEqual(changes(), 0);
  });

  it("appendDescription adds a paragraph without a base and can never overwrite", () => {
    const { notes, items, typeId } = setup();
    const id = items.create({ typeId, title: "A", description: "First.\n" }).id;
    notes.updateNote(id, { appendDescription: "  Cause: locked file.  " });
    assert.strictEqual(items.get(id)!.description, "First.\n\nCause: locked file.");
    const empty = items.create({ typeId, title: "B" }).id;
    notes.updateNote(empty, { appendDescription: "Only" });
    assert.strictEqual(items.get(empty)!.description, "Only");
    assert.throws(() => notes.updateNote(id, { appendDescription: "  " }), code("INVALID_INPUT"));
    assert.throws(() => notes.updateNote(id, { appendDescription: "x", description: "y" }, { expectedUpdatedAt: items.get(id)!.updatedAt }), code("INVALID_INPUT"));
  });

  it("changeStatus reports the status it replaced and writes nothing when it is the same", () => {
    const { notes, items, typeId, snapshot } = setup();
    const id = items.create({ typeId, title: "A" }).id;
    assert.strictEqual(notes.changeStatus(id, "done").previous, "pending");
    const unchanged = snapshot();
    assert.strictEqual(notes.changeStatus(id, "done").previous, "done");
    unchanged();
    assert.throws(() => notes.changeStatus(id, "rejected"), code("INVALID_INPUT"));
  });

  it("setArchived re-finds the code of a note when it is unarchived", async () => {
    const { notes, items, files, typeId } = setup();
    const link = { filePath: "src/a.ts", lineStart: 2, state: "ok" as const, anchor: { text: ["return 1;"], before: "function f() {", after: "}" } };
    const id = items.create({ typeId, title: "Linked", link }).id;
    await notes.setArchived(id, true);
    assert.deepStrictEqual(files.reads, []);
    files.files.set("src/a.ts", ["new", "function f() {", "  return 1;", "}"]);
    const result = await notes.setArchived(id, false);
    assert.strictEqual(result.previous, true);
    assert.deepStrictEqual(files.reads, ["src/a.ts"]);
    assert.strictEqual(items.get(id)!.link?.lineStart, 3);
    await assert.rejects(notes.setArchived(id, "no"), code("INVALID_INPUT"));
  });
});

describe("NotesService concurrency", () => {
  /** A note read by an automated caller at 10:00, then edited by the user at 10:02. */
  function readThenChangedElsewhere() {
    const ctx = setup();
    const note = ctx.items.create({ typeId: ctx.typeId, title: "Fix save", description: "Line 40", tasks: [{ title: "Repro", completed: false }] });
    note.updatedAt = "2026-11-22T10:00:00.000Z";
    const readAt = note.updatedAt;
    ctx.items.update(note.id, { description: "Line 40, also line 52" });
    return { ...ctx, id: note.id, readAt };
  }

  it("replacing the description or the tasks without a base is refused, so a stale copy can never overwrite", () => {
    const { notes, id, snapshot } = readThenChangedElsewhere();
    const unchanged = snapshot();
    assert.throws(
      () => notes.updateNote(id, { description: "From an old copy" }),
      (err: unknown) => errorCodeOf(err) === "INVALID_INPUT" && /needs the version it is based on/.test((err as Error).message)
    );
    assert.throws(() => notes.updateNote(id, { tasks: [] }), code("INVALID_INPUT"));
    unchanged();
  });

  it("refuses a rewrite based on an older read (CONFLICT) and returns the note as it is now", () => {
    const { notes, id, readAt, snapshot } = readThenChangedElsewhere();
    const unchanged = snapshot();
    assert.throws(
      () => notes.updateNote(id, { description: "Line 40. Fixed." }, { expectedUpdatedAt: readAt }),
      (err: unknown) => err instanceof DomainError && err.code === "CONFLICT" && (err.current as { description?: string }).description === "Line 40, also line 52"
    );
    unchanged();
  });

  it("succeeds once the caller re-reads and redoes the change on the current content", () => {
    const { notes, items, id } = readThenChangedElsewhere();
    const current = notes.getNote(id);
    notes.updateNote(id, { description: `${current.description}. Fixed.` }, { expectedUpdatedAt: current.updatedAt });
    assert.strictEqual(items.get(id)!.description, "Line 40, also line 52. Fixed.");
  });

  it("commands need no base: status, append, a single task, and other fields still work on a note changed elsewhere", () => {
    const { notes, items, id } = readThenChangedElsewhere();
    notes.changeStatus(id, "in-progress");
    notes.updateNote(id, { appendDescription: "Verified by hand." });
    notes.setTaskCompleted(id, 0, "Repro", true);
    notes.updateNote(id, { title: "Fix the save", priority: "critical" });
    const note = items.get(id)!;
    assert.strictEqual(note.status, "in-progress");
    assert.strictEqual(note.description, "Line 40, also line 52\n\nVerified by hand.");
    assert.strictEqual(note.tasks?.[0].completed, true);
    assert.strictEqual(note.priority, "critical");
  });

  it("a stale task position is a CONFLICT, never a check on the wrong task", () => {
    const { notes, items, typeId, snapshot } = setup();
    const id = items.create({ typeId, title: "G", tasks: [{ title: "One", completed: false }] }).id;
    items.update(id, {
      tasks: [
        { title: "Zero", completed: false },
        { title: "One", completed: false },
      ],
    });
    const unchanged = snapshot();
    assert.throws(() => notes.setTaskCompleted(id, 0, "One", true), code("CONFLICT"));
    unchanged();
  });

  it("a write first picks up a change made outside this instance", () => {
    const { notes, storage, items, typeId, changes } = setup();
    const id = items.create({ typeId, title: "A" }).id;
    let reloads = 0;
    storage.reloadIfExternal = () => {
      reloads++;
      return reloads === 1;
    };
    notes.changeStatus(id, "done");
    assert.strictEqual(reloads, 1);
    // One notice for the outside change, one for the write.
    assert.strictEqual(changes(), 2);
  });
});

describe("NotesService code links", () => {
  it("linkFor builds the link from the file content, as the editor command does", async () => {
    const { notes, files } = setup();
    files.files.set("src/a.ts", ["a", "function f() {", "  return 1;", "}"]);
    const link = await notes.linkFor({ filePath: "src/a.ts", lineStart: 2, lineEnd: 3 });
    assert.deepStrictEqual(
      { filePath: link.filePath, lineStart: link.lineStart, lineEnd: link.lineEnd, state: link.state },
      { filePath: "src/a.ts", lineStart: 2, lineEnd: 3, state: "ok" }
    );
    assert.deepStrictEqual(link.anchor?.text, ["function f() {", "return 1;"]);
    const note = notes.addNote({ title: "Linked" }, link);
    assert.strictEqual(note.link?.filePath, "src/a.ts");
  });

  it("linkFor refuses (LINK_INVALID) paths outside the project, missing files, and lines the file does not have", async () => {
    const { notes, files } = setup();
    files.files.set("src/a.ts", ["one", "two"]);
    for (const location of [
      { filePath: "../secret.txt", lineStart: 1 },
      { filePath: "/etc/passwd", lineStart: 1 },
      { filePath: "C:/x.ts", lineStart: 1 },
      { filePath: "src\\a.ts", lineStart: 1 },
      { filePath: "src/missing.ts", lineStart: 1 },
      { filePath: "src/a.ts", lineStart: 0 },
      { filePath: "src/a.ts", lineStart: 2, lineEnd: 1 },
      { filePath: "src/a.ts", lineStart: 3 },
      { filePath: "src/a.ts", lineStart: 1, lineEnd: 9 },
    ]) {
      await assert.rejects(notes.linkFor(location), code("LINK_INVALID"));
    }
  });

  it("addNote refuses a malformed link and stores nothing", () => {
    const { notes, snapshot } = setup();
    const unchanged = snapshot();
    assert.throws(() => notes.addNote({ title: "A" }, { filePath: "../x", lineStart: 1, state: "ok" }), code("LINK_INVALID"));
    unchanged();
  });
});

describe("NotesService categories and types", () => {
  it("adds trimmed names and refuses a name already in use (DUPLICATE), returning the existing entry", () => {
    const { notes, snapshot } = setup();
    const cat = notes.addCategory("  Before   Release ");
    assert.strictEqual(cat.label, "Before Release");
    const unchanged = snapshot();
    assert.throws(
      () => notes.addCategory("before release"),
      (err: unknown) => err instanceof DomainError && err.code === "DUPLICATE" && (err.current as { id: string }).id === cat.id
    );
    assert.throws(() => notes.addType("fix"), code("DUPLICATE"));
    assert.throws(() => notes.addCategory(""), code("INVALID_INPUT"));
    assert.throws(() => notes.addType("Bug", "<b>"), code("INVALID_INPUT"));
    unchanged();
  });

  it("deleteCategory removes the category and its notes in one save; the built-in one is refused", () => {
    const { notes, items, storage, typeId, snapshot } = setup();
    const cat = notes.addCategory("Temp");
    items.create({ typeId, title: "In it", categoryId: cat.id });
    items.create({ typeId, title: "Elsewhere" });
    const saves = storage.saved.length;
    assert.strictEqual(notes.deleteCategory(cat.id), 1);
    assert.strictEqual(storage.saved.length, saves + 1);
    assert.deepStrictEqual(
      items.list(true).map((n) => n.title),
      ["Elsewhere"]
    );
    const unchanged = snapshot();
    assert.throws(() => notes.deleteCategory("general"), code("INVALID_INPUT"));
    unchanged();
  });

  it("a refused category delete leaves the category and its notes", () => {
    const { notes, items, storage, typeId, snapshot } = setup();
    const cat = notes.addCategory("Temp");
    items.create({ typeId, title: "In it", categoryId: cat.id });
    const unchanged = snapshot();
    storage.problem = BLOCKED;
    assert.throws(() => notes.deleteCategory(cat.id), StorageError);
    unchanged();
  });

  it("deleteType refuses the last type or one in use, with a reason", () => {
    const { notes, items, types, typeId, snapshot } = setup();
    items.create({ typeId, title: "Uses it" });
    const unchanged = snapshot();
    assert.throws(
      () => notes.deleteType(typeId),
      (err: unknown) => errorCodeOf(err) === "INVALID_INPUT" && /used by 1 note/.test((err as Error).message)
    );
    unchanged();
    for (const t of types.list().slice(1)) {
      notes.deleteType(t.id);
    }
    assert.match(notes.typeDeletionProblem(typeId) ?? "", /last type/);
  });

  it("renames and icons write nothing when unchanged", () => {
    const { notes, typeId, types, snapshot } = setup();
    const label = types.get(typeId)!.label;
    const icon = types.get(typeId)!.icon;
    const unchanged = snapshot();
    notes.renameType(typeId, label);
    notes.setTypeIcon(typeId, icon);
    unchanged();
  });
});

describe("NotesService Work Pause note", () => {
  it("saves a first note without a base, then needs one to replace it", () => {
    const { notes, workPause } = setup();
    notes.saveWorkPauseNote("  Stopped at the storage tests  ");
    assert.strictEqual(workPause.get().text, "Stopped at the storage tests");
    assert.throws(() => notes.saveWorkPauseNote("Replaced"), code("INVALID_INPUT"));
    notes.saveWorkPauseNote("Replaced", { base: "Stopped at the storage tests" });
    assert.strictEqual(workPause.get().text, "Replaced");
  });

  it("takes no expectedUpdatedAt: only the text the user edited (base) can replace the note", () => {
    const { notes, workPause, snapshot } = setup();
    notes.saveWorkPauseNote("Mine");
    const unchanged = snapshot();
    const options = { expectedUpdatedAt: workPause.get().updatedAt } as unknown as Parameters<NotesService["saveWorkPauseNote"]>[1];
    assert.throws(() => notes.saveWorkPauseNote("Agent text", options), code("INVALID_INPUT"));
    assert.strictEqual(workPause.get().text, "Mine");
    unchanged();
  });

  it("refuses a text based on an older version (CONFLICT), keeping the newer one", () => {
    const { notes, workPause, snapshot } = setup();
    notes.saveWorkPauseNote("Mine");
    const readAt = workPause.get().updatedAt;
    workPause.save("Written elsewhere");
    (workPause.get() as { updatedAt: string }).updatedAt = "changed";
    workPause.save("Written elsewhere, again");
    const unchanged = snapshot();
    assert.throws(() => notes.saveWorkPauseNote("Old copy", { base: "Mine" }), code("CONFLICT"));
    assert.ok(readAt);
    unchanged();
  });

  it("refuses an empty or too long text instead of cutting it", () => {
    const { notes, snapshot } = setup();
    const unchanged = snapshot();
    assert.throws(() => notes.saveWorkPauseNote("   "), code("INVALID_INPUT"));
    assert.throws(() => notes.saveWorkPauseNote("x".repeat(10001)), code("INVALID_INPUT"));
    unchanged();
  });

  it("an unchanged text writes nothing, but a pause request with it still pauses", () => {
    const { notes, workPause, snapshot } = setup();
    notes.saveWorkPauseNote("Same");
    const unchanged = snapshot();
    assert.strictEqual(notes.saveWorkPauseNote("Same", { base: "Same" }).changed, false);
    unchanged();
    notes.saveWorkPauseNote("Same", { base: "Same", pause: true });
    assert.strictEqual(workPause.isPaused(), true);
  });
});
