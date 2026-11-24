/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { GENERAL_CATEGORY_ID, MindStreamCategoryDef } from "./models";
import { IStorage } from "./storage";
import { newId, nowIso } from "./util";

/**
 * Category management.
 * Adds/renames/removes categories while keeping linked records intact
 * (items reference the stable category id, not the label).
 * The built-in "General" category can be renamed but never deleted.
 */
export class CategoriesRegistry {
  constructor(private readonly storage: IStorage) {}

  list(): MindStreamCategoryDef[] {
    return [...this.storage.getData().categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  get(id: string): MindStreamCategoryDef | undefined {
    return this.storage.getData().categories.find((c) => c.id === id);
  }

  label(id: string): string {
    const c = this.get(id);
    return c ? c.label : "(Deleted category)";
  }

  add(label: string): MindStreamCategoryDef {
    const data = this.storage.getData();
    const def: MindStreamCategoryDef = {
      id: newId(),
      label,
      order: (data.categories.length + 1) * 10,
      createdAt: nowIso(),
    };
    data.categories.push(def);
    this.storage.saveData(data);
    return def;
  }

  rename(id: string, label: string): void {
    const data = this.storage.getData();
    const def = data.categories.find((c) => c.id === id);
    if (!def) {
      return;
    }
    def.label = label;
    this.storage.saveData(data);
  }

  /** Sets the default type pre-selected when adding a note to this category. */
  setDefaultType(id: string, typeId: string): void {
    const data = this.storage.getData();
    const def = data.categories.find((c) => c.id === id);
    if (!def) {
      return;
    }
    def.defaultTypeId = typeId;
    this.storage.saveData(data);
  }

  /** Removes a category. Returns false if it is the protected default category. */
  remove(id: string): boolean {
    const data = this.storage.getData();
    const def = data.categories.find((c) => c.id === id);
    if (!def || def.id === GENERAL_CATEGORY_ID) {
      return false;
    }
    data.categories = data.categories.filter((c) => c.id !== id);
    this.storage.saveData(data);
    return true;
  }

  /**
   * Removes a category and every note in it (archived ones too) in a single
   * save, so a refused save leaves both untouched. Returns the number of notes
   * removed, or -1 (nothing changed) for an unknown id or the protected
   * default category.
   */
  removeWithNotes(id: string): number {
    const data = this.storage.getData();
    if (id === GENERAL_CATEGORY_ID || !data.categories.some((c) => c.id === id)) {
      return -1;
    }
    const before = data.items.length;
    data.items = data.items.filter((it) => it.categoryId !== id);
    data.categories = data.categories.filter((c) => c.id !== id);
    this.storage.saveData(data);
    return before - data.items.length;
  }

  /** Number of items (including archived) that belong to a category. */
  countItems(categoryId: string): number {
    return this.storage.getData().items.filter((it) => it.categoryId === categoryId).length;
  }
}
