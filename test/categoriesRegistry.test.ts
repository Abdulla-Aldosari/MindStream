/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { createEmptyData } from "../src/storage";
import { CategoriesRegistry } from "../src/categoriesRegistry";
import { ItemsStore } from "../src/itemsStore";
import { GENERAL_CATEGORY_ID } from "../src/models";
import { InMemoryStorage } from "./helpers";

function setup() {
  const storage = new InMemoryStorage(createEmptyData());
  return { storage, categories: new CategoriesRegistry(storage), items: new ItemsStore(storage) };
}

describe("CategoriesRegistry", () => {
  it("removeWithNotes removes the category and its notes in one save", () => {
    const { storage, categories, items } = setup();
    const cat = categories.add("Temp");
    const typeId = storage.getData().types[0].id;
    items.create({ typeId, title: "In it", categoryId: cat.id });
    items.create({ typeId, title: "Kept" });
    const saves = storage.saved.length;
    assert.strictEqual(categories.removeWithNotes(cat.id), 1);
    assert.strictEqual(storage.saved.length, saves + 1);
    assert.strictEqual(categories.get(cat.id), undefined);
    assert.deepStrictEqual(
      items.list().map((n) => n.title),
      ["Kept"]
    );
  });

  it("removeWithNotes changes nothing for the General category or an unknown id", () => {
    const { storage, categories } = setup();
    const saves = storage.saved.length;
    assert.strictEqual(categories.removeWithNotes(GENERAL_CATEGORY_ID), -1);
    assert.strictEqual(categories.removeWithNotes("missing"), -1);
    assert.strictEqual(storage.saved.length, saves);
  });

  it("starts with the default General category", () => {
    const { categories } = setup();
    assert.strictEqual(categories.list().length, 1);
    assert.strictEqual(categories.list()[0].id, GENERAL_CATEGORY_ID);
  });

  it("get returns a category or undefined", () => {
    const { categories } = setup();
    assert.strictEqual(categories.get(GENERAL_CATEGORY_ID)?.label, "General");
    assert.strictEqual(categories.get("missing"), undefined);
  });

  it('label falls back to "(Deleted category)"', () => {
    const { categories } = setup();
    assert.strictEqual(categories.label("missing"), "(Deleted category)");
  });

  it("add creates a category with increasing order", () => {
    const { categories } = setup();
    const a = categories.add("A");
    const b = categories.add("B");
    assert.ok(b.order! > a.order!);
    const ids = categories.list().map((c) => c.id);
    assert.ok(ids.indexOf(a.id) < ids.indexOf(b.id));
  });

  it("rename updates the label", () => {
    const { categories } = setup();
    const cat = categories.add("Temp");
    categories.rename(cat.id, "Pre-Launch");
    assert.strictEqual(categories.label(cat.id), "Pre-Launch");
  });

  it("rename ignores unknown ids", () => {
    const { categories } = setup();
    categories.rename("missing", "X");
    // no throw
  });

  it("setDefaultType stores the type id and persists it", () => {
    const { storage, categories } = setup();
    const cat = categories.add("Fixes");
    categories.setDefaultType(cat.id, "type-1");
    assert.strictEqual(categories.get(cat.id)!.defaultTypeId, "type-1");
    assert.strictEqual(storage.saved.at(-1)!.categories.find((c) => c.id === cat.id)!.defaultTypeId, "type-1");
  });

  it("setDefaultType ignores unknown ids", () => {
    const { categories } = setup();
    categories.setDefaultType("missing", "type-1");
    // no throw
  });

  it("remove returns false for unknown and for the default category", () => {
    const { categories } = setup();
    assert.strictEqual(categories.remove("missing"), false);
    assert.strictEqual(categories.remove(GENERAL_CATEGORY_ID), false);
  });

  it("remove deletes a non-default category", () => {
    const { categories } = setup();
    const cat = categories.add("Temp");
    assert.strictEqual(categories.remove(cat.id), true);
    assert.strictEqual(categories.get(cat.id), undefined);
  });

  it("countItems counts archived items too", () => {
    const { categories, items } = setup();
    const cat = categories.add("C");
    const item = items.create({ typeId: "t", title: "X", categoryId: cat.id });
    items.setArchived(item.id, true);
    assert.strictEqual(categories.countItems(cat.id), 1);
  });
});
