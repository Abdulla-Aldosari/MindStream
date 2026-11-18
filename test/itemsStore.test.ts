/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { StorageError, createEmptyData } from "../src/storage";
import { ArchivedNoteError, ItemsStore } from "../src/itemsStore";
import { GENERAL_CATEGORY_ID, MINDSTREAM_STATUSES, isStatus } from "../src/models";
import { BLOCKED, InMemoryStorage } from "./helpers";

describe("isStatus", () => {
  it("accepts every known status and rejects anything else", () => {
    for (const status of MINDSTREAM_STATUSES) {
      assert.strictEqual(isStatus(status), true);
    }
    assert.deepStrictEqual([...MINDSTREAM_STATUSES], ["pending", "in-progress", "done", "canceled"]);
    for (const value of ["cancelled", "Canceled", "", undefined, null, 3, {}]) {
      assert.strictEqual(isStatus(value), false);
    }
  });
});

function setup() {
  const storage = new InMemoryStorage(createEmptyData());
  const items = new ItemsStore(storage);
  const typeId = storage.getData().types[0].id;
  return { storage, items, typeId };
}

describe("ItemsStore", () => {
  it("create defaults categoryId to General and status to pending", () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: "Idea" });
    assert.strictEqual(item.categoryId, GENERAL_CATEGORY_ID);
    assert.strictEqual(item.status, "pending");
    assert.strictEqual(item.archived, false);
    assert.ok(!("completedAt" in item));
  });

  it("create persists description, categoryId, tags and status", () => {
    const { items, typeId } = setup();
    const item = items.create({
      typeId,
      title: "T",
      description: "Desc",
      categoryId: "cat-x",
      tags: ["a", "b"],
      status: "done",
    });
    assert.strictEqual(item.description, "Desc");
    assert.strictEqual(item.categoryId, "cat-x");
    assert.deepStrictEqual(item.tags, ["a", "b"]);
    assert.strictEqual(item.status, "done");
    assert.strictEqual(item.completedAt, item.createdAt);
  });

  it("create omits the priority key entirely when none is given", () => {
    const { storage, items, typeId } = setup();
    const item = items.create({ typeId, title: "No priority" });
    assert.strictEqual("priority" in item, false);
    assert.strictEqual(JSON.stringify(storage.getData()).includes('"priority"'), false);
  });

  it("create stores a given priority", () => {
    const { items, typeId } = setup();
    assert.strictEqual(items.create({ typeId, title: "P", priority: "high" }).priority, "high");
  });

  it("update sets a priority and leaves it untouched when omitted", () => {
    const { items, typeId } = setup();
    const unassigned = items.create({ typeId, title: "A" });
    items.update(unassigned.id, { title: "A2" });
    assert.strictEqual("priority" in items.get(unassigned.id)!, false);

    const assigned = items.create({ typeId, title: "B", priority: "critical" });
    items.update(assigned.id, { title: "B2" });
    assert.strictEqual(items.get(assigned.id)!.priority, "critical");
    items.update(assigned.id, { priority: "medium" });
    assert.strictEqual(items.get(assigned.id)!.priority, "medium");
  });

  it("get returns an item or undefined", () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: "X" });
    assert.strictEqual(items.get(item.id)?.title, "X");
    assert.strictEqual(items.get("missing"), undefined);
  });

  it("update patches provided fields and bumps updatedAt", () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: "A" });
    items.update(item.id, { title: "B", description: "D", tags: ["x"] });
    const u = items.get(item.id)!;
    assert.strictEqual(u.title, "B");
    assert.strictEqual(u.description, "D");
    assert.deepStrictEqual(u.tags, ["x"]);
    assert.ok(u.updatedAt >= item.updatedAt);
  });

  it("update ignores unknown ids and leaves unspecified fields unchanged", () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: "A", description: "Keep" });
    items.update("missing", { title: "X" });
    items.update(item.id, { title: "B" });
    assert.strictEqual(items.get(item.id)!.description, "Keep");
  });

  it("changeStatus sets completedAt on done and removes it on any other status", () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: "Task" });
    items.changeStatus(item.id, "in-progress");
    assert.ok(!("completedAt" in items.get(item.id)!));
    items.changeStatus(item.id, "done");
    const updated = items.get(item.id)!;
    assert.strictEqual(updated.status, "done");
    assert.ok(updated.completedAt);
    items.changeStatus(item.id, "pending");
    assert.ok(!("completedAt" in items.get(item.id)!));
  });

  it("changeStatus is a no-op when the status is unchanged", () => {
    const { storage, items, typeId } = setup();
    const item = items.create({ typeId, title: "A" });
    const saves = storage.saved.length;
    items.changeStatus(item.id, "pending");
    assert.strictEqual(storage.saved.length, saves);
  });
  it("archiving does not change the status and saves archivedAt", () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: "Task" });
    items.changeStatus(item.id, "done");
    items.setArchived(item.id, true);
    const updated = items.get(item.id)!;
    assert.strictEqual(updated.status, "done");
    assert.strictEqual(updated.archived, true);
    assert.ok(updated.archivedAt);
  });

  it("setArchived clears archivedAt when unarchiving", () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: "A" });
    items.setArchived(item.id, true);
    items.setArchived(item.id, false);
    const u = items.get(item.id)!;
    assert.strictEqual(u.archived, false);
    assert.strictEqual(u.archivedAt, undefined);
  });

  it("setArchived is a no-op when the state is unchanged", () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: "A" });
    items.setArchived(item.id, false);
    assert.strictEqual(items.get(item.id)!.archived, false);
    assert.strictEqual(items.get(item.id)!.archivedAt, undefined);
  });

  it("deletion is permanent and distinct from archiving", () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: "Task" });
    items.delete(item.id);
    assert.strictEqual(items.get(item.id), undefined);
    assert.strictEqual(items.list(true).length, 0);
  });

  it("deleteByCategory removes only that category items", () => {
    const { items, typeId } = setup();
    items.create({ typeId, title: "A", categoryId: "c1" });
    items.create({ typeId, title: "B", categoryId: "c2" });
    items.deleteByCategory("c1");
    assert.strictEqual(items.list(true).length, 1);
    assert.strictEqual(items.list(true)[0].title, "B");
  });

  it("list hides archived by default and shows on demand", () => {
    const { items, typeId } = setup();
    const a = items.create({ typeId, title: "A" });
    items.create({ typeId, title: "B" });
    items.setArchived(a.id, true);
    assert.strictEqual(items.list().length, 1);
    assert.strictEqual(items.list(true).length, 2);
  });

  it("create stores a link, and update leaves it untouched", () => {
    const { items, typeId } = setup();
    const link = { filePath: "src/a.ts", lineStart: 3, state: "ok" as const };
    const item = items.create({ typeId, title: "L", link });
    assert.deepStrictEqual(item.link, link);
    items.update(item.id, { title: "L2" });
    assert.deepStrictEqual(items.get(item.id)?.link, link);
  });

  it("notes created without a link have no link key", () => {
    const { items, typeId } = setup();
    assert.strictEqual("link" in items.create({ typeId, title: "P" }), false);
  });

  it("setLink and mapLinks change links without touching updatedAt and save only on change", () => {
    const { storage, items, typeId } = setup();
    const a = items.create({ typeId, title: "A", link: { filePath: "a.ts", lineStart: 1, state: "ok" } });
    const plain = items.create({ typeId, title: "P" });
    const updatedAt = items.get(a.id)?.updatedAt;
    const saves = storage.saved.length;
    assert.strictEqual(
      items.mapLinks((l) => l),
      0
    );
    assert.strictEqual(storage.saved.length, saves);
    assert.strictEqual(
      items.mapLinks((l) => ({ ...l, lineStart: 7 })),
      1
    );
    assert.strictEqual(items.get(a.id)?.link?.lineStart, 7);
    items.setLink(plain.id, { filePath: "x.ts", lineStart: 1, state: "ok" });
    assert.strictEqual(items.get(plain.id)?.link, undefined);
    assert.strictEqual(items.get(a.id)?.updatedAt, updatedAt);
  });

  it("list returns a stable creation order", () => {
    const { storage, items, typeId } = setup();
    const a = items.create({ typeId, title: "A" });
    const b = items.create({ typeId, title: "B" });
    const c = items.create({ typeId, title: "C" });
    storage.getData().items.find((x) => x.id === a.id)!.createdAt = "2020-01-01T00:00:00.000Z";
    storage.getData().items.find((x) => x.id === b.id)!.createdAt = "2020-01-02T00:00:00.000Z";
    storage.getData().items.find((x) => x.id === c.id)!.createdAt = "2020-01-03T00:00:00.000Z";
    assert.deepStrictEqual(
      items.list().map((x) => x.id),
      [a.id, b.id, c.id]
    );
  });
});

describe("ItemsStore tasks", () => {
  const tasks = () => [
    { title: "One", completed: false },
    { title: "Two", completed: true },
  ];

  it("create stores tasks, and writes no key without them", () => {
    const { items, typeId } = setup();
    assert.deepStrictEqual(items.create({ typeId, title: "G", tasks: tasks() }).tasks, tasks());
    assert.ok(!("tasks" in items.create({ typeId, title: "Plain" })));
    assert.ok(!("tasks" in items.create({ typeId, title: "Empty", tasks: [] })));
  });

  it("update replaces, clears, or leaves the tasks untouched", () => {
    const { items, typeId } = setup();
    const id = items.create({ typeId, title: "G", tasks: tasks() }).id;
    items.update(id, { title: "Renamed" });
    assert.deepStrictEqual(items.get(id)?.tasks, tasks());
    items.update(id, { tasks: [{ title: "Only", completed: false }] });
    assert.deepStrictEqual(items.get(id)?.tasks, [{ title: "Only", completed: false }]);
    items.update(id, { tasks: [] });
    assert.ok(!("tasks" in (items.get(id) ?? {})));
  });

  it("setTaskCompleted sets the value, bumps updatedAt, and never changes status", () => {
    const { storage, items, typeId } = setup();
    const item = items.create({ typeId, title: "G", tasks: tasks() });
    item.updatedAt = "2020-01-01T00:00:00.000Z";
    const saves = storage.saved.length;
    assert.strictEqual(items.setTaskCompleted(item.id, 0, "One", true), true);
    const stored = items.get(item.id);
    assert.strictEqual(stored?.tasks?.[0].completed, true);
    assert.notStrictEqual(stored?.updatedAt, "2020-01-01T00:00:00.000Z");
    assert.strictEqual(stored?.status, "pending");
    assert.ok(!stored || !("completedAt" in stored));
    assert.strictEqual(storage.saved.length, saves + 1);
  });

  it("setTaskCompleted refuses a bad index, a title mismatch, an unknown note, or no change", () => {
    const { storage, items, typeId } = setup();
    const id = items.create({ typeId, title: "G", tasks: tasks() }).id;
    const plain = items.create({ typeId, title: "Plain" }).id;
    const saves = storage.saved.length;
    assert.strictEqual(items.setTaskCompleted(id, 5, "One", true), false);
    assert.strictEqual(items.setTaskCompleted(id, -1, "One", true), false);
    assert.strictEqual(items.setTaskCompleted(id, 0, "Two", true), false);
    assert.strictEqual(items.setTaskCompleted("nope", 0, "One", true), false);
    assert.strictEqual(items.setTaskCompleted(plain, 0, "One", true), false);
    assert.strictEqual(items.setTaskCompleted(id, 1, "Two", true), false);
    assert.strictEqual(storage.saved.length, saves);
    assert.deepStrictEqual(items.get(id)?.tasks, tasks());
  });

  describe("canceled status", () => {
    it("create with canceled stores canceledAt and no completedAt", () => {
      const { items, typeId } = setup();
      const item = items.create({ typeId, title: "Dropped idea", status: "canceled" });
      assert.strictEqual(item.status, "canceled");
      assert.strictEqual(item.canceledAt, item.createdAt);
      assert.ok(!("completedAt" in item));
    });

    it("changeStatus keeps exactly one outcome time in step with the status", () => {
      const { items, typeId } = setup();
      const item = items.create({ typeId, title: "Idea" });

      items.changeStatus(item.id, "done");
      assert.ok(items.get(item.id)!.completedAt);
      assert.ok(!("canceledAt" in items.get(item.id)!));

      items.changeStatus(item.id, "canceled");
      const canceled = items.get(item.id)!;
      assert.strictEqual(canceled.status, "canceled");
      assert.ok(canceled.canceledAt);
      assert.ok(!("completedAt" in canceled));

      items.changeStatus(item.id, "pending");
      const reopened = items.get(item.id)!;
      assert.ok(!("canceledAt" in reopened));
      assert.ok(!("completedAt" in reopened));
    });

    it("an unknown status is refused before anything changes", () => {
      const { storage, items, typeId } = setup();
      const item = items.create({ typeId, title: "A" });
      const before = JSON.stringify(storage.getData());
      const saves = storage.saved.length;
      assert.throws(() => items.changeStatus(item.id, "rejected" as never), /is not a note status\. Nothing was changed\./);
      assert.throws(() => items.create({ typeId, title: "B", status: "rejected" as never }), /is not a note status/);
      assert.strictEqual(JSON.stringify(storage.getData()), before);
      assert.strictEqual(storage.saved.length, saves);
    });

    it("a refused save leaves the note and the file unchanged", () => {
      const { storage, items, typeId } = setup();
      const item = items.create({ typeId, title: "A" });
      const before = JSON.stringify(storage.getData());
      const saves = storage.saved.length;
      storage.problem = BLOCKED;
      assert.throws(() => items.changeStatus(item.id, "canceled"), StorageError);
      assert.strictEqual(JSON.stringify(storage.getData()), before);
      assert.strictEqual(storage.saved.length, saves);
    });

    it("an archived note cannot be canceled", () => {
      const { items, typeId } = setup();
      const item = items.create({ typeId, title: "Frozen" });
      items.setArchived(item.id, true);
      assert.throws(() => items.changeStatus(item.id, "canceled"), ArchivedNoteError);
      assert.strictEqual(items.get(item.id)!.status, "pending");
    });
  });

  describe("archived notes are read-only", () => {
    function archivedSetup() {
      const ctx = setup();
      const note = ctx.items.create({ typeId: ctx.typeId, title: "Frozen", tasks: tasks() });
      ctx.items.setArchived(note.id, true);
      const before = JSON.stringify(ctx.storage.getData());
      const saves = ctx.storage.saved.length;
      const unchanged = () => {
        assert.strictEqual(JSON.stringify(ctx.storage.getData()), before);
        assert.strictEqual(ctx.storage.saved.length, saves);
      };
      return { ...ctx, id: note.id, unchanged };
    }

    it("update throws ArchivedNoteError and changes nothing", () => {
      const { items, id, unchanged } = archivedSetup();
      assert.throws(() => items.update(id, { title: "Changed" }), ArchivedNoteError);
      unchanged();
    });

    it("changeStatus throws, even for the same status, and changes nothing", () => {
      const { items, id, unchanged } = archivedSetup();
      assert.throws(() => items.changeStatus(id, "done"), ArchivedNoteError);
      assert.throws(() => items.changeStatus(id, "pending"), ArchivedNoteError);
      unchanged();
    });

    it("setTaskCompleted throws and changes nothing", () => {
      const { items, id, unchanged } = archivedSetup();
      assert.throws(() => items.setTaskCompleted(id, 0, "One", true), ArchivedNoteError);
      unchanged();
    });

    it("the error message names the note, says nothing changed, and how to fix it", () => {
      const { items, id } = archivedSetup();
      assert.throws(
        () => items.update(id, { title: "Changed" }),
        (err: unknown) =>
          err instanceof ArchivedNoteError &&
          err.code === "NOTE_ARCHIVED" &&
          err.message.includes('"Frozen"') &&
          err.message.includes("Nothing was changed.") &&
          err.message.includes("Unarchive it first")
      );
    });

    it("an unknown id is still a silent no-op", () => {
      const { items, unchanged } = archivedSetup();
      items.update("nope", { title: "X" });
      items.changeStatus("nope", "done");
      assert.strictEqual(items.setTaskCompleted("nope", 0, "One", true), false);
      unchanged();
    });

    it("link tracking, unarchiving, and deletion still work", () => {
      const { items, id, storage } = archivedSetup();
      storage.getData().items.find((it) => it.id === id)!.link = { filePath: "src/a.ts", lineStart: 3, state: "ok" };
      items.setLink(id, { filePath: "src/a.ts", lineStart: 5, state: "ok" });
      assert.strictEqual(items.get(id)?.link?.lineStart, 5);
      items.setArchived(id, false);
      assert.strictEqual(items.get(id)?.archived, false);
      items.setArchived(id, true);
      items.delete(id);
      assert.strictEqual(items.get(id), undefined);
    });

    it("unarchiving makes the note editable again", () => {
      const { items, id } = archivedSetup();
      items.setArchived(id, false);
      items.update(id, { title: "Thawed" });
      items.changeStatus(id, "done");
      assert.strictEqual(items.setTaskCompleted(id, 0, "One", true), true);
      const note = items.get(id)!;
      assert.strictEqual(note.title, "Thawed");
      assert.strictEqual(note.status, "done");
      assert.strictEqual(note.tasks?.[0].completed, true);
    });
  });
});
