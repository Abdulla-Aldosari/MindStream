/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { createEmptyData } from "../src/storage";
import { TypesRegistry } from "../src/typesRegistry";
import { ItemsStore } from "../src/itemsStore";
import { InMemoryStorage } from "./helpers";

function setup() {
  const storage = new InMemoryStorage(createEmptyData());
  return { storage, types: new TypesRegistry(storage), items: new ItemsStore(storage) };
}

describe("TypesRegistry", () => {
  it("adds a type with an increasing order value", () => {
    const { types } = setup();
    const first = types.add("A");
    const second = types.add("B");
    assert.ok(second.order! > first.order!);
  });

  it("add accepts an optional icon", () => {
    const { types } = setup();
    const def = types.add("Bug", "bug");
    assert.strictEqual(def.icon, "bug");
  });

  it("list returns added types in ascending order", () => {
    const { types } = setup();
    const a = types.add("A");
    const b = types.add("B");
    const ids = types.list().map((t) => t.id);
    assert.ok(ids.indexOf(a.id) < ids.indexOf(b.id));
  });

  it("get returns the definition or undefined for unknown ids", () => {
    const { types } = setup();
    const def = types.add("Fix");
    assert.strictEqual(types.get(def.id)?.label, "Fix");
    assert.strictEqual(types.get("missing"), undefined);
  });

  it('label falls back to "(Deleted type)" for unknown ids', () => {
    const { types } = setup();
    assert.strictEqual(types.label("missing"), "(Deleted type)");
  });

  it("rename updates the label", () => {
    const { types } = setup();
    const def = types.add("Fix");
    types.rename(def.id, "Bug fix");
    assert.strictEqual(types.label(def.id), "Bug fix");
  });

  it("rename ignores unknown ids", () => {
    const { types } = setup();
    types.rename("missing", "Nope");
    // no throw, nothing changes
  });

  it("setIcon updates the icon", () => {
    const { types } = setup();
    const def = types.add("Fix", "wrench");
    types.setIcon(def.id, "bug");
    assert.strictEqual(types.get(def.id)?.icon, "bug");
  });

  it("setIcon ignores unknown ids", () => {
    const { types } = setup();
    types.setIcon("missing", "bug");
    // no throw
  });

  it('deleting a type keeps its records and shows "(Deleted type)"', () => {
    const { types, items } = setup();
    const def = types.add("Fix");
    items.create({ typeId: def.id, title: "Fix something" });
    const affected = types.remove(def.id);
    assert.strictEqual(affected, 1);
    assert.strictEqual(types.label(def.id), "(Deleted type)");
    assert.strictEqual(items.list()[0].typeId, def.id);
  });

  it("refuses to remove the last type and changes nothing", () => {
    const { storage, types } = setup();
    for (const t of types.list().slice(1)) {
      types.remove(t.id);
    }
    const last = types.list()[0];
    const before = JSON.stringify(storage.getData());
    assert.throws(() => types.remove(last.id), /last type/);
    assert.strictEqual(JSON.stringify(storage.getData()), before);
    assert.ok(types.get(last.id));
  });

  it("restoreDefaults adds back only the missing default types, after the existing ones", () => {
    const { storage, types } = setup();
    const before = types.list();
    const removed = [before[2], before[5]];
    for (const t of removed) {
      types.remove(t.id);
    }
    const kept = types.list().map((t) => ({ ...t }));
    const added = types.restoreDefaults();
    assert.deepStrictEqual(
      added.map((t) => t.label),
      removed.map((t) => t.label)
    );
    const after = types.list();
    assert.deepStrictEqual(after.slice(0, kept.length), kept);
    assert.deepStrictEqual(
      after.slice(kept.length).map((t) => [t.label, t.icon]),
      removed.map((t) => [t.label, t.icon])
    );
    assert.ok((after[after.length - 1].order ?? 0) > (after[kept.length - 1].order ?? 0));
    assert.strictEqual(new Set(after.map((t) => t.id)).size, after.length);
    assert.strictEqual(storage.getData().types.length, before.length);
  });

  it("restoreDefaults never duplicates: it ignores case and spaces, and writes nothing when all exist", () => {
    const { storage, types } = setup();
    const task = types.list().find((t) => t.label === "Task")!;
    types.rename(task.id, "  TASK ");
    const saves = storage.saved.length;
    const snapshot = JSON.stringify(storage.getData());
    assert.deepStrictEqual(types.restoreDefaults(), []);
    assert.strictEqual(storage.saved.length, saves);
    assert.strictEqual(JSON.stringify(storage.getData()), snapshot);
  });

  it("restoreDefaults keeps user types and a renamed default is added again", () => {
    const { types } = setup();
    for (const t of types.list().slice(1)) {
      types.remove(t.id);
    }
    const mine = types.add("Mine", "bug");
    types.rename(types.list()[0].id, "Everything");
    const added = types.restoreDefaults();
    assert.strictEqual(added.length, 11);
    assert.ok(types.get(mine.id));
    assert.strictEqual(types.list().filter((t) => t.label === "General").length, 1);
    assert.strictEqual(types.list().length, 11 + 2);
  });

  it("reassign moves items and updates their updatedAt", () => {
    const { types, items } = setup();
    const a = types.add("A");
    const b = types.add("B");
    const item = items.create({ typeId: a.id, title: "X" });
    const moved = types.reassign(a.id, b.id);
    assert.strictEqual(moved, 1);
    const updated = items.get(item.id)!;
    assert.strictEqual(updated.typeId, b.id);
    assert.ok(updated.updatedAt >= item.updatedAt);
  });

  it("countItems counts archived items too", () => {
    const { types, items } = setup();
    const def = types.add("Fix");
    const item = items.create({ typeId: def.id, title: "X" });
    items.setArchived(item.id, true);
    assert.strictEqual(types.countItems(def.id), 1);
  });
});
